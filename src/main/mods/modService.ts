import { L } from '../core/i18n'
import { dialog, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { InstalledMod, ModProviderId, ModProviderInfo, ModSearchQuery, ModSearchResult } from '../../shared/types'
import { downloadFile } from '../core/http'
import { JsonStore } from '../core/jsonStore'
import { instanceDir } from '../core/paths'
import { runTask } from '../core/tasks'
import { getInstance } from '../instances/instanceService'
import { curseforgeProvider } from './providers/curseforgeProvider'
import { modrinthProvider } from './providers/modrinthProvider'
import type { ModProvider, ResolvedModFile } from './providers/types'

/** Registered mod platforms. */
const PROVIDERS: ModProvider[] = [modrinthProvider, curseforgeProvider]

const DISABLED_SUFFIX = '.disabled'

type ModMeta = Omit<ResolvedModFile, 'url' | 'dependencies' | 'fileName'>
type ModIndex = { files: Record<string, ModMeta> }

const modsDir = (instanceId: string): string => join(instanceDir(instanceId), 'mods')

/** Per-instance index (mods/../bigbuncher-mods.json) remembering where each jar came from. */
const indexStore = (instanceId: string): JsonStore<ModIndex> =>
  new JsonStore(join(instanceDir(instanceId), 'bigbuncher-mods.json'), () => ({ files: {} }))

function getProvider(id: ModProviderId): ModProvider {
  const provider = PROVIDERS.find((p) => p.id === id)
  if (!provider) throw new Error(`Неизвестная площадка: ${id}`)
  const { available, reason } = provider.availability()
  if (!available) throw new Error(reason ?? `${provider.name} недоступен`)
  return provider
}

function moddableInstance(instanceId: string) {
  const instance = getInstance(instanceId)
  if (instance.loader === 'vanilla') throw new Error('Для модов нужна сборка с Forge, Fabric, NeoForge или Quilt')
  return instance
}

export function listProviders(): ModProviderInfo[] {
  return PROVIDERS.map((p) => ({ id: p.id, name: p.name, ...p.availability() }))
}

export function searchMods(query: ModSearchQuery): Promise<ModSearchResult> {
  return getProvider(query.provider).search(query)
}

export function listInstalledMods(instanceId: string): InstalledMod[] {
  const dir = modsDir(instanceId)
  if (!existsSync(dir)) return []
  const index = indexStore(instanceId).get().files
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith(`.jar${DISABLED_SUFFIX}`))
    .map((file) => {
      const fileName = file.replace(DISABLED_SUFFIX, '')
      const meta = index[fileName]
      return {
        fileName,
        enabled: !file.endsWith(DISABLED_SUFFIX),
        title: meta?.title ?? fileName.replace(/\.jar$/, ''),
        version: meta?.version,
        provider: meta?.provider,
        projectId: meta?.projectId,
        iconUrl: meta?.iconUrl,
        sizeBytes: statSync(join(dir, file)).size
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Downloads a mod and, recursively, its required dependencies that are not installed yet. */
export async function installMod(instanceId: string, providerId: ModProviderId, projectId: string): Promise<InstalledMod[]> {
  const instance = moddableInstance(instanceId)
  const provider = getProvider(providerId)
  const store = indexStore(instanceId)
  const installedProjects = new Set(Object.values(store.get().files).map((m) => `${m.provider}:${m.projectId}`))

  await runTask('Установка мода', async (report) => {
    const queue = [projectId]
    const seen = new Set<string>()
    while (queue.length) {
      const id = queue.shift()!
      if (seen.has(id)) continue
      seen.add(id)
      const isRoot = id === projectId
      if (!isRoot && installedProjects.has(`${providerId}:${id}`)) continue

      const file = await provider.resolveFile(id, instance.mcVersion, instance.loader)
      report.update(0, isRoot ? file.title : `Зависимость: ${file.title}`)
      removeOldFilesOfProject(instanceId, store, file)
      await downloadFile(file.url, join(modsDir(instanceId), file.fileName), (got, total) =>
        report.update(total ? got / total : -1)
      )
      const { url: _url, dependencies, fileName, ...meta } = file
      store.update((data) => {
        data.files[fileName] = meta
      })
      queue.push(...dependencies)
    }
  })
  return listInstalledMods(instanceId)
}

function removeOldFilesOfProject(instanceId: string, store: JsonStore<ModIndex>, file: ResolvedModFile): void {
  for (const [name, meta] of Object.entries(store.get().files)) {
    if (meta.provider === file.provider && meta.projectId === file.projectId && name !== file.fileName) {
      deleteModFiles(instanceId, name)
      store.update((data) => {
        delete data.files[name]
      })
    }
  }
}

function deleteModFiles(instanceId: string, fileName: string): void {
  const file = join(modsDir(instanceId), basename(fileName))
  rmSync(file, { force: true })
  rmSync(file + DISABLED_SUFFIX, { force: true })
}

export function setModEnabled(instanceId: string, fileName: string, enabled: boolean): InstalledMod[] {
  const dir = modsDir(instanceId)
  const on = join(dir, fileName)
  const off = on + DISABLED_SUFFIX
  if (enabled && existsSync(off)) renameSync(off, on)
  if (!enabled && existsSync(on)) renameSync(on, off)
  return listInstalledMods(instanceId)
}

export function removeMod(instanceId: string, fileName: string): InstalledMod[] {
  deleteModFiles(instanceId, fileName)
  indexStore(instanceId).update((data) => {
    delete data.files[fileName]
  })
  return listInstalledMods(instanceId)
}

export async function addModsFromFiles(instanceId: string): Promise<InstalledMod[]> {
  moddableInstance(instanceId)
  const picked = await dialog.showOpenDialog({
    title: L('Добавить моды'),
    filters: [{ name: L('Моды Minecraft'), extensions: ['jar'] }],
    properties: ['openFile', 'multiSelections']
  })
  mkdirSync(modsDir(instanceId), { recursive: true })
  for (const file of picked.filePaths) copyFileSync(file, join(modsDir(instanceId), basename(file)))
  return listInstalledMods(instanceId)
}

export async function openModsFolder(instanceId: string): Promise<void> {
  mkdirSync(modsDir(instanceId), { recursive: true })
  await shell.openPath(modsDir(instanceId))
}
