import { dialog } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import yauzl from 'yauzl'
import { ZipFile } from 'yazl'
import type { BlockIcon, Instance, LoaderId, ShareResult, SharePreview } from '../../shared/types'
import { downloadFile, fetchJson, postJson } from '../core/http'
import { instanceDir } from '../core/paths'
import { runTask, type TaskReporter } from '../core/tasks'
import { createInstance, getInstance, listInstances, newInstanceId } from '../instances/instanceService'
import { installMod, modIndex, modsDir, recordModFile } from '../mods/modService'

/**
 * "Поделиться": a pack or a single mod becomes a text code (Modrinth version ids, no server needed)
 * or a .bbpack file (the same plus configs, quests, scripts and jars that are not on Modrinth).
 * A friend pastes the code / opens the file and gets the same instance or mod.
 */

const MODRINTH = 'https://api.modrinth.com/v2'
const PREFIX = 'BB1-'
const DISABLED = '.disabled'
const MANIFEST = 'bigbuncher.json'
/** Folders of an instance that the pack file carries besides mods (never worlds). */
const FILE_DIRS = ['config', 'defaultconfigs', 'kubejs']
const LOADERS: LoaderId[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']
const ICONS: BlockIcon[] = ['grass', 'stone', 'log', 'crafting', 'furnace', 'chest']

/** What a code / file describes. Short keys keep the code small. */
interface Payload {
  /** p = pack, m = one mod */
  k: 'p' | 'm'
  n: string
  i?: BlockIcon
  v: string
  l: LoaderId
  lv?: string
  /** Modrinth version ids of enabled mods. */
  m: string[]
  /** …of disabled mods. */
  d?: string[]
  /** Names of mods that are not on Modrinth. */
  u?: string[]
  /** Pack file only: those mods are inside the file. */
  f?: boolean
}

interface MrVersion {
  id: string
  project_id: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  files: { url: string; filename: string; primary: boolean; hashes: { sha1: string } }[]
  dependencies: { project_id?: string; dependency_type: string }[]
}

/* ---------------- creating ---------------- */

interface Collected {
  payload: Payload
  /** Jars that are not on Modrinth (file name in the mods folder, with .disabled when off). */
  unmatched: string[]
}

async function collect(instanceId: string, onlyFile?: string): Promise<Collected> {
  const instance = getInstance(instanceId)
  const dir = modsDir(instanceId)
  const index = modIndex(instanceId)
  let files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jar') || f.endsWith(`.jar${DISABLED}`)) : []
  if (onlyFile) files = files.filter((f) => f === onlyFile || f === onlyFile + DISABLED)
  if (onlyFile && !files.length) throw new Error('Мод не найден в папке сборки')

  const hashes = new Map<string, string>()
  for (const f of files) hashes.set(f, createHash('sha1').update(readFileSync(join(dir, f))).digest('hex'))
  const found: Record<string, { id: string }> = files.length
    ? await postJson(`${MODRINTH}/version_files`, { hashes: [...hashes.values()], algorithm: 'sha1' })
    : {}

  const payload: Payload = {
    k: onlyFile ? 'm' : 'p',
    n: onlyFile ? titleOf(index, onlyFile) : instance.stateName ? `${instance.name} — ${instance.stateName}` : instance.name,
    i: instance.icon,
    v: instance.mcVersion,
    l: instance.loader,
    lv: instance.loaderVersion,
    m: [],
    d: [],
    u: []
  }
  const unmatched: string[] = []
  for (const f of files) {
    const version = found[hashes.get(f)!]
    if (version) (f.endsWith(DISABLED) ? payload.d! : payload.m).push(version.id)
    else {
      unmatched.push(f)
      payload.u!.push(titleOf(index, f))
    }
  }
  return { payload, unmatched }
}

const titleOf = (index: Record<string, { title: string }>, file: string): string =>
  index[file.replace(DISABLED, '')]?.title ?? file.replace(DISABLED, '').replace(/\.jar$/, '')

function encode(p: Payload): string {
  const clean: Payload = { ...p }
  if (!clean.d?.length) delete clean.d
  if (!clean.u?.length) delete clean.u
  if (!clean.lv) delete clean.lv
  return PREFIX + deflateRawSync(Buffer.from(JSON.stringify(clean)), { level: 9 }).toString('base64url')
}

/** Code for a whole instance, or for one mod when `fileName` is given. */
export async function createShareCode(instanceId: string, fileName?: string): Promise<ShareResult> {
  const { payload, unmatched } = await collect(instanceId, fileName)
  if (fileName && unmatched.length)
    throw new Error('Этого мода нет на Modrinth, поэтому кодом его не передать. Отправь другу сам .jar-файл (кнопка «Папка модов»).')
  return { code: encode(payload), shared: payload.m.length + (payload.d?.length ?? 0), missing: payload.u ?? [] }
}

function walk(root: string, sub: string, out: string[]): void {
  const dir = join(root, sub)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const rel = sub ? `${sub}/${name}` : name
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out)
    else out.push(rel)
  }
}

