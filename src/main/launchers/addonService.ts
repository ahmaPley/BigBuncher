import { app, BrowserWindow, dialog, shell } from 'electron'
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import yauzl from 'yauzl'
import yazl from 'yazl'
import type { AddonFile, AvailableAddon, LauncherInfo } from '../../shared/types'
import { emit } from '../core/events'
import { launcherDir, launchersDir } from '../core/paths'
import { getManifest, installLauncherFromFile, listLaunchers } from './launcherService'
import { PLUGIN_GUIDE, TEMPLATES } from './addonTemplates'

/**
 * «Дополнения» — plugins (zip launchers): find zips on the PC, share an installed one as a zip,
 * create one from a template, edit its files in BigBuncher with a live preview (hot reload).
 */

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/
const TEXT_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg'])
const RELOAD_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg'])
const MAX_TEXT = 512 * 1024

/* ---------- other plugins on this PC ---------- */

function folders(): string[] {
  const out = [join(app.getPath('downloads')), join(app.getPath('desktop'), 'BigBuncher', 'Лаунчеры')]
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (exe) out.push(join(dirname(exe), 'Лаунчеры'), dirname(exe))
  return [...new Set(out)].filter((d) => existsSync(d))
}

/** Reads launcher.json from a zip (root or one folder deep) without unpacking it. */
function peekManifest(file: string): Promise<Record<string, unknown> | null> {
  return new Promise((ok) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return ok(null)
      let done = false
      const finish = (v: Record<string, unknown> | null): void => {
        if (done) return
        done = true
        zip.close()
        ok(v)
      }
      zip.on('entry', (entry: yauzl.Entry) => {
        if (/^([^/]+\/)?launcher\.json$/.test(entry.fileName) && entry.uncompressedSize < 64 * 1024) {
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return finish(null)
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => {
              try {
                finish(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '')) as Record<string, unknown>)
              } catch {
                finish(null)
              }
            })
          })
        } else zip.readEntry()
      })
      zip.on('end', () => finish(null))
      zip.on('error', () => finish(null))
      zip.readEntry()
    })
  })
}

