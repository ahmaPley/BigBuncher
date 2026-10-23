import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SkinModel } from '../../shared/types'

/**
 * Minimal local Yggdrasil-compatible server (authlib-injector API spec).
 * It knows only the profiles registered by the launcher and serves their skins,
 * signed with a key generated at startup, so the game accepts them as genuine.
 */
export interface LocalProfile {
  uuid: string
  name: string
  skin?: { png: Buffer; model: SkinModel }
}

const profiles = new Map<string, LocalProfile>()
const textures = new Map<string, Buffer>()
let server: Server | undefined
let rootUrl = ''
let keys: { privateKey: KeyObject; publicPem: string } | undefined

export function registerProfile(profile: LocalProfile): void {
  profiles.set(profile.uuid, profile)
  if (profile.skin) textures.set(textureHash(profile.skin.png), profile.skin.png)
}

const textureHash = (png: Buffer): string => createHash('sha256').update(png).digest('hex')

function signingKeys(): { privateKey: KeyObject; publicPem: string } {
  if (!keys) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 4096 })
    keys = { privateKey: pair.privateKey, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  }
  return keys
}

function profileJson(p: LocalProfile, signed: boolean): object {
  const texturesPayload = {
    timestamp: Date.now(),
    profileId: p.uuid,
    profileName: p.name,
    textures: p.skin
      ? {
          SKIN: {
            url: `${rootUrl}textures/${textureHash(p.skin.png)}`,
            ...(p.skin.model === 'slim' ? { metadata: { model: 'slim' } } : {})
          }
        }
      : {}
  }
  const value = Buffer.from(JSON.stringify(texturesPayload)).toString('base64')
  const property: Record<string, string> = { name: 'textures', value }
  if (signed) property.signature = sign('sha1', Buffer.from(value), signingKeys().privateKey).toString('base64')
  return { id: p.uuid, name: p.name, properties: [property] }
}

function send(res: ServerResponse, status: number, body?: object | Buffer, type = 'application/json'): void {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': payload.length }).end(payload)
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })

const findByName = (name: string): LocalProfile | undefined =>
  [...profiles.values()].find((p) => p.name.toLowerCase() === name.toLowerCase())

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  console.log(`[yggdrasil] ${req.method} ${path}`)
  let m: RegExpMatchArray | null

  if (path === '/') {
    return send(res, 200, {
      meta: {
        serverName: 'BigBuncher',
        implementationName: 'BigBuncher Local Yggdrasil',
        implementationVersion: '1.0.0',
        'feature.non_email_login': true
      },
      skinDomains: ['127.0.0.1', 'localhost'],
      signaturePublickey: signingKeys().publicPem
    })
  }
  if ((m = path.match(/^\/sessionserver\/session\/minecraft\/profile\/([0-9a-f-]{32,36})$/i))) {
    const profile = profiles.get(m[1].replace(/-/g, '').toLowerCase())
    return profile ? send(res, 200, profileJson(profile, url.searchParams.get('unsigned') === 'false')) : send(res, 204)
  }
  if ((m = path.match(/^\/textures\/([0-9a-f]{64})$/))) {
    const png = textures.get(m[1])
    return png ? send(res, 200, png, 'image/png') : send(res, 404)
  }
  if (path === '/sessionserver/session/minecraft/join' && req.method === 'POST') {
    await readBody(req)
    return send(res, 204)
  }
  if (path === '/sessionserver/session/minecraft/hasJoined') {
    const profile = findByName(url.searchParams.get('username') ?? '')
    return profile ? send(res, 200, profileJson(profile, true)) : send(res, 204)
  }
  if (path === '/api/profiles/minecraft' && req.method === 'POST') {
    const names: string[] = JSON.parse((await readBody(req)) || '[]')
    return send(res, 200, names.map(findByName).filter(Boolean).map((p) => ({ id: p!.uuid, name: p!.name })))
  }
  if ((m = path.match(/^\/api\/users\/profiles\/minecraft\/(\w+)$/))) {
    const profile = findByName(m[1])
    return profile ? send(res, 200, { id: profile.uuid, name: profile.name }) : send(res, 204)
  }
  if (path === '/minecraftservices/player/attributes') {
    return send(res, 200, {
      privileges: {
        onlineChat: { enabled: true },
        multiplayerServer: { enabled: true },
        multiplayerRealms: { enabled: false },
        telemetry: { enabled: false }
      },
      profanityFilterPreferences: { profanityFilterOn: false }
    })
  }
  if (path === '/minecraftservices/privacy/blocklist') return send(res, 200, { blockedProfiles: [] })
  return send(res, 404, { error: 'Not Found', errorMessage: path })
}

/** Starts the server once (random free port on loopback) and returns its root URL ending with '/'. */
export async function ensureYggdrasilServer(): Promise<string> {
  if (server) return rootUrl
  signingKeys()
  server = createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 500, { error: String(err) }))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  rootUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  return rootUrl
}

/** Base64 of the metadata response; passed to the agent so it skips the first request. */
export async function prefetchedMetadata(): Promise<string> {
  const root = await ensureYggdrasilServer()
  const res = await fetch(root)
  return Buffer.from(await res.text()).toString('base64')
}