/** Saves the instance as a .bbpack file. Returns the path, or null when the dialog was cancelled. */
export async function saveShareFile(instanceId: string): Promise<string | null> {
  const instance = getInstance(instanceId)
  const picked = await dialog.showSaveDialog({
    title: 'Сохранить сборку файлом',
    defaultPath: `${instance.name.replace(/[\\/:*?"<>|]/g, '_')}.bbpack`,
    filters: [{ name: 'Сборка BigBuncher', extensions: ['bbpack'] }]
  })
  if (picked.canceled || !picked.filePath) return null
  await writeShareFile(instanceId, picked.filePath)
  return picked.filePath
}

export async function writeShareFile(instanceId: string, target: string): Promise<void> {
  const instance = getInstance(instanceId)
  await runTask(`Сохранение «${instance.name}»`, async (report) => {
    report.update(-1, 'Ищу моды на Modrinth')
    const { payload, unmatched } = await collect(instanceId)
    const root = instanceDir(instanceId)
    const extra: string[] = []
    for (const d of FILE_DIRS) walk(root, d, extra)

    const zip = new ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify({ ...payload, f: true, code: encode(payload) }, null, 2)), MANIFEST)
    for (const f of unmatched) zip.addFile(join(modsDir(instanceId), f), `mods/${f}`)
    for (const rel of extra) zip.addFile(join(root, rel), rel)
    zip.end()
    report.update(-1, 'Упаковываю файлы')
    await pipeline(zip.outputStream, createWriteStream(target))
  })
}

/* ---------------- reading ---------------- */

const SAFE_ID = /^[A-Za-z0-9]{1,16}$/
const SAFE_TEXT = /^[^\u0000-\u001f]{1,120}$/

/** The code comes from someone else: check every field before using it. */
function validate(raw: unknown): Payload {
  const p = raw as Partial<Payload> | null
  const bad = (): never => {
    throw new Error('Код повреждён или не от BigBuncher')
  }
  if (!p || typeof p !== 'object') bad()
  if (p!.k !== 'p' && p!.k !== 'm') bad()
  if (typeof p!.n !== 'string' || !SAFE_TEXT.test(p!.n)) bad()
  if (typeof p!.v !== 'string' || !/^[\w.\- ]{1,40}$/.test(p!.v)) bad()
  if (!LOADERS.includes(p!.l as LoaderId)) bad()
  if (p!.lv !== undefined && (typeof p!.lv !== 'string' || !/^[\w.+\-]{1,60}$/.test(p!.lv))) bad()
  for (const list of [p!.m, p!.d ?? []]) if (!Array.isArray(list) || list.length > 2000 || list.some((x) => typeof x !== 'string' || !SAFE_ID.test(x))) bad()
  if (p!.u !== undefined && (!Array.isArray(p!.u) || p!.u.some((x) => typeof x !== 'string' || x.length > 200))) bad()
  return {
    k: p!.k!,
    n: p!.n!,
    i: ICONS.includes(p!.i as BlockIcon) ? p!.i : 'chest',
    v: p!.v!,
    l: p!.l!,
    lv: p!.lv,
    m: p!.m!,
    d: p!.d ?? [],
    u: p!.u ?? [],
    f: p!.f === true
  }
}

function decode(code: string): Payload {
  const text = code.replace(/\s+/g, '')
  const start = text.indexOf(PREFIX)
  if (start < 0) throw new Error('Это не код BigBuncher: он начинается с «BB1-»')
  let json: unknown
  try {
    json = JSON.parse(inflateRawSync(Buffer.from(text.slice(start + PREFIX.length), 'base64url'), { maxOutputLength: 1 << 20 }).toString('utf8'))
  } catch {
    throw new Error('Код не читается: скорее всего, скопирован не полностью')
  }
  return validate(json)
}

