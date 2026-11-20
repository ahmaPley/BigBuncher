import { createSocket, type Socket } from 'node:dgram'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { offlineUuid } from '../auth/offlineAuth'
import { onAppEvent } from '../core/events'
import { fetchBuffer, fetchJson } from '../core/http'
import type { LocalProfile } from './yggdrasilServer'

/**
 * Skins of OTHER players for offline accounts. The game asks the local Yggdrasil server for a profile by UUID only;
 * for offline players that UUID is md5("OfflinePlayer:" + nick), so we learn nicks from the game log ("X joined the
 * game") and look the skin up: another BigBuncher on the same LAN → Ely.by → Mojang (by nick). Premium UUIDs go
 * straight to Mojang. Whatever is found is re-signed by the local server, so the game accepts it.
 */

const DISCOVERY_PORT = 47815
const CACHE_MS = 15 * 60_000
const NAME_WAIT_MS = 2500

export { offlineUuid }

const names = new Map<string, string>() // offline uuid → nick
const cache = new Map<string, { profile: LocalProfile | null; at: number }>()
const peers = new Map<string, { port: number; uuids: Set<string>; seen: number }>() // ip → BigBuncher on the LAN

export function learnName(name: string): string {
  const uuid = offlineUuid(name)
  if (!names.has(uuid)) names.set(uuid, name)
  return uuid
}

// Nicks from the game log: "Steve joined the game", "Стив присоединился к игре", "<Steve> hi", "Steve has made the advancement"…
const NICK = '([A-Za-z0-9_]{3,16})'
const LOG_PATTERNS = [
  new RegExp(`\\b${NICK} (?:joined the game|left the game|has made the advancement|has completed the challenge|was slain|fell )`),
  new RegExp(`\\b${NICK} (?:присоединил(?:ся|ась) к игре|покинул)`),
  new RegExp(`\\[CHAT\\] <${NICK}>`),
  new RegExp(`UUID of player ${NICK} is`)
]
let logHooked = false
function hookGameLog(): void {
  if (logHooked) return
  logHooked = true
  onAppEvent((event, payload) => {
    if (event !== 'gameLog') return
    const line = (payload as { line: string }).line
    for (const re of LOG_PATTERNS) {
      const m = re.exec(line)
      if (m) learnName(m[1])
    }
  })
}

const isOfflineUuid = (uuid: string): boolean => uuid.length === 32 && uuid[12] === '3'

async function waitForName(uuid: string): Promise<string | undefined> {
  const end = Date.now() + NAME_WAIT_MS
  while (!names.has(uuid) && Date.now() < end) await new Promise((r) => setTimeout(r, 150))
  return names.get(uuid)
}

interface TexturesPayload {
  textures?: { SKIN?: { url: string; metadata?: { model?: string } } }
}

async function skinFromTexturesProperty(value: string | undefined): Promise<LocalProfile['skin']> {
  if (!value) return undefined
  const t: TexturesPayload = JSON.parse(Buffer.from(value, 'base64').toString())
  const skin = t.textures?.SKIN
  if (!skin) return undefined
  return { png: await fetchBuffer(skin.url.replace(/^http:/, 'https:')), model: skin.metadata?.model === 'slim' ? 'slim' : 'classic' }
}

async function fromPeers(uuid: string): Promise<LocalProfile | null> {
  for (const [ip, peer] of peers) {
    if (Date.now() - peer.seen > 60_000 || !peer.uuids.has(uuid)) continue
    try {
      const r = await fetchJson<{ name: string; model: 'slim' | 'classic'; png?: string }>(`http://${ip}:${peer.port}/bb/profile/${uuid}`, {
        signal: AbortSignal.timeout(1500)
      })
      return { uuid, name: r.name, skin: r.png ? { png: Buffer.from(r.png, 'base64'), model: r.model } : undefined }
    } catch {
      /* peer gone — try the next source */
    }
  }
  return null
}

