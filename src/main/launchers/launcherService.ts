import { BrowserWindow, dialog, nativeImage, shell } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { MINECRAFT_LAUNCHER_ID, type LauncherInfo, type Settings } from '../../shared/types'
import { L } from '../core/i18n'
import { emit } from '../core/events'
import { launcherDir, launchersDir } from '../core/paths'
import { getSettings, updateSettings } from '../settings/settingsService'

/** launcher.json at the root of a launcher zip. */
export interface LauncherManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  /** Page of the launcher's interface, relative to its folder. */
  entry: string
  /** Optional program the interface can run through the bridge (`backend`), relative to its folder. */
  backend?: string
  accent: string
  icons: { key: string; name: string; path: string }[]
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/
const MANIFEST = 'launcher.json'
const MAX_ENTRIES = 5000
const MAX_BYTES = 512 * 1024 * 1024

export const launcherUrl = (id: string, path: string): string =>
  `bblauncher://${id}/${path.split(/[\\/]/).map(encodeURIComponent).join('/')}`

/** True when `path` (relative to `root`) stays inside it. */
function inside(root: string, path: string): boolean {
  const rel = relative(root, resolve(root, path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function readManifest(dir: string): LauncherManifest {
  const file = join(dir, MANIFEST)
  if (!existsSync(file)) throw new Error('В архиве нет launcher.json — это не лаунчер для BigBuncher')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>
  } catch {
    throw new Error('launcher.json повреждён')
  }
  const str = (k: string, def?: string): string => {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (def !== undefined) return def
    throw new Error(`В launcher.json нет поля «${k}»`)
  }
  const relFile = (p: string): string => {
    if (!inside(dir, p) || !existsSync(join(dir, p))) throw new Error(`В архиве лаунчера нет файла ${p}`)
    return p
  }
  // Icons may appear later: a launcher can build them on first run (e.g. from the player's own game files).
  const relPath = (p: string): string => {
    if (!inside(dir, p)) throw new Error(`В архиве лаунчера нет файла ${p}`)
    return p
  }

  const id = str('id')
  if (!ID_RE.test(id) || id === MINECRAFT_LAUNCHER_ID) throw new Error(`Недопустимый id лаунчера: ${id}`)
  const icons = (Array.isArray(raw.icons) ? raw.icons : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => ({ key: String(i.key ?? ''), name: String(i.name ?? i.key ?? ''), path: String(i.path ?? '') }))
    .filter((i) => /^[a-z0-9_-]{1,40}$/i.test(i.key) && i.path)
    .map((i) => ({ ...i, path: relPath(i.path) }))
  if (icons.length === 0) throw new Error('В launcher.json нет иконок (icons)')

  const backend = typeof raw.backend === 'string' && raw.backend ? relFile(raw.backend) : undefined
  const accent = str('accent', '#4cba4a')
  return {
    id,
    name: str('name'),
    version: str('version', '0.0.0'),
    author: str('author', '—'),
    description: str('description', ''),
    entry: relFile(str('entry')),
    backend,
    accent: /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#4cba4a',
    icons
  }
}

/** Bumped by refreshLauncherIcons so icon URLs change and the page reloads the new files. */
const iconVersions = new Map<string, number>()

const toInfo = (m: LauncherManifest): LauncherInfo => {
  const v = iconVersions.get(m.id)
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    author: m.author,
    description: m.description,
    accent: m.accent,
    entryUrl: launcherUrl(m.id, m.entry),
    icons: m.icons.map((i) => ({ key: i.key, name: i.name, url: launcherUrl(m.id, i.path) + (v ? `?v=${v}` : '') }))
  }
}

/** A launcher changed its icon files (built them on first run) — show the new ones. */
export function refreshLauncherIcons(id: string): void {
  getManifest(id)
  iconVersions.set(id, Date.now())
  emit('launchersChanged', listLaunchers())
}

/** Manifest of an installed launcher (throws if it is not installed or broken). */
export function getManifest(id: string): LauncherManifest {
  if (!ID_RE.test(id)) throw new Error('Неизвестный лаунчер')
  return readManifest(launcherDir(id))
}

export function listLaunchers(): LauncherInfo[] {
  const root = launchersDir()
  if (!existsSync(root)) return []
  const out: LauncherInfo[] = []
  for (const name of readdirSync(root)) {
    if (!ID_RE.test(name)) continue
    try {
      const m = readManifest(join(root, name))
      if (m.id === name) out.push(toInfo(m))
    } catch (err) {
      console.warn(`[launchers] ${name} skipped:`, err)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((ok, fail) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err || !zip ? fail(err ?? new Error('zip')) : ok(zip))))
}

/** Extracts a zip into `target`; entries that would land outside it are refused. */
async function extractZip(file: string, target: string): Promise<void> {
  const zip = await openZip(file)
  let count = 0
  let bytes = 0
  await new Promise<void>((ok, fail) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      if (++count > MAX_ENTRIES || (bytes += entry.uncompressedSize) > MAX_BYTES) {
        zip.close()
        return fail(new Error('Архив лаунчера слишком большой'))
      }
      if (entry.fileName.endsWith('/')) return zip.readEntry()
      if (!inside(target, entry.fileName)) {
        zip.close()
        return fail(new Error('В архиве есть файлы с недопустимыми путями'))
      }
      const out = resolve(target, entry.fileName)
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err ?? new Error('zip'))
        mkdirSync(dirname(out), { recursive: true })
        pipeline(stream, createWriteStream(out)).then(() => zip.readEntry(), fail)
      })
    })
    zip.on('end', ok)
    zip.on('error', fail)
    zip.readEntry()
  })
}