function toPreview(p: Payload): SharePreview {
  return {
    kind: p.k === 'm' ? 'mod' : 'pack',
    name: p.n,
    mcVersion: p.v,
    loader: p.l,
    loaderVersion: p.lv,
    mods: p.m.length + (p.d?.length ?? 0) + (p.f ? (p.u?.length ?? 0) : 0),
    missing: p.f ? [] : (p.u ?? []),
    hasFiles: Boolean(p.f)
  }
}

export async function previewCode(code: string): Promise<SharePreview> {
  return toPreview(decode(code))
}

/* ---------------- installing ---------------- */

async function fetchVersions(ids: string[]): Promise<MrVersion[]> {
  const out: MrVersion[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    out.push(...(await fetchJson<MrVersion[]>(`${MODRINTH}/versions?ids=${encodeURIComponent(JSON.stringify(chunk))}`)))
  }
  return out
}

async function fetchTitles(projectIds: string[]): Promise<Map<string, { title: string; icon_url?: string }>> {
  const map = new Map<string, { title: string; icon_url?: string }>()
  const unique = [...new Set(projectIds)]
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    try {
      const res = await fetchJson<{ id: string; title: string; icon_url?: string }[]>(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`)
      for (const p of res) map.set(p.id, p)
    } catch {
      /* titles are cosmetic */
    }
  }
  return map
}

const safeJarName = (name: string): boolean => basename(name) === name && /\.jar$/i.test(name) && !/[\\/:*?"<>|]/.test(name)

/** Downloads exact Modrinth versions into an instance (4 at a time). Returns names that failed. */
async function downloadVersions(instanceId: string, enabled: string[], disabled: string[], report: TaskReporter): Promise<string[]> {
  const all = [...enabled, ...disabled]
  if (!all.length) return []
  report.update(-1, 'Получаю список модов с Modrinth')
  const versions = await fetchVersions(all)
  const titles = await fetchTitles(versions.map((v) => v.project_id))
  const off = new Set(disabled)
  const failed: string[] = all.filter((id) => !versions.some((v) => v.id === id)).map((id) => `версия ${id} (удалена с Modrinth)`)
  const dir = modsDir(instanceId)
  mkdirSync(dir, { recursive: true })

  let done = 0
  const queue = [...versions]
  const worker = async (): Promise<void> => {
    for (let v = queue.shift(); v; v = queue.shift()) {
      const title = titles.get(v.project_id)?.title ?? v.version_number
      const file = v.files.find((f) => f.primary) ?? v.files[0]
      try {
        if (!file || !safeJarName(file.filename) || !/^https:\/\/cdn\.modrinth\.com\//.test(file.url)) throw new Error('bad file')
        const target = join(dir, file.filename)
        await downloadFile(file.url, target)
        const sha1 = createHash('sha1').update(readFileSync(target)).digest('hex')
        if (file.hashes?.sha1 && sha1 !== file.hashes.sha1) {
          rmSync(target, { force: true })
          throw new Error('hash')
        }
        if (off.has(v.id)) renameSync(target, target + DISABLED)
        recordModFile(instanceId, file.filename, {
          provider: 'modrinth',
          projectId: v.project_id,
          title,
          version: v.version_number,
          iconUrl: titles.get(v.project_id)?.icon_url || undefined
        })
      } catch {
        failed.push(title)
      }
      report.update(++done / versions.length, title)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return failed
}

function uniqueName(name: string): string {
  const taken = new Set(listInstances().map((i) => i.name))
  if (!taken.has(name)) return name
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`)) return `${name} (${n})`
}

export interface ImportResult {
  instance: Instance
  /** Mods that could not be installed. */
  failed: string[]
}

/** New instance + its mods, downloaded while the loader installs. `withFiles` extracts the rest of a .bbpack. */
async function importPack(p: Payload, withFiles?: (instanceId: string) => Promise<void>): Promise<ImportResult> {
  const id = newInstanceId()
  const creating = createInstance(
    { name: uniqueName(p.n), icon: p.i ?? 'chest', mcVersion: p.v, loader: p.l, loaderVersion: p.lv },
    { id }
  )
  const mods = runTask(`Моды для «${p.n}»`, async (report) => {
    const failed = await downloadVersions(id, p.m, p.d ?? [], report)
    if (withFiles) {
      report.update(-1, 'Распаковываю конфиги и файлы')
      await withFiles(id)
    }
    return failed
  }, id)
  const [failedMods] = await Promise.all([mods, creating.catch(() => undefined)])
  const instance = await creating // surfaces an install error after the mods are on disk
  return { instance, failed: [...failedMods, ...(p.f ? [] : (p.u ?? []))] }
}

