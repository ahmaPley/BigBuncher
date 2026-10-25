/**
 * The single source of truth for renderer <-> main communication.
 *
 * - `BigBuncherApi` describes every callable method, grouped by namespace.
 * - `API_METHODS` lists the same methods at runtime; the preload script turns each
 *   entry into `ipcRenderer.invoke('<namespace>:<method>')` and the main process
 *   registers a handler for it (see src/main/ipc.ts).
 * - `AppEvents` describes push events sent from main to the renderer.
 *
 * Adding a feature = add the method here, implement it in a main-process service,
 * then call it from the UI through `window.bigbuncher`.
 */
import type {
  Account,
  BisectState,
  DevLogLine,
  DevProfile,
  DevProjectInfo,
  Diagnosis,
  FixAction,
  FixResult,
  GraphicsInfo,
  ModJarInfo,
  GameLogLine,
  GameState,
  Instance,
  InstalledMod,
  LoaderId,
  LoaderVersion,
  McVersion,
  MultiPack,
  NewStateRequest,
  ResourcePack,
  UpdateInfo,
  ModProviderId,
  ModProviderInfo,
  ModSearchQuery,
  ModSearchResult,
  NewInstanceRequest,
  NewsItem,
  Settings,
  SkinEntry,
  SkinModel,
  TaskState
} from './types'

export interface BigBuncherApi {
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
  }
  system: {
    openPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    pickDirectory(title: string): Promise<string | null>
    pickFile(title: string, extensions: string[]): Promise<string | null>
    totalMemoryMb(): Promise<number>
    appVersion(): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    detectJava(): Promise<{ path: string; version: string }[]>
  }
  accounts: {
    list(): Promise<Account[]>
    addOffline(name: string): Promise<Account>
    loginMicrosoft(): Promise<Account>
    remove(uuid: string): Promise<void>
    select(uuid: string): Promise<void>
  }
  versions: {
    listMinecraft(includeSnapshots: boolean): Promise<McVersion[]>
    listLoaderVersions(loader: LoaderId, mcVersion: string): Promise<LoaderVersion[]>
    listLoaderGameVersions(loader: LoaderId): Promise<string[]>
  }
  instances: {
    list(): Promise<Instance[]>
    create(request: NewInstanceRequest): Promise<Instance>
    rename(id: string, name: string): Promise<Instance>
    remove(id: string): Promise<void>
    repair(id: string): Promise<void>
    openFolder(id: string): Promise<void>
    select(id: string): Promise<void>
  }
  game: {
    /** 'blocked' = the pre-launch check found problems and sent a `diagnosis` event instead. */
    launch(instanceId: string, opts?: { skipPreflight?: boolean }): Promise<'started' | 'blocked'>
    stop(): Promise<void>
    state(): Promise<GameState>
  }
  mods: {
    providers(): Promise<ModProviderInfo[]>
    search(query: ModSearchQuery): Promise<ModSearchResult>
    install(instanceId: string, provider: ModProviderId, projectId: string): Promise<InstalledMod[]>
    listInstalled(instanceId: string): Promise<InstalledMod[]>
    setEnabled(instanceId: string, fileName: string, enabled: boolean): Promise<InstalledMod[]>
    remove(instanceId: string, fileName: string): Promise<InstalledMod[]>
    addFromFile(instanceId: string): Promise<InstalledMod[]>
    openFolder(instanceId: string): Promise<void>
  }
  skins: {
    list(): Promise<SkinEntry[]>
    importFile(): Promise<SkinEntry | null>
    importByUsername(username: string): Promise<SkinEntry>
    save(entry: { id?: string; name: string; model: SkinModel; dataUrl: string }): Promise<SkinEntry>
    remove(id: string): Promise<void>
    applyToAccount(uuid: string, skinId: string): Promise<{ uploadedToMojang: boolean }>
    exportFile(id: string): Promise<boolean>
    /** Default Steve skin as a data URL (used for previews and as the editor base). */
    defaultSkin(): Promise<string>
  }
  resourcepacks: {
    listShared(): Promise<ResourcePack[]>
    addShared(): Promise<ResourcePack[]>
    removeShared(fileName: string): Promise<ResourcePack[]>
    setAutoEnable(fileName: string, enabled: boolean): Promise<ResourcePack[]>
    listForInstance(instanceId: string): Promise<ResourcePack[]>
    addToInstance(instanceId: string): Promise<ResourcePack[]>
    removeFromInstance(instanceId: string, fileName: string): Promise<ResourcePack[]>
    openSharedFolder(): Promise<void>
    openInstanceFolder(instanceId: string): Promise<void>
  }
  multipacks: {
    list(): Promise<MultiPack[]>
    create(fromInstanceId: string, name: string): Promise<MultiPack>
    addState(packId: string, request: NewStateRequest): Promise<Instance>
    switchState(packId: string, stateId: string): Promise<MultiPack>
    rename(packId: string, name: string): Promise<MultiPack>
    renameState(stateId: string, stateName: string): Promise<Instance>
    removeState(stateId: string): Promise<void>
    dissolve(packId: string): Promise<void>
  }
  updates: {
    info(): Promise<UpdateInfo>
    check(): Promise<UpdateInfo>
    download(): Promise<UpdateInfo>
    install(): Promise<void>
  }
  news: {
    latest(): Promise<NewsItem[]>
  }
  doctor: {
    last(instanceId: string): Promise<Diagnosis | null>
    /** Re-reads logs/ and crash-reports/ of the last run. */
    analyzeLastRun(instanceId: string): Promise<Diagnosis | null>
    analyzeText(instanceId: string, text: string): Promise<Diagnosis>
    preflight(instanceId: string): Promise<Diagnosis | null>
    applyFixes(diagnosisId: string, actions: FixAction[], relaunch: boolean): Promise<FixResult>
    startBisect(instanceId: string): Promise<void>
    cancelBisect(): Promise<void>
    bisectState(): Promise<BisectState | null>
  }
  graphics: {
    detect(): Promise<GraphicsInfo>
    /** Does this instance's Minecraft version have the Vulkan/OpenGL switch? */
    hasChoice(instanceId: string): Promise<boolean>
  }
  dev: {
    getProfile(instanceId: string): Promise<DevProfile>
    saveProfile(instanceId: string, patch: Partial<DevProfile>): Promise<DevProfile>
    pickProject(instanceId: string): Promise<DevProfile>
    inspectProject(dir: string): Promise<DevProjectInfo>
    build(instanceId: string): Promise<void>
    cancelBuild(): Promise<void>
    deploy(instanceId: string): Promise<DevProfile>
    buildAndRun(instanceId: string): Promise<void>
    restart(instanceId: string): Promise<void>
    inspectMods(instanceId: string): Promise<ModJarInfo[]>
    listWorlds(instanceId: string): Promise<string[]>
    openFolder(instanceId: string, which: 'mods' | 'config' | 'logs' | 'crash-reports' | 'mixin' | 'project'): Promise<void>
  }
  tasks: {
    list(): Promise<TaskState[]>
  }
}

