import { randomUUID } from 'node:crypto'
import { resolveSrv } from 'node:dns/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import type { Problem, ServerStatus } from '../../shared/types'
import { instanceDir } from '../core/paths'
import { publish } from '../diagnostics/crashDoctor'
import { prettyId } from '../diagnostics/crashAnalyzer'
import { BUILTIN_IDS, scanMods } from '../diagnostics/jarScanner'
import { getInstance } from '../instances/instanceService'

/**
 * "Проверить сервер": asks the server for its status (Server List Ping, like the multiplayer list does)
 * and compares the version and — on Forge servers, which announce them — the mods with the instance.
 */

const EXTRA_BUILTIN = new Set(['mcp', 'fml', 'forge', 'neoforge', 'minecraft'])
/** Forge marks mods the client doesn't need with this version string. */
const SERVER_ONLY = 'OHNOES'

function varInt(n: number): Buffer {
  const out: number[] = []
  let v = n >>> 0
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return Buffer.from(out)
}

class Reader {
  constructor(
    private buf: Buffer,
    public pos = 0
  ) {}
  varInt(): number {
    let result = 0
    for (let shift = 0; shift < 35; shift += 7) {
      if (this.pos >= this.buf.length) throw new RangeError('eof')
      const b = this.buf[this.pos++]
      result |= (b & 0x7f) << shift
      if (!(b & 0x80)) return result >>> 0
    }
    throw new RangeError('varint')
  }
  bool(): boolean {
    return this.buf[this.pos++] !== 0
  }
  ushort(): number {
    const v = this.buf.readUInt16BE(this.pos)
    this.pos += 2
    return v
  }
  utf(): string {
    const len = this.varInt()
    const s = this.buf.toString('utf8', this.pos, this.pos + len)
    this.pos += len
    return s
  }
}

function packet(id: number, body: Buffer): Buffer {
  const data = Buffer.concat([varInt(id), body])
  return Buffer.concat([varInt(data.length), data])
}

async function resolveAddress(address: string): Promise<{ host: string; port: number }> {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(address.trim())
  if (!m) throw new Error('Неправильный адрес сервера')
  const host = m[1]
  if (m[2]) return { host, port: Number(m[2]) }
  try {
    const [srv] = await resolveSrv(`_minecraft._tcp.${host}`)
    if (srv) return { host: srv.name, port: srv.port }
  } catch {
    /* no SRV record */
  }
  return { host, port: 25565 }
}

/** Server List Ping: handshake (next state = status) + status request → JSON. */
function ping(host: string, port: number, timeoutMs = 7000): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    const socket = connect({ host, port })
    let data = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
      fail(new Error('Сервер не ответил (таймаут)'))
    }, timeoutMs)
    const done = (err?: Error, json?: Record<string, unknown>): void => {
      clearTimeout(timer)
      socket.destroy()
      if (err) fail(err)
      else ok(json!)
    }
    socket.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8')
      const portBuf = Buffer.alloc(2)
      portBuf.writeUInt16BE(port)
      socket.write(packet(0, Buffer.concat([varInt(767), varInt(hostBuf.length), hostBuf, portBuf, varInt(1)])))
      socket.write(packet(0, Buffer.alloc(0)))
    })
    socket.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      try {
        const r = new Reader(data)
        const length = r.varInt()
        if (data.length < r.pos + length) return // wait for the rest
        r.varInt() // packet id
        done(undefined, JSON.parse(r.utf()))
      } catch (err) {
        if (err instanceof RangeError) return // incomplete
        done(new Error('Сервер ответил непонятно (это точно сервер Minecraft?)'))
      }
    })
    socket.on('error', (err) => done(new Error(/ENOTFOUND|EAI_AGAIN/.test(err.message) ? 'Такого адреса нет' : /ECONNREFUSED/.test(err.message) ? 'Сервер выключен или порт закрыт' : err.message)))
  })
}

/** Forge 1.18+ packs the mod list into "d": 15 bits per UTF-16 char, then a binary list. */
export function decodeForgeData(s: string): { mods: { id: string; serverOnly: boolean }[]; truncated: boolean } {
  const size = s.charCodeAt(0) | (s.charCodeAt(1) << 15)
  const bytes = Buffer.alloc(size)
  let n = 0
  let buffer = 0
  let bits = 0
  for (let i = 2; i < s.length && n < size; i++) {
    buffer |= (s.charCodeAt(i) & 0x7fff) << bits
    bits += 15
    while (bits >= 8 && n < size) {
      bytes[n++] = buffer & 0xff
      buffer >>>= 8
      bits -= 8
    }
  }
  const r = new Reader(bytes)
  const truncated = r.bool()
  const count = r.ushort()
  const mods: { id: string; serverOnly: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const flag = r.varInt()
    const channels = flag >>> 1
    const serverOnly = (flag & 1) !== 0
    const id = r.utf()
    if (!serverOnly) r.utf() // version
    for (let c = 0; c < channels; c++) {
      r.utf()
      r.utf()
      r.bool()
    }
    mods.push({ id, serverOnly })
  }
  return { mods, truncated }
}

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c
  if (!c || typeof c !== 'object') return ''
  const o = c as { text?: string; extra?: unknown[] }
  return (o.text ?? '') + (o.extra ?? []).map(flattenText).join('')
}