/** One mod into an existing instance: the exact version when it fits, otherwise the newest build that does. */
async function importMod(p: Payload, targetId: string): Promise<ImportResult> {
  const target = getInstance(targetId)
  if (target.loader === 'vanilla') throw new Error('Для модов нужна сборка с загрузчиком (Fabric, Forge, NeoForge, Quilt)')
  const [version] = await fetchVersions([...p.m, ...(p.d ?? [])])
  if (!version) throw new Error('Этого мода больше нет на Modrinth')
  const loaders = target.loader === 'quilt' ? ['quilt', 'fabric'] : [target.loader]
  const fits = version.game_versions.includes(target.mcVersion) && version.loaders.some((l) => loaders.includes(l))
  const failed: string[] = []
  await runTask('Установка мода по коду', async (report) => {
    if (fits) {
      failed.push(...(await downloadVersions(targetId, [version.id], [], report)))
      const have = new Set(Object.values(modIndex(targetId)).map((m) => m.projectId))
      for (const dep of version.dependencies) {
        if (dep.dependency_type !== 'required' || !dep.project_id || have.has(dep.project_id)) continue
        await installMod(targetId, 'modrinth', dep.project_id).catch(() => failed.push(`зависимость ${dep.project_id}`))
      }
    } else {
      report.update(-1, `Ищу версию для ${target.loader} ${target.mcVersion}`)
      await installMod(targetId, 'modrinth', version.project_id)
    }
  }, targetId)
  return { instance: getInstance(targetId), failed }
}

export async function importCode(code: string, targetInstanceId?: string): Promise<ImportResult> {
  const p = decode(code)
  if (p.k === 'm') {
    if (!targetInstanceId) throw new Error('Выбери сборку, в которую поставить мод')
    return importMod(p, targetInstanceId)
  }
  return importPack(p)
}

/* ---------------- pack files ---------------- */

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((ok, fail) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err || !zip ? fail(err ?? new Error('zip')) : ok(zip))))
}

/** Reads the manifest of a .bbpack without extracting anything. */
async function readManifest(file: string): Promise<Payload> {
  const zip = await openZip(file)
  return new Promise((ok, fail) => {
    let found = false
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName !== MANIFEST) return zip.readEntry()
      found = true
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err)
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => {
          zip.close()
          try {
            ok(validate(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
          } catch (e) {
            fail(e)
          }
        })
      })
    })
    zip.on('end', () => found || fail(new Error('Это не файл сборки BigBuncher')))
    zip.on('error', fail)
    zip.readEntry()
  })
}

/** Extracts mods/ and FILE_DIRS from a .bbpack into an instance (paths are checked: nothing outside it). */
async function extractFiles(file: string, instanceId: string): Promise<void> {
  const root = instanceDir(instanceId)
  const allowed = ['mods', ...FILE_DIRS]
  const zip = await openZip(file)
  await new Promise<void>((ok, fail) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName
      const target = resolve(root, name)
      const rel = relative(root, target)
      const top = rel.split(sep)[0]
      if (name.endsWith('/') || rel.startsWith('..') || !allowed.includes(top) || (top === 'mods' && !/\.jar(\.disabled)?$/i.test(name))) return zip.readEntry()
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err)
        mkdirSync(dirname(target), { recursive: true })
        pipeline(stream, createWriteStream(target)).then(() => zip.readEntry(), fail)
      })
    })
    zip.on('end', ok)
    zip.on('error', fail)
    zip.readEntry()
  })
}

/** Lets the user pick a .bbpack and shows what is inside. */
export async function openShareFile(): Promise<{ path: string; preview: SharePreview } | null> {
  const picked = await dialog.showOpenDialog({
    title: 'Открыть файл сборки',
    filters: [{ name: 'Сборка BigBuncher', extensions: ['bbpack'] }],
    properties: ['openFile']
  })
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return null
  return { path, preview: toPreview(await readManifest(path)) }
}

export async function importShareFile(path: string): Promise<ImportResult> {
  const p = await readManifest(path)
  return importPack({ ...p, k: 'p' }, (id) => extractFiles(path, id))
}
