import { L } from '../core/i18n'
import { dialog, shell } from 'electron'
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ResourcePack } from '../../shared/types'
import { JsonStore } from '../core/jsonStore'
import { gameDir, instanceDir } from '../core/paths'
import { getInstance } from '../instances/instanceService'
import { readPackMeta } from './packReader'

/**
 * Resource packs ("текстурпаки"):
 *  - shared packs live in <gameDir>/shared/resourcepacks and are linked into every instance on launch;
 *  - instance packs live in <instance>/resourcepacks as usual.
 * Shared packs marked "auto-enable" are switched on in options.txt, including packs made for other
 * versions (listed as incompatible-but-allowed, so the game does not ask).
 */
const sharedDir = (): string => join(gameDir(), 'shared', 'resourcepacks')
const instancePacksDir = (id: string): string => join(instanceDir(getInstance(id).id), 'resourcepacks')
const SYNC_MARKER = '.bigbuncher-shared.json'

const settingsStore = (): JsonStore<{ autoEnable: string[] }> =>
  new JsonStore(join(gameDir(), 'shared', 'resourcepacks.json'), () => ({ autoEnable: [] }))

const isPack = (dir: string, name: string): boolean =>
  name.toLowerCase().endsWith('.zip') || (statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, 'pack.mcmeta')))

async function describe(dir: string, name: string, shared: boolean, autoEnable: string[]): Promise<ResourcePack> {
  const path = join(dir, name)
  const meta = await readPackMeta(path)
  const stat = statSync(path)
  return {
    fileName: name,
    title: name.replace(/\.zip$/i, ''),
    description: meta.description,
    packFormat: meta.packFormat,
    iconDataUrl: meta.iconDataUrl,
    sizeBytes: stat.isDirectory() ? 0 : stat.size,
    shared,
    autoEnable: autoEnable.includes(name)
  }
}

async function listDir(dir: string, shared: boolean, exclude: string[] = []): Promise<ResourcePack[]> {
  if (!existsSync(dir)) return []
  const auto = settingsStore().get().autoEnable
  const names = readdirSync(dir).filter((n) => !n.startsWith('.') && !exclude.includes(n) && isPack(dir, n))
  return Promise.all(names.sort((a, b) => a.localeCompare(b)).map((n) => describe(dir, n, shared, auto)))
}

async function pickPacks(title: string): Promise<string[]> {
  const res = await dialog.showOpenDialog({
    title,
    filters: [{ name: L('Текстурпаки (.zip)'), extensions: ['zip'] }],
    properties: ['openFile', 'multiSelections']
  })
  return res.canceled ? [] : res.filePaths
}

export function listSharedPacks(): Promise<ResourcePack[]> {
  return listDir(sharedDir(), true)
}

export async function addSharedPacks(): Promise<ResourcePack[]> {
  mkdirSync(sharedDir(), { recursive: true })
  for (const file of await pickPacks('Добавить общие текстурпаки')) copyFileSync(file, join(sharedDir(), basename(file)))
  return listSharedPacks()
}

export async function removeSharedPack(fileName: string): Promise<ResourcePack[]> {
  const path = join(sharedDir(), basename(fileName))
  if (existsSync(path)) await shell.trashItem(path)
  settingsStore().update((s) => {
    s.autoEnable = s.autoEnable.filter((n) => n !== fileName)
  })
  return listSharedPacks()
}

export async function setSharedAutoEnable(fileName: string, enabled: boolean): Promise<ResourcePack[]> {
  settingsStore().update((s) => {
    s.autoEnable = [...s.autoEnable.filter((n) => n !== fileName), ...(enabled ? [fileName] : [])]
  })
  return listSharedPacks()
}

/** Packs of one instance, without the copies synced from the shared folder. */
export function listInstancePacks(instanceId: string): Promise<ResourcePack[]> {
  const dir = instancePacksDir(instanceId)
  return listDir(dir, false, readSynced(dir))
}

export async function addInstancePacks(instanceId: string): Promise<ResourcePack[]> {
  const dir = instancePacksDir(instanceId)
  mkdirSync(dir, { recursive: true })
  for (const file of await pickPacks('Добавить текстурпаки в сборку')) copyFileSync(file, join(dir, basename(file)))
  return listInstancePacks(instanceId)
}

export async function removeInstancePack(instanceId: string, fileName: string): Promise<ResourcePack[]> {
  const path = join(instancePacksDir(instanceId), basename(fileName))
  if (existsSync(path)) await shell.trashItem(path)
  return listInstancePacks(instanceId)
}

export async function openSharedPacksFolder(): Promise<void> {
  mkdirSync(sharedDir(), { recursive: true })
  await shell.openPath(sharedDir())
}

export async function openInstancePacksFolder(instanceId: string): Promise<void> {
  mkdirSync(instancePacksDir(instanceId), { recursive: true })
  await shell.openPath(instancePacksDir(instanceId))
}

function readSynced(dir: string): string[] {
  try {
    return JSON.parse(readFileSync(join(dir, SYNC_MARKER), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Called before launch: links shared packs into the instance (hard link, falls back to copy),
 * drops ones removed from the shared folder, and enables the auto-enable ones in options.txt.
 */
export function syncSharedPacksIntoInstance(instanceId: string): void {
  const src = sharedDir()
  const dst = join(instanceDir(instanceId), 'resourcepacks')
  const shared = existsSync(src) ? readdirSync(src).filter((n) => n.toLowerCase().endsWith('.zip')) : []
  const previouslySynced = readSynced(dst)
  if (!shared.length && !previouslySynced.length) return
  mkdirSync(dst, { recursive: true })

  for (const name of previouslySynced) if (!shared.includes(name)) rmSync(join(dst, name), { force: true })
  for (const name of shared) {
    const target = join(dst, name)
    if (existsSync(target)) continue
    try {
      linkSync(join(src, name), target)
    } catch {
      copyFileSync(join(src, name), target)
    }
  }
  writeFileSync(join(dst, SYNC_MARKER), JSON.stringify(shared))

  const auto = settingsStore().get().autoEnable.filter((n) => shared.includes(n))
  enableInOptions(join(instanceDir(instanceId), 'options.txt'), auto.map((n) => `file/${n}`))
}

/** Adds packs to resourcePacks (and incompatibleResourcePacks, so other-version packs load silently). */
function enableInOptions(optionsFile: string, packs: string[]): void {
  if (!packs.length) return
  const lines = existsSync(optionsFile) ? readFileSync(optionsFile, 'utf8').split(/\r?\n/) : []
  const update = (key: string, base: string[]): void => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    let list: string[] = base
    if (i >= 0) {
      try {
        list = JSON.parse(lines[i].slice(key.length + 1))
      } catch {
        /* keep base */
      }
    }
    for (const p of packs) if (!list.includes(p)) list.push(p)
    const line = `${key}:${JSON.stringify(list)}`
    if (i >= 0) lines[i] = line
    else lines.push(line)
  }
  update('resourcePacks', ['vanilla'])
  update('incompatibleResourcePacks', [])
  writeFileSync(optionsFile, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n')
}
