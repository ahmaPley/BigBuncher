import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { Account } from '../../shared/types'
import { emit } from '../core/events'
import { JsonStore } from '../core/jsonStore'
import { getSettings, updateSettings } from '../settings/settingsService'
import { loginInteractive, refreshSession, type MinecraftSession } from './microsoftAuth'
import { offlineUuid, validateOfflineName } from './offlineAuth'

interface StoredAccount extends Account {
  /** Encrypted (safeStorage) Microsoft refresh token, base64. */
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
}

export interface LaunchCredentials {
  uuid: string
  name: string
  accessToken: string
  type: Account['type']
}

let store: JsonStore<{ accounts: StoredAccount[] }> | undefined
const getStore = (): JsonStore<{ accounts: StoredAccount[] }> =>
  (store ??= new JsonStore(join(app.getPath('userData'), 'accounts.json'), () => ({ accounts: [] })))

const toPublic = ({ uuid, name, type, skinId }: StoredAccount): Account => ({ uuid, name, type, skinId })

const encrypt = (value: string): string =>
  safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : `plain:${value}`

const decrypt = (value: string): string =>
  value.startsWith('plain:') ? value.slice(6) : safeStorage.decryptString(Buffer.from(value, 'base64'))

function notify(): void {
  emit('accountsChanged', listAccounts())
}

export function listAccounts(): Account[] {
  return getStore().get().accounts.map(toPublic)
}

export function findAccount(uuid: string): Account | undefined {
  return listAccounts().find((a) => a.uuid === uuid)
}

function upsert(account: StoredAccount): Account {
  getStore().update((data) => {
    const existing = data.accounts.find((a) => a.uuid === account.uuid)
    if (existing) Object.assign(existing, account, { skinId: account.skinId ?? existing.skinId })
    else data.accounts.push(account)
  })
  updateSettings({ selectedAccountId: account.uuid })
  notify()
  return toPublic(account)
}

function fromSession(s: MinecraftSession): StoredAccount {
  return {
    uuid: s.uuid,
    name: s.name,
    type: 'microsoft',
    accessToken: s.accessToken,
    expiresAt: s.expiresAt,
    refreshToken: encrypt(s.refreshToken)
  }
}

export function addOfflineAccount(rawName: string): Account {
  const name = validateOfflineName(rawName)
  return upsert({ uuid: offlineUuid(name), name, type: 'offline' })
}

export async function loginMicrosoft(): Promise<Account> {
  return upsert(fromSession(await loginInteractive()))
}

export function removeAccount(uuid: string): void {
  getStore().update((data) => {
    data.accounts = data.accounts.filter((a) => a.uuid !== uuid)
  })
  if (getSettings().selectedAccountId === uuid) {
    updateSettings({ selectedAccountId: getStore().get().accounts[0]?.uuid })
  }
  notify()
}

export function selectAccount(uuid: string): void {
  if (!findAccount(uuid)) throw new Error('Аккаунт не найден')
  updateSettings({ selectedAccountId: uuid })
}

export function setAccountSkin(uuid: string, skinId: string | undefined): void {
  getStore().update((data) => {
    const acc = data.accounts.find((a) => a.uuid === uuid)
    if (acc) acc.skinId = skinId
  })
  notify()
}

/** Returns a fresh Minecraft access token for the account (refreshing Microsoft tokens if needed). */
export async function getLaunchCredentials(uuid: string): Promise<LaunchCredentials> {
  const acc = getStore().get().accounts.find((a) => a.uuid === uuid)
  if (!acc) throw new Error('Выберите аккаунт перед запуском')

  if (acc.type === 'offline') {
    return { uuid: acc.uuid, name: acc.name, accessToken: randomBytes(16).toString('hex'), type: 'offline' }
  }

  if (!acc.accessToken || !acc.expiresAt || acc.expiresAt < Date.now()) {
    if (!acc.refreshToken) throw new Error('Сессия Microsoft истекла, войдите заново')
    try {
      upsert({ ...fromSession(await refreshSession(decrypt(acc.refreshToken))), skinId: acc.skinId })
    } catch (err) {
      throw new Error(`Не удалось обновить вход Microsoft: ${(err as Error).message}. Войдите заново.`)
    }
  }
  const fresh = getStore().get().accounts.find((a) => a.uuid === uuid)!
  return { uuid: fresh.uuid, name: fresh.name, accessToken: fresh.accessToken!, type: 'microsoft' }
}
