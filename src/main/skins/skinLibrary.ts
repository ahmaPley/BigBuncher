import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SkinEntry, SkinModel } from '../../shared/types'
import { JsonStore } from '../core/jsonStore'
import { skinsDir } from '../core/paths'

/** Local skin library: <userData>/skins/<id>.png + an index with names and models. */
type SkinMeta = Omit<SkinEntry, 'dataUrl'>

let store: JsonStore<{ skins: SkinMeta[] }> | undefined
const getStore = (): JsonStore<{ skins: SkinMeta[] }> =>
  (store ??= new JsonStore(join(app.getPath('userData'), 'skins.json'), () => ({ skins: [] })))

const skinFile = (id: string): string => join(skinsDir(), `${id}.png`)

export function readSkinPng(id: string): Buffer | undefined {
  const file = skinFile(id)
  return existsSync(file) ? readFileSync(file) : undefined
}

export function getSkinMeta(id: string): SkinMeta | undefined {
  return getStore().get().skins.find((s) => s.id === id)
}

export function listSkins(): SkinEntry[] {
  return getStore()
    .get()
    .skins.map((meta) => {
      const png = readSkinPng(meta.id)
      return png ? { ...meta, dataUrl: `data:image/png;base64,${png.toString('base64')}` } : undefined
    })
    .filter((s): s is SkinEntry => s !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Validates the PNG header and the Minecraft skin size (64x64 or legacy 64x32). */
export function assertValidSkin(png: Buffer): void {
  const isPng = png.length > 24 && png.readUInt32BE(0) === 0x89504e47
  if (!isPng) throw new Error('Файл не является PNG-изображением')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Скин должен быть 64×64 или 64×32 пикселя (сейчас ${width}×${height})`)
  }
}

export function saveSkin(input: { id?: string; name: string; model: SkinModel; png: Buffer }): SkinEntry {
  assertValidSkin(input.png)
  const existing = input.id ? getSkinMeta(input.id) : undefined
  const meta: SkinMeta = {
    id: existing?.id ?? randomUUID().slice(0, 12),
    name: input.name.trim() || 'Без названия',
    model: input.model,
    createdAt: existing?.createdAt ?? Date.now()
  }
  mkdirSync(skinsDir(), { recursive: true })
  writeFileSync(skinFile(meta.id), input.png)
  getStore().update((data) => {
    data.skins = [...data.skins.filter((s) => s.id !== meta.id), meta]
  })
  return { ...meta, dataUrl: `data:image/png;base64,${input.png.toString('base64')}` }
}

export function removeSkin(id: string): void {
  rmSync(skinFile(id), { force: true })
  getStore().update((data) => {
    data.skins = data.skins.filter((s) => s.id !== id)
  })
}
