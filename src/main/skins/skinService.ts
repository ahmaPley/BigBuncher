import { dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, SkinEntry, SkinModel } from '../../shared/types'
import { findAccount, getLaunchCredentials, setAccountSkin } from '../auth/accountService'
import { fetchBuffer, fetchJson, HttpError } from '../core/http'
import { skinsDir } from '../core/paths'
import { assertValidSkin, getSkinMeta, readSkinPng, saveSkin } from './skinLibrary'
import { ensureAuthlibInjector } from './authlibInjector'
import { ensureYggdrasilServer, prefetchedMetadata, registerProfile } from './yggdrasilServer'

export { listSkins, removeSkin } from './skinLibrary'

export async function importSkinFromFile(): Promise<SkinEntry | null> {
  const picked = await dialog.showOpenDialog({
    title: 'Выберите файл скина',
    filters: [{ name: 'PNG скин', extensions: ['png'] }],
    properties: ['openFile']
  })
  if (picked.canceled || !picked.filePaths[0]) return null
  const file = picked.filePaths[0]
  const name = file.split(/[\\/]/).pop()!.replace(/\.png$/i, '')
  return saveSkin({ name, model: 'classic', png: readFileSync(file) })
}

interface MojangTextures {
  textures: { SKIN?: { url: string; metadata?: { model?: string } } }
}

/** Copies the current skin of any licensed player by nickname (public Mojang API). */
export async function importSkinByUsername(username: string): Promise<SkinEntry> {
  let id: string
  try {
    id = (await fetchJson<{ id: string }>(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username.trim())}`)).id
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 204)) throw new Error('Игрок с таким ником не найден')
    throw err
  }
  const profile = await fetchJson<{ name: string; properties: { name: string; value: string }[] }>(
    `https://sessionserver.mojang.com/session/minecraft/profile/${id}`
  )
  const raw = profile.properties.find((p) => p.name === 'textures')?.value
  const textures: MojangTextures = JSON.parse(Buffer.from(raw ?? 'e30=', 'base64').toString())
  const skin = textures.textures.SKIN
  if (!skin) throw new Error('У игрока стандартный скин')
  const png = await fetchBuffer(skin.url.replace(/^http:/, 'https:'))
  return saveSkin({ name: profile.name, model: skin.metadata?.model === 'slim' ? 'slim' : 'classic', png })
}

export function saveSkinFromDataUrl(entry: { id?: string; name: string; model: SkinModel; dataUrl: string }): SkinEntry {
  const base64 = entry.dataUrl.replace(/^data:image\/png;base64,/, '')
  return saveSkin({ id: entry.id, name: entry.name, model: entry.model, png: Buffer.from(base64, 'base64') })
}

export async function exportSkinToFile(id: string): Promise<boolean> {
  const png = readSkinPng(id)
  if (!png) throw new Error('Скин не найден')
  const target = await dialog.showSaveDialog({
    title: 'Сохранить скин',
    defaultPath: `${getSkinMeta(id)?.name ?? 'skin'}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }]
  })
  if (target.canceled || !target.filePath) return false
  writeFileSync(target.filePath, png)
  return true
}

/**
 * Binds a skin to an account. Microsoft accounts additionally get the skin uploaded
 * to Mojang, so it is visible on online servers too.
 */
export async function applySkinToAccount(uuid: string, skinId: string): Promise<{ uploadedToMojang: boolean }> {
  const account = findAccount(uuid)
  const meta = getSkinMeta(skinId)
  const png = readSkinPng(skinId)
  if (!account || !meta || !png) throw new Error('Аккаунт или скин не найден')
  setAccountSkin(uuid, skinId)

  if (account.type !== 'microsoft') return { uploadedToMojang: false }
  const { accessToken } = await getLaunchCredentials(uuid)
  const form = new FormData()
  form.append('variant', meta.model)
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png')
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  })
  if (!res.ok) throw new Error(`Mojang отклонил скин (HTTP ${res.status})`)
  return { uploadedToMojang: true }
}

const STEVE_URL = 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'

/** Steve from Mojang's texture server, cached locally after the first download. */
export async function defaultSkinDataUrl(): Promise<string> {
  const cached = join(skinsDir(), '_default.png')
  if (!existsSync(cached)) {
    mkdirSync(skinsDir(), { recursive: true })
    writeFileSync(cached, await fetchBuffer(STEVE_URL))
  }
  return `data:image/png;base64,${readFileSync(cached).toString('base64')}`
}

export interface SkinInjection {
  jar: string
  server: string
  prefetched: string
}

/**
 * For offline accounts with a chosen skin: registers the profile on the local Yggdrasil
 * server and returns the java-agent settings that force the skin inside the game.
 */
export async function prepareSkinInjection(account: Account): Promise<SkinInjection | undefined> {
  if (account.type !== 'offline' || !account.skinId) return undefined
  const png = readSkinPng(account.skinId)
  const meta = getSkinMeta(account.skinId)
  if (!png || !meta) return undefined
  assertValidSkin(png)

  const [jar, server] = await Promise.all([ensureAuthlibInjector(), ensureYggdrasilServer()])
  registerProfile({ uuid: account.uuid, name: account.name, skin: { png, model: meta.model } })
  return { jar, server, prefetched: await prefetchedMetadata() }
}