type MethodNames<T> = { [K in keyof T]: ReadonlyArray<keyof T[K] & string> }

export const API_METHODS: MethodNames<BigBuncherApi> = {
  window: ['minimize', 'toggleMaximize', 'close'],
  system: ['openPath', 'openExternal', 'pickDirectory', 'pickFile', 'totalMemoryMb', 'appVersion'],
  settings: ['get', 'update', 'detectJava'],
  accounts: ['list', 'addOffline', 'loginMicrosoft', 'remove', 'select'],
  versions: ['listMinecraft', 'listLoaderVersions', 'listLoaderGameVersions'],
  instances: ['list', 'create', 'rename', 'remove', 'repair', 'openFolder', 'select'],
  game: ['launch', 'stop', 'state'],
  mods: ['providers', 'search', 'install', 'listInstalled', 'setEnabled', 'remove', 'addFromFile', 'openFolder'],
  skins: ['list', 'importFile', 'importByUsername', 'save', 'remove', 'applyToAccount', 'exportFile', 'defaultSkin'],
  resourcepacks: ['listShared', 'addShared', 'removeShared', 'setAutoEnable', 'listForInstance', 'addToInstance', 'removeFromInstance', 'openSharedFolder', 'openInstanceFolder'],
  multipacks: ['list', 'create', 'addState', 'switchState', 'rename', 'renameState', 'removeState', 'dissolve'],
  updates: ['info', 'check', 'download', 'install'],
  news: ['latest'],
  doctor: ['last', 'analyzeLastRun', 'analyzeText', 'preflight', 'applyFixes', 'startBisect', 'cancelBisect', 'bisectState'],
  graphics: ['detect', 'hasChoice'],
  dev: ['getProfile', 'saveProfile', 'pickProject', 'inspectProject', 'build', 'cancelBuild', 'deploy', 'buildAndRun', 'restart', 'inspectMods', 'listWorlds', 'openFolder'],
  tasks: ['list']
}

/** Push events from main to renderer. */
export interface AppEvents {
  task: TaskState
  game: GameState
  gameLog: GameLogLine
  accountsChanged: Account[]
  instancesChanged: Instance[]
  settingsChanged: Settings
  multiPacksChanged: MultiPack[]
  update: UpdateInfo
  diagnosis: Diagnosis
  bisect: BisectState
  devLog: DevLogLine
}

export type AppEventName = keyof AppEvents

export const EVENT_CHANNEL_PREFIX = 'event:'

/** Shape exposed on `window.bigbuncher` by the preload script. */
export type ExposedApi = BigBuncherApi & {
  on<E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void): () => void
}