export async function listAvailableAddons(): Promise<AvailableAddon[]> {
  const installed = new Map(listLaunchers().map((l) => [l.id, l.version]))
  const out = new Map<string, AvailableAddon>()
  for (const dir of folders()) {
    let names: string[]
    try {
      names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.zip'))
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(dir, name)
      const m = await peekManifest(file)
      const id = typeof m?.id === 'string' ? m.id : ''
      if (!m || !ID_RE.test(id) || typeof m.name !== 'string') continue
      const version = typeof m.version === 'string' ? m.version : '0.0.0'
      const prev = out.get(id)
      if (prev && statSync(prev.file).mtimeMs >= statSync(file).mtimeMs) continue
      out.set(id, {
        file,
        id,
        name: m.name,
        version,
        author: typeof m.author === 'string' ? m.author : '—',
        description: typeof m.description === 'string' ? m.description : '',
        installedVersion: installed.get(id)
      })
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function installAddonFiles(files: string[]): Promise<LauncherInfo[]> {
  const known = new Set((await listAvailableAddons()).map((a) => a.file))
  const done: LauncherInfo[] = []
  for (const file of files) {
    // only zips the list showed — the renderer can't make BigBuncher unpack an arbitrary path
    if (!known.has(file)) throw new Error(`Не найден архив ${file}`)
    const info = await installLauncherFromFile(file, false)
    if (info) done.push(info)
  }
  return done
}

/* ---------- share ---------- */

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(root, full, out)
    else out.push(relative(root, full))
  }
  return out
}

/** Zips the installed plugin (the same format «Установить из ZIP» takes) and returns the file. */
export async function exportAddon(id: string): Promise<string | null> {
  const m = getManifest(id)
  const win = BrowserWindow.getAllWindows()[0]
  const res = await dialog.showSaveDialog(win, {
    title: 'Поделиться дополнением',
    defaultPath: join(app.getPath('desktop'), `${m.name.replace(/[\\/:*?"<>|]/g, '_')} ${m.version}.zip`),
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (res.canceled || !res.filePath) return null
  const zip = new yazl.ZipFile()
  const root = launcherDir(id)
  for (const rel of walk(root)) zip.addFile(join(root, rel), rel.split(sep).join('/'))
  zip.end()
  await new Promise<void>((ok, fail) => {
    const out = createWriteStream(res.filePath!)
    zip.outputStream.pipe(out).on('close', ok).on('error', fail)
  })
  shell.showItemInFolder(res.filePath)
  return res.filePath
}

/* ---------- create ---------- */

export function createAddon(template: string, name: string): LauncherInfo {
  const title = name.trim() || 'Мой плагин'
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'plugin'
  let id = base.length >= 2 ? base : `${base}-plugin`
  for (let n = 2; existsSync(launcherDir(id)); n++) id = `${base}-${n}`
  const dest = launcherDir(id)
  mkdirSync(launchersDir(), { recursive: true })

  if (template.startsWith('copy:')) {
    const from = template.slice(5)
    getManifest(from)
    cpSync(launcherDir(from), dest, { recursive: true })
    const file = join(dest, 'launcher.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>
    writeFileSync(file, JSON.stringify({ ...manifest, id, name: title, version: '0.1.0' }, null, 2))
  } else {
    const files = TEMPLATES[template]
    if (!files) throw new Error('Нет такой заготовки')
    for (const [rel, text] of Object.entries(files({ id, name: title }))) {
      mkdirSync(dirname(join(dest, rel)), { recursive: true })
      writeFileSync(join(dest, rel), text)
    }
  }
  writeFileSync(join(dest, 'ИНСТРУКЦИЯ-ДЛЯ-ИИ.md'), PLUGIN_GUIDE)
  const list = listLaunchers()
  emit('launchersChanged', list)
  const info = list.find((l) => l.id === id)
  if (!info) throw new Error('Заготовка не создалась')
  return info
}

/* ---------- editor ---------- */

function safePath(id: string, rel: string): string {
  getManifest(id)
  const root = launcherDir(id)
  const full = resolve(root, rel)
  const r = relative(root, full)
  if (!r || r.startsWith('..') || resolve(full) === resolve(root)) throw new Error('Недопустимый путь')
  return full
}

export function listAddonFiles(id: string): AddonFile[] {
  getManifest(id)
  const root = launcherDir(id)
  return walk(root)
    .map((rel) => ({ path: rel.split(sep).join('/'), size: statSync(join(root, rel)).size }))
    .map((f) => ({ ...f, editable: TEXT_EXT.has(extname(f.path).toLowerCase()) && f.size <= MAX_TEXT }))
    .sort((a, b) => Number(b.editable) - Number(a.editable) || a.path.localeCompare(b.path))
}

export function readAddonFile(id: string, rel: string): string {
  const full = safePath(id, rel)
  if (!TEXT_EXT.has(extname(full).toLowerCase())) throw new Error('Этот файл не текстовый')
  if (statSync(full).size > MAX_TEXT) throw new Error('Файл слишком большой для редактора')
  return readFileSync(full, 'utf8')
}

export function writeAddonFile(id: string, rel: string, text: string): void {
  const full = safePath(id, rel)
  if (!TEXT_EXT.has(extname(full).toLowerCase())) throw new Error('Можно сохранять только текстовые файлы')
  if (rel === 'launcher.json') {
    // a broken manifest would make the plugin disappear from the list — refuse instead
    try {
      const m = JSON.parse(text) as { id?: unknown }
      if (m.id !== id) throw new Error(`id в launcher.json должен остаться «${id}»`)
    } catch (err) {
      throw new Error(err instanceof SyntaxError ? `launcher.json: ${err.message}` : (err as Error).message)
    }
  }
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text)
  if (rel === 'launcher.json') emit('launchersChanged', listLaunchers())
}

export async function openAddonFolder(id: string): Promise<void> {
  getManifest(id)
  await shell.openPath(launcherDir(id))
}

/** Writes the AI instruction file into the plugin folder and shows it. */
export function addonGuide(id: string): string {
  getManifest(id)
  const file = join(launcherDir(id), 'ИНСТРУКЦИЯ-ДЛЯ-ИИ.md')
  writeFileSync(file, PLUGIN_GUIDE)
  shell.showItemInFolder(file)
  return file
}

/* ---------- hot reload: «изменения видны сразу» ---------- */

const watchers = new Map<string, FSWatcher>()
const timers = new Map<string, NodeJS.Timeout>()

/** Watches the plugins whose interface is on screen; a saved html/css/js/json reloads them. */
export function watchAddons(ids: string[]): void {
  const want = new Set(ids.filter((id) => ID_RE.test(id) && existsSync(launcherDir(id))))
  for (const [id, w] of watchers) {
    if (!want.has(id)) {
      w.close()
      watchers.delete(id)
    }
  }
  for (const id of want) {
    if (watchers.has(id)) continue
    try {
      const w = watch(launcherDir(id), { recursive: true }, (_e, file) => {
        if (!file || !RELOAD_EXT.has(extname(String(file)).toLowerCase())) return
        clearTimeout(timers.get(id))
        timers.set(
          id,
          setTimeout(() => emit('addonChanged', { id, file: String(file).split(sep).join('/') }), 250)
        )
      })
      w.on('error', () => watchers.delete(id))
      watchers.set(id, w)
    } catch {
      /* folder vanished */
    }
  }
}