const mcVersionOf = (name: string): string | undefined => /\b(\d+\.\d+(?:\.\d+)?(?:-(?:pre|rc)\d+)?|\d\dw\d\d[a-z])\b/.exec(name)?.[1]

export async function checkServer(instanceId: string, address: string): Promise<ServerStatus> {
  const instance = getInstance(instanceId)
  const status: ServerStatus = { address: address.trim(), online: false, missing: [], ok: false }
  if (!status.address) throw new Error('Впиши адрес сервера')

  let json: Record<string, unknown>
  try {
    const { host, port } = await resolveAddress(status.address)
    json = await ping(host, port)
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
    return status
  }
  status.online = true
  const version = json.version as { name?: string } | undefined
  status.version = version?.name
  status.motd = flattenText(json.description).replace(/§./g, '').trim().slice(0, 200)
  const players = json.players as { online?: number; max?: number } | undefined
  if (players) status.players = { online: players.online ?? 0, max: players.max ?? 0 }

  // which mods the server announces
  let announced: { id: string; serverOnly: boolean }[] | undefined
  let truncated = false
  const forge = json.forgeData as { mods?: { modId: string; modmarker?: string }[]; d?: string; truncated?: boolean } | undefined
  const legacy = json.modinfo as { modList?: { modid: string; version?: string }[] } | undefined
  if (forge) {
    status.loader = 'forge'
    if (forge.d) {
      try {
        const decoded = decodeForgeData(forge.d)
        announced = decoded.mods
        truncated = decoded.truncated
      } catch {
        /* unknown format */
      }
    } else if (forge.mods) announced = forge.mods.map((m) => ({ id: m.modId, serverOnly: (m.modmarker ?? '').startsWith(SERVER_ONLY) }))
    truncated ||= Boolean(forge.truncated)
  } else if (legacy?.modList) {
    status.loader = 'forge'
    announced = legacy.modList.map((m) => ({ id: m.modid, serverOnly: false }))
  } else if (json.isModded === true) status.loader = 'neoforge'
  else status.loader = 'vanilla'
  if (announced) status.mods = announced.filter((m) => !m.serverOnly).map((m) => m.id)

  const problems: Problem[] = []
  const serverMc = status.version ? mcVersionOf(status.version) : undefined
  // Proxies (Velocity/Bungee) often answer with a range like "1.8.x-1.21.x" — only compare a clear single version.
  const ranged = /[-–/]\s*1\.\d+|\.x\b/i.test(status.version ?? '') || (status.version?.match(/\b\d+\.\d+/g)?.length ?? 0) > 1
  if (serverMc && !ranged && serverMc !== instance.mcVersion) {
    problems.push({
      title: `Сервер на другой версии (${serverMc})`,
      explanation: `Сервер работает на Minecraft ${serverMc}, а сборка «${instance.name}» — на ${instance.mcVersion}. Версии должны совпадать.`,
      confidence: 'high',
      evidence: `version: ${status.version}`,
      fixes: [{ label: `Создать сборку ${serverMc}`, action: { kind: 'createInstance', mcVersion: serverMc } }]
    })
  }

  const loaderName = { forge: 'Forge', neoforge: 'NeoForge' } as const
  if ((status.loader === 'forge' || status.loader === 'neoforge') && instance.loader !== status.loader) {
    problems.push({
      title: `Сервер на ${loaderName[status.loader]}, а сборка — ${instance.loader === 'vanilla' ? 'без модов' : instance.loader}`,
      explanation: `На этот сервер пускает только клиент с ${loaderName[status.loader]} и теми же модами. Попроси у админа код сборки (кнопка «Поделиться» в BigBuncher) или создай сборку с ${loaderName[status.loader]} ${serverMc ?? ''}.`,
      confidence: status.loader === 'forge' ? 'high' : 'medium',
      fixes: []
    })
  }

  if (status.mods && instance.loader === status.loader) {
    const jars = await scanMods(join(instanceDir(instance.id), 'mods'), instance.loader, instance.mcVersion)
    const have = new Set(jars.filter((j) => j.enabled).flatMap((j) => j.ids.map((id) => id.toLowerCase())))
    status.missing = [...new Set(status.mods.map((m) => m.toLowerCase()))].filter((id) => !have.has(id) && !BUILTIN_IDS.has(id) && !EXTRA_BUILTIN.has(id))
    if (status.missing.length) {
      problems.push({
        title: `Не хватает модов: ${status.missing.length}`,
        explanation: `На сервере есть моды, которых нет в сборке: ${status.missing.map(prettyId).join(', ')}. Поставлю их с Modrinth (версию подберу под твою сборку).${truncated ? ' Сервер прислал список не полностью — после входа Доктор досмотрит остальное.' : ''}`,
        confidence: 'high',
        fixes: [{ label: `Установить ${status.missing.length} мод(ов) с Modrinth`, action: { kind: 'installMods', modIds: status.missing } }]
      })
    }
  }

  status.ok = problems.length === 0
  if (problems.length) {
    publish({
      id: randomUUID(),
      instanceId,
      phase: 'server',
      createdAt: Date.now(),
      headline: `Сервер ${status.address}: сборка не подходит`,
      problems
    })
  }
  return status
}