async function fromEly(uuid: string, name: string): Promise<LocalProfile | null> {
  try {
    const t = await fetchJson<{ SKIN?: { url: string; metadata?: { model?: string } } }>(
      `http://skinsystem.ely.by/textures/${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(3000) }
    )
    if (!t.SKIN) return null
    const png = await fetchBuffer(t.SKIN.url, { signal: AbortSignal.timeout(4000) })
    return { uuid, name, skin: { png, model: t.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic' } }
  } catch {
    return null
  }
}

async function mojangByUuid(uuid: string, nameHint?: string): Promise<LocalProfile | null> {
  try {
    const p = await fetchJson<{ name: string; properties: { name: string; value: string }[] }>(
      `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
      { signal: AbortSignal.timeout(4000) }
    )
    return { uuid, name: nameHint ?? p.name, skin: await skinFromTexturesProperty(p.properties.find((x) => x.name === 'textures')?.value) }
  } catch {
    return null
  }
}

async function fromMojangByName(uuid: string, name: string): Promise<LocalProfile | null> {
  try {
    const { id } = await fetchJson<{ id: string }>(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(3000)
    })
    const p = await mojangByUuid(id, name)
    // The skin is shown on the OFFLINE uuid the game asked about.
    return p ? { ...p, uuid } : null
  } catch {
    return null
  }
}

/** Profile of a player who isn't one of our accounts (null = nothing found, the game shows a default skin). */
export async function resolveRemoteProfile(uuid: string): Promise<LocalProfile | null> {
  uuid = uuid.replace(/-/g, '').toLowerCase()
  const hit = cache.get(uuid)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.profile

  let profile: LocalProfile | null = null
  if (isOfflineUuid(uuid)) {
    const name = names.get(uuid) ?? (await waitForName(uuid))
    profile = (await fromPeers(uuid)) ?? (name ? ((await fromEly(uuid, name)) ?? (await fromMojangByName(uuid, name))) : null)
    if (!profile && name) profile = { uuid, name } // at least the right nick, default skin
  } else {
    profile = await mojangByUuid(uuid)
  }
  cache.set(uuid, { profile, at: Date.now() })
  return profile
}

/* ---------------- LAN: BigBuncher on the same network share their accounts' skins ---------------- */

let lanServer: Server | undefined
let socket: Socket | undefined
let lanPort = 0

/**
 * Starts LAN sharing: a tiny HTTP endpoint that serves ONLY nick + skin of our own accounts, and a UDP broadcast
 * every 15 s telling other BigBuncher where it is. `ownProfiles` is read on every request (accounts may change).
 */
export async function startSkinSharing(ownProfiles: () => LocalProfile[]): Promise<void> {
  hookGameLog()
  if (lanServer) return
  lanServer = createServer((req, res) => {
    const m = /^\/bb\/profile\/([0-9a-f]{32})$/.exec(req.url ?? '')
    const p = m && ownProfiles().find((x) => x.uuid === m[1])
    if (!p) return void res.writeHead(404).end()
    const body = JSON.stringify({ name: p.name, model: p.skin?.model ?? 'classic', png: p.skin?.png.toString('base64') })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
  })
  await new Promise<void>((resolve) => lanServer!.listen(0, '0.0.0.0', resolve))
  lanPort = (lanServer.address() as AddressInfo).port

  socket = createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString()) as { bb?: string; port?: number; uuids?: string[] }
      if (data.bb !== 'skins' || !data.port || !Array.isArray(data.uuids) || data.port === lanPort) return
      peers.set(rinfo.address, { port: data.port, uuids: new Set(data.uuids), seen: Date.now() })
      for (const u of data.uuids) cache.delete(u) // a peer appeared — forget "not found"
    } catch {
      /* not ours */
    }
  })
  socket.on('error', () => undefined)
  await new Promise<void>((resolve) =>
    socket!.bind(DISCOVERY_PORT, () => {
      socket!.setBroadcast(true)
      resolve()
    })
  ).catch(() => undefined)

  const announce = (): void => {
    const msg = Buffer.from(JSON.stringify({ bb: 'skins', port: lanPort, uuids: ownProfiles().map((p) => p.uuid) }))
    socket?.send(msg, DISCOVERY_PORT, '255.255.255.255', () => undefined)
  }
  announce()
  setInterval(announce, 15_000).unref()
}

/** For the smoke test. */
export const _skinNetworkTest = { names, cache, peers }
