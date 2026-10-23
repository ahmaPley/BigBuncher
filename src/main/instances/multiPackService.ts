import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Instance, MultiPack, NewStateRequest } from '../../shared/types'
import { emit } from '../core/events'
import { JsonStore } from '../core/jsonStore'
import { instanceDir } from '../core/paths'
import { updateSettings } from '../settings/settingsService'
import { addInstanceRecord, createInstance, getInstance, isInstanceBusy, listInstances, newInstanceId, patchInstance, removeInstance } from './instanceService'

/**
 * Multi-packs ("мультисборки"): a named group of instances, each one a "state".
 * Only the active state is shown/launched; switching states is instant because every
 * state keeps its own folder (mods, configs, worlds) and version.
 */
let store: JsonStore<{ packs: MultiPack[] }> | undefined
const getStore = (): JsonStore<{ packs: MultiPack[] }> =>
  (store ??= new JsonStore(join(app.getPath('userData'), 'multipacks.json'), () => ({ packs: [] })))

function notify(): void {
  emit('multiPacksChanged', listMultiPacks())
}

export function listMultiPacks(): MultiPack[] {
  return getStore().get().packs
}

function getPack(id: string): MultiPack {
  const pack = listMultiPacks().find((p) => p.id === id)
  if (!pack) throw new Error('Мультисборка не найдена')
  return pack
}

const statesOf = (packId: string): Instance[] => listInstances().filter((i) => i.multiPackId === packId)

function patchPack(id: string, patch: Partial<MultiPack>): MultiPack {
  getStore().update((data) => {
    const p = data.packs.find((x) => x.id === id)
    if (p) Object.assign(p, patch)
  })
  notify()
  return getPack(id)
}

/** Turns an ordinary instance into the first state of a new multi-pack. */
export function createMultiPack(fromInstanceId: string, name: string): MultiPack {
  const base = getInstance(fromInstanceId)
  if (base.multiPackId) throw new Error('Эта сборка уже входит в мультисборку')
  const pack: MultiPack = {
    id: `mp-${randomUUID().slice(0, 8)}`,
    name: name.trim() || base.name,
    icon: base.icon,
    activeStateId: base.id,
    createdAt: Date.now()
  }
  getStore().update((data) => {
    data.packs.push(pack)
  })
  patchInstance(base.id, { multiPackId: pack.id, stateName: base.name })
  notify()
  return pack
}

/** Folders that are never copied into a cloned state. */
const SKIP_ON_CLONE = new Set(['logs', 'crash-reports', 'screenshots', '.cache'])

/** Recursive copy (fs.cpSync is unreliable with non-latin paths on Windows). */
function copyTree(src: string, dst: string, skipTop: Set<string>, top = true): void {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    if (top && skipTop.has(name)) continue
    const from = join(src, name)
    const to = join(dst, name)
    if (statSync(from).isDirectory()) copyTree(from, to, skipTop, false)
    else copyFileSync(from, to)
  }
}

export async function addState(packId: string, req: NewStateRequest): Promise<Instance> {
  const pack = getPack(packId)
  const stateName = req.stateName.trim() || `Состояние ${statesOf(packId).length + 1}`

  if (req.mode === 'fresh') {
    if (!req.fresh) throw new Error('Не выбрана версия для нового состояния')
    const created = await createInstance(
      { ...req.fresh, name: `${pack.name} — ${stateName}` },
      { multiPackId: packId, stateName }
    )
    switchState(packId, created.id)
    return created
  }

  const active = getInstance(pack.activeStateId)
  const id = newInstanceId()
  const skip = new Set(SKIP_ON_CLONE)
  if (!req.copyWorlds) skip.add('saves')
  const src = instanceDir(active.id)
  if (existsSync(src)) copyTree(src, instanceDir(id), skip)
  else mkdirSync(join(instanceDir(id), 'mods'), { recursive: true })

  const clone = addInstanceRecord({
    ...active,
    id,
    name: `${pack.name} — ${stateName}`,
    stateName,
    multiPackId: packId,
    createdAt: Date.now(),
    lastPlayedAt: undefined
  })
  switchState(packId, clone.id)
  return clone
}

export function switchState(packId: string, stateId: string): MultiPack {
  const state = getInstance(stateId)
  if (state.multiPackId !== packId) throw new Error('Это состояние из другой мультисборки')
  updateSettings({ selectedInstanceId: stateId })
  return patchPack(packId, { activeStateId: stateId })
}

export function renameMultiPack(packId: string, name: string): MultiPack {
  if (!name.trim()) throw new Error('Название не может быть пустым')
  return patchPack(packId, { name: name.trim() })
}

export function renameState(stateId: string, stateName: string): Instance {
  if (!stateName.trim()) throw new Error('Название не может быть пустым')
  const state = getInstance(stateId)
  const pack = getPack(state.multiPackId!)
  return patchInstance(stateId, { stateName: stateName.trim(), name: `${pack.name} — ${stateName.trim()}` })
}

/** Deletes one state (its folder goes to the Recycle Bin). The last state removes the whole multi-pack. */
export async function removeState(stateId: string): Promise<void> {
  const state = getInstance(stateId)
  const packId = state.multiPackId
  if (isInstanceBusy(stateId)) throw new Error('Дождитесь окончания установки')
  await removeInstance(stateId)
  if (!packId) return
  const rest = statesOf(packId)
  if (!rest.length) {
    getStore().update((data) => {
      data.packs = data.packs.filter((p) => p.id !== packId)
    })
    notify()
  } else if (getPack(packId).activeStateId === stateId) {
    switchState(packId, rest[0].id)
  }
}

/** Splits a multi-pack back into ordinary instances (nothing is deleted). */
export function dissolveMultiPack(packId: string): void {
  for (const s of statesOf(packId)) patchInstance(s.id, { multiPackId: undefined, stateName: undefined })
  getStore().update((data) => {
    data.packs = data.packs.filter((p) => p.id !== packId)
  })
  notify()
}

