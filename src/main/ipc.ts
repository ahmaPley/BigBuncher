import { ipcMain } from 'electron'
import { API_METHODS, type BigBuncherApi } from '../shared/ipc'
import * as accounts from './auth/accountService'
import { listTasks } from './core/tasks'
import * as instances from './instances/instanceService'
import { detectInstalledJava } from './minecraft/javaService'
import { getGameState, launchInstance, stopGame } from './minecraft/launchService'
import * as versions from './minecraft/versionService'
import * as mods from './mods/modService'
import * as multipacks from './instances/multiPackService'
import { latestNews } from './news/newsService'
import * as packs from './resourcepacks/resourcePackService'
import * as updates from './updates/updateService'
import { getSettings, updateSettings } from './settings/settingsService'
import * as skins from './skins/skinService'
import { system, windowControls } from './system/systemService'

/**
 * Wires every method of BigBuncherApi to its implementation.
 * TypeScript checks that each namespace here matches the contract in shared/ipc.ts.
 */
const handlers: BigBuncherApi = {
  window: windowControls,
  system,
  settings: {
    get: async () => getSettings(),
    update: async (patch) => updateSettings(patch),
    detectJava: detectInstalledJava
  },
  accounts: {
    list: async () => accounts.listAccounts(),
    addOffline: async (name) => accounts.addOfflineAccount(name),
    loginMicrosoft: accounts.loginMicrosoft,
    remove: async (uuid) => accounts.removeAccount(uuid),
    select: async (uuid) => accounts.selectAccount(uuid)
  },
  versions: {
    listMinecraft: versions.listMinecraftVersions,
    listLoaderVersions: versions.listLoaderVersions,
    listLoaderGameVersions: versions.listLoaderGameVersions
  },
  instances: {
    list: async () => instances.listInstances(),
    create: (request) => instances.createInstance(request),
    rename: async (id, name) => instances.renameInstance(id, name),
    remove: instances.removeInstance,
    repair: async (id) => {
      await instances.installInstance(id)
    },
    openFolder: instances.openInstanceFolder,
    select: async (id) => instances.selectInstance(id)
  },
  game: {
    launch: launchInstance,
    stop: async () => stopGame(),
    state: async () => getGameState()
  },
  mods: {
    providers: async () => mods.listProviders(),
    search: mods.searchMods,
    install: mods.installMod,
    listInstalled: async (id) => mods.listInstalledMods(id),
    setEnabled: async (id, file, enabled) => mods.setModEnabled(id, file, enabled),
    remove: async (id, file) => mods.removeMod(id, file),
    addFromFile: mods.addModsFromFiles,
    openFolder: mods.openModsFolder
  },
  skins: {
    list: async () => skins.listSkins(),
    importFile: skins.importSkinFromFile,
    importByUsername: skins.importSkinByUsername,
    save: async (entry) => skins.saveSkinFromDataUrl(entry),
    remove: async (id) => skins.removeSkin(id),
    applyToAccount: skins.applySkinToAccount,
    exportFile: skins.exportSkinToFile,
    defaultSkin: skins.defaultSkinDataUrl
  },
  resourcepacks: {
    listShared: packs.listSharedPacks,
    addShared: packs.addSharedPacks,
    removeShared: packs.removeSharedPack,
    setAutoEnable: packs.setSharedAutoEnable,
    listForInstance: packs.listInstancePacks,
    addToInstance: packs.addInstancePacks,
    removeFromInstance: packs.removeInstancePack,
    openSharedFolder: packs.openSharedPacksFolder,
    openInstanceFolder: packs.openInstancePacksFolder
  },
  multipacks: {
    list: async () => multipacks.listMultiPacks(),
    create: async (id, name) => multipacks.createMultiPack(id, name),
    addState: multipacks.addState,
    switchState: async (packId, stateId) => multipacks.switchState(packId, stateId),
    rename: async (packId, name) => multipacks.renameMultiPack(packId, name),
    renameState: async (stateId, name) => multipacks.renameState(stateId, name),
    removeState: multipacks.removeState,
    dissolve: async (packId) => multipacks.dissolveMultiPack(packId)
  },
  updates: {
    info: async () => updates.getUpdateInfo(),
    check: updates.checkForUpdates,
    download: updates.downloadUpdate,
    install: updates.installUpdate
  },
  news: { latest: latestNews },
  tasks: { list: async () => listTasks() }
}

export function registerIpcHandlers(): void {
  for (const [namespace, methods] of Object.entries(API_METHODS)) {
    const impl = handlers[namespace as keyof BigBuncherApi] as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const method of methods) {
      ipcMain.handle(`${namespace}:${method}`, async (_event, ...args: unknown[]) => {
        try {
          return { ok: true, value: await impl[method](...args) }
        } catch (err) {
          console.error(`[ipc] ${namespace}:${method} failed`, err)
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      })
    }
  }
}
