import { app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Instance, NewInstanceRequest } from '../../shared/types'
import { emit } from '../core/events'
import { JsonStore } from '../core/jsonStore'
import { instanceDir } from '../core/paths'
import { runTask, type TaskReporter } from '../core/tasks'
import { installInstanceVersion } from '../minecraft/installService'
import { getSettings, updateSettings } from '../settings/settingsService'

/**
 * Instances ("сборки") = a Minecraft version + optional loader + its own game folder
 * (mods, saves, config) in <gameDir>/instances/<id>. Versions/libraries/assets are shared.
 */
let store: JsonStore<{ instances: Instance[] }> | undefined
const getStore = (): JsonStore<{ instances: Instance[] }> =>
  (store ??= new JsonStore(join(app.getPath('userData'), 'instances.json'), () => ({ instances: [] })))

const busy = new Set<string>()

/**
 * Installs run one at a time: two installs of the same loader would write the same
 * libraries and run Forge processors on the same files concurrently.
 */
let installQueue: Promise<unknown> = Promise.resolve()
function queued<T>(work: () => Promise<T>, report: TaskReporter): Promise<T> {
  report.update(-1, 'В очереди: ждёт окончания другой установки')
  const run = installQueue.then(work, work)
  installQueue = run.catch(() => undefined)
  return run
}

function notify(): void {
  emit('instancesChanged', listInstances())
}

export function listInstances(): Instance[] {
  return [...getStore().get().instances].sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt))
}

export function getInstance(id: string): Instance {
  const found = getStore().get().instances.find((i) => i.id === id)
  if (!found) throw new Error('Сборка не найдена')
  return found
}

export function patchInstance(id: string, patch: Partial<Instance>): Instance {
  getStore().update((data) => {
    const target = data.instances.find((i) => i.id === id)
    if (target) Object.assign(target, patch)
  })
  notify()
  return getInstance(id)
}

/** Registers an already prepared instance (its folder must exist) without installing anything. */
export function addInstanceRecord(instance: Instance): Instance {
  getStore().update((data) => {
    data.instances.push(instance)
  })
  notify()
  return instance
}

export const newInstanceId = (): string => randomUUID().slice(0, 8)

export async function createInstance(req: NewInstanceRequest, extra: Partial<Instance> = {}): Promise<Instance> {
  const name = req.name.trim() || defaultName(req)
  const instance: Instance = {
    id: newInstanceId(),
    name,
    icon: req.icon,
    mcVersion: req.mcVersion,
    loader: req.loader,
    loaderVersion: req.loader === 'vanilla' ? undefined : req.loaderVersion,
    versionId: req.mcVersion,
    installed: false,
    createdAt: Date.now(),
    ...extra
  }
  mkdirSync(join(instanceDir(instance.id), 'mods'), { recursive: true })
  getStore().update((data) => {
    data.instances.push(instance)
  })
  updateSettings({ selectedInstanceId: instance.id })
  notify()
  await installInstance(instance.id)
  return getInstance(instance.id)
}

/** (Re)installs every file of an instance. Used on creation, by "repair" and before the first launch. */
export async function installInstance(id: string): Promise<{ javaPath: string }> {
  if (busy.has(id)) throw new Error('Эта сборка уже устанавливается')
  busy.add(id)
  try {
    const instance = getInstance(id)
    const result = await runTask(`Установка «${instance.name}»`, (report) => queued(() => installInstanceVersion(instance, report), report), id)
    patchInstance(id, { versionId: result.versionId, installed: true })
    return result
  } finally {
    busy.delete(id)
  }
}

export function isInstanceBusy(id: string): boolean {
  return busy.has(id)
}

export function renameInstance(id: string, name: string): Instance {
  if (!name.trim()) throw new Error('Название не может быть пустым')
  return patchInstance(id, { name: name.trim() })
}

/** Removes an instance. Its folder (worlds!) goes to the Recycle Bin, so a mistaken click is recoverable. */
export async function removeInstance(id: string): Promise<void> {
  if (busy.has(id)) throw new Error('Дождитесь окончания установки')
  const dir = instanceDir(id)
  if (existsSync(dir)) await shell.trashItem(dir)
  getStore().update((data) => {
    data.instances = data.instances.filter((i) => i.id !== id)
  })
  if (getSettings().selectedInstanceId === id) updateSettings({ selectedInstanceId: listInstances()[0]?.id })
  notify()
}

export async function openInstanceFolder(id: string): Promise<void> {
  const dir = instanceDir(getInstance(id).id)
  mkdirSync(dir, { recursive: true })
  await shell.openPath(dir)
}

export function selectInstance(id: string): void {
  getInstance(id)
  updateSettings({ selectedInstanceId: id })
}

function defaultName(req: NewInstanceRequest): string {
  const loader = req.loader === 'vanilla' ? '' : ` ${req.loader[0].toUpperCase()}${req.loader.slice(1)}`
  return `${req.mcVersion}${loader}`
}