/** Zips often wrap everything in one folder — the launcher root is wherever launcher.json is. */
function findRoot(dir: string): string {
  if (existsSync(join(dir, MANIFEST))) return dir
  const subs = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory())
  if (subs.length === 1 && existsSync(join(dir, subs[0], MANIFEST))) return join(dir, subs[0])
  return dir
}

export async function installLauncherZip(): Promise<LauncherInfo | null> {
  const win = BrowserWindow.getAllWindows()[0]
  const pick = await dialog.showOpenDialog(win, {
    title: L('Лаунчер (.zip)'),
    properties: ['openFile'],
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  const file = pick.filePaths[0]
  if (pick.canceled || !file) return null
  return installLauncherFromFile(file, true)
}

/** Installs a launcher zip; `ask` = confirm with the user first (the test installs without asking). */
export async function installLauncherFromFile(file: string, ask: boolean): Promise<LauncherInfo | null> {
  const win = BrowserWindow.getAllWindows()[0]
  mkdirSync(launchersDir(), { recursive: true })
  const tmp = join(launchersDir(), `.install-${Date.now()}`)
  try {
    await extractZip(file, tmp)
    const root = findRoot(tmp)
    const m = readManifest(root)

    if (ask) {
      const options = {
        type: 'question' as const,
        buttons: [L('Установить'), L('Отмена')],
        defaultId: 0,
        cancelId: 1,
        title: 'BigBuncher',
        message: L(`Установить лаунчер «${m.name}» ${m.version}?`),
        detail: L(`Автор: ${m.author}.`) + (m.backend ? '\n' + L(`В лаунчере есть программа ${m.backend}. Ставьте лаунчеры только от тех, кому доверяете.`) : '')
      }
      const answer = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      if (answer.response !== 0) return null
    }

    const dest = launcherDir(m.id)
    if (existsSync(dest)) await shell.trashItem(dest)
    renameSync(root, dest)
    emit('launchersChanged', listLaunchers())
    return toInfo(m)
  } finally {
    if (existsSync(tmp)) await shell.trashItem(tmp).catch(() => undefined)
  }
}

export async function removeLauncher(id: string): Promise<LauncherInfo[]> {
  getManifest(id)
  if (getSettings().activeLauncher === id) updateSettings({ activeLauncher: MINECRAFT_LAUNCHER_ID })
  await shell.trashItem(launcherDir(id))
  const list = listLaunchers()
  emit('launchersChanged', list)
  return list
}

export function activateLauncher(id: string): Settings {
  if (id !== MINECRAFT_LAUNCHER_ID) getManifest(id)
  return updateSettings({ activeLauncher: id })
}

export function setLauncherIcon(id: string, key: string): Settings {
  if (id !== MINECRAFT_LAUNCHER_ID && !getManifest(id).icons.some((i) => i.key === key)) throw new Error('Нет такой иконки')
  return updateSettings({ launcherIcons: { ...getSettings().launcherIcons, [id]: key } })
}

export function setWindowIcon(dataUrl: string): void {
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('bad icon')
  const img = nativeImage.createFromDataURL(dataUrl)
  if (img.isEmpty()) return
  for (const win of BrowserWindow.getAllWindows()) win.setIcon(img)
}

/** Absolute path of the launcher's backend program, if it has one. */
export function backendPath(id: string): string {
  const m = getManifest(id)
  if (!m.backend) throw new Error('У этого лаунчера нет программы')
  return join(launcherDir(id), ...m.backend.split(/[\\/]/))
}

export const launcherRoot = (id: string): string => launcherDir(id) + sep
