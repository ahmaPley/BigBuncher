/**
 * Domain types shared by the main process (Node) and the renderer (React).
 * Keep this file free of runtime imports so both sides can use it.
 */

export type LoaderId = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export type BlockIcon = 'grass' | 'stone' | 'log' | 'crafting' | 'furnace' | 'chest'

export type BackgroundId = 'sunset' | 'lake' | 'night' | 'snow' | 'valley'

export interface Instance {
  id: string
  name: string
  icon: BlockIcon
  mcVersion: string
  loader: LoaderId
  loaderVersion?: string
  /** Id of the version json inside <gameDir>/versions that is actually launched. */
  versionId: string
  /** False until the first full install finished; launch re-runs the install when false. */
  installed: boolean
  createdAt: number
  lastPlayedAt?: number
  /** Set when the instance is one state of a multi-pack. */
  multiPackId?: string
  /** Name of the state inside its multi-pack ("Ванилла", "С модами"…). */
  stateName?: string
}

export interface NewInstanceRequest {
  name: string
  icon: BlockIcon
  mcVersion: string
  loader: LoaderId
  loaderVersion?: string
}

export type AccountType = 'microsoft' | 'offline'

export interface Account {
  /** Minecraft profile UUID without dashes. */
  uuid: string
  name: string
  type: AccountType
  /** Id of a skin from the local skin library that is applied to this account. */
  skinId?: string
}

export type SkinModel = 'classic' | 'slim'

export interface SkinEntry {
  id: string
  name: string
  model: SkinModel
  createdAt: number
  /** data:image/png;base64,... — filled when skins are listed for the UI. */
  dataUrl: string
}

export interface Settings {
  gameDir: string
  minRamMb: number
  maxRamMb: number
  /** Empty string = pick/download a matching Java automatically. */
  javaPath: string
  jvmArgs: string
  resolution: { width: number; height: number; fullscreen: boolean }
  afterLaunch: 'keep' | 'minimize'
  background: BackgroundId
  showSnapshots: boolean
  curseforgeApiKey: string
  selectedInstanceId?: string
  selectedAccountId?: string
  /** Checks the mods for known problems before every launch (Доктор крашей). */
  preflightCheck: boolean
  /** Shows the "Разработка" page and applies dev profiles on launch. */
  devMode: boolean
  /**
   * Renderer for versions that have both (Minecraft 26.2+): ask = ask before the first launch,
   * auto = the launcher checks the PC, vulkan / opengl = forced via --graphicsBackend.
   */
  graphicsApi: GraphicsApiChoice
}

export type GraphicsApiChoice = 'ask' | 'auto' | 'vulkan' | 'opengl'

export interface GraphicsInfo {
  /** Vulkan driver (ICD) registered in Windows. */
  vulkan: boolean
  gpu: string
  /** What "auto" picks on this PC. */
  recommended: 'vulkan' | 'opengl'
  reason: string
}

/* ---------- Доктор крашей ---------- */

export type FixAction =
  /** Finds the mod on Modrinth by its mod id and installs it (with dependencies). */
  | { kind: 'installMod'; modId: string }
  | { kind: 'disableMod'; fileName: string }
  /** Replaces the jar with the newest Modrinth build for this instance's version and loader. */
  | { kind: 'updateMod'; fileName: string }
  | { kind: 'setRam'; maxRamMb: number }
  /** Clears the custom Java path so the launcher picks the right Java itself. */
  | { kind: 'autoJava' }
  | { kind: 'clearJvmArgs' }
  | { kind: 'setGraphics'; api: 'vulkan' | 'opengl' }
  | { kind: 'repairInstance' }
  /** Moves a broken file (usually a config) to the Recycle Bin; the mod recreates it. */
  | { kind: 'trashFile'; path: string }
  | { kind: 'createInstance'; mcVersion: string }
  | { kind: 'openUrl'; url: string }
  /** Handled by the UI: opens the accounts dialog. */
  | { kind: 'openAccounts' }
  /** Automatic culprit search: launches with halves of the mods until the broken one is found. */
  | { kind: 'bisect' }

export interface Fix {
  label: string
  action: FixAction
}

export interface Problem {
  title: string
  /** Plain-language explanation of what happened and why. */
  explanation: string
  confidence: 'high' | 'medium' | 'low'
  /** The log line the conclusion is based on. */
  evidence?: string
  /** Fixes in order of preference; the first one is recommended. */
  fixes: Fix[]
}

export interface Diagnosis {
  id: string
  instanceId: string
  /** preflight = found before launch, crash = game crashed, disconnect = could not join / kicked from a server. */
  phase: 'preflight' | 'crash' | 'disconnect'
  createdAt: number
  headline: string
  problems: Problem[]
  exitCode?: number
  crashReportPath?: string
}

export interface FixResult {
  done: string[]
  failed: string[]
  relaunched: boolean
}

export interface BisectState {
  instanceId: string
  running: boolean
  step: number
  detail: string
  /** Set when finished: file name of the culprit mod. */
  culprit?: string
  error?: string
}

/* ---------- Режим разработчика ---------- */

export type ModPlatform = 'fabric' | 'quilt' | 'forge' | 'neoforge'

export interface ModJarInfo {
  fileName: string
  enabled: boolean
  ids: string[]
  name: string
  version: string
  platforms: ModPlatform[]
  dependencies: { id: string; range?: string }[]
  /** Problems found by the static check (wrong loader, duplicate, missing dependency). */
  issues: string[]
}

export interface DevProfile {
  instanceId: string
  /** Gradle project of the mod being developed. */
  projectDir?: string
  buildTask: string
  /** Copies every new jar from build/libs into the instance automatically. */
  autoDeploy: boolean
  debug: boolean
  debugPort: number
  suspend: boolean
  mixinExport: boolean
  mixinVerbose: boolean
  /** Opens this world right after the game starts (Minecraft 1.20+). */
  quickPlayWorld: string
  quickPlayServer: string
  extraJvmArgs: string
  /** Jar copied by the last deploy (replaced by the next one). */
  deployedFile?: string
}

export interface DevProjectInfo {
  dir: string
  hasGradle: boolean
  modId?: string
  modName?: string
  platform?: ModPlatform
  jars: { fileName: string; sizeBytes: number; modifiedAt: number }[]
}

export interface DevLogLine {
  source: 'gradle' | 'deploy'
  line: string
  level: 'info' | 'warn' | 'error'
}

export interface McVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha' | string
  releaseTime: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
}

export interface TaskState {
  id: string
  title: string
  /** Instance the task belongs to (install/launch), so the UI can show progress on the right card. */
  instanceId?: string
  detail?: string
  /** 0..1, or -1 when the progress is unknown. */
  progress: number
  status: 'running' | 'done' | 'error'
  error?: string
}

export interface GameState {
  running: boolean
  instanceId?: string
  pid?: number
}

export interface GameLogLine {
  instanceId: string
  line: string
  stream: 'out' | 'err'
}

export interface NewsItem {
  id: string
  title: string
  text: string
  version: string
  date: string
  imageUrl?: string
}

export type ModProviderId = 'modrinth' | 'curseforge'

export interface ModSearchQuery {
  provider: ModProviderId
  query: string
  mcVersion: string
  loader: LoaderId
  offset: number
  limit: number
}

export interface ModSearchHit {
  provider: ModProviderId
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl?: string
  downloads: number
  pageUrl: string
}

export interface ModSearchResult {
  hits: ModSearchHit[]
  total: number
}

export interface InstalledMod {
  fileName: string
  enabled: boolean
  title: string
  version?: string
  provider?: ModProviderId
  projectId?: string
  iconUrl?: string
  sizeBytes: number
}

export interface ModProviderInfo {
  id: ModProviderId
  name: string
  available: boolean
  reason?: string
}

/** A multi-pack groups several instances (states); exactly one state is active and gets launched. */
export interface MultiPack {
  id: string
  name: string
  icon: BlockIcon
  activeStateId: string
  createdAt: number
}

export interface NewStateRequest {
  stateName: string
  /**
   * clone = copy of the active state (mods, configs, optionally worlds); fresh = new version/loader;
   * existing = attach an instance that already exists (it leaves the plain instance list).
   */
  mode: 'clone' | 'fresh' | 'existing'
  copyWorlds?: boolean
  fresh?: NewInstanceRequest
  existingInstanceId?: string
}

export interface ResourcePack {
  fileName: string
  title: string
  description: string
  packFormat?: number
  iconDataUrl?: string
  sizeBytes: number
  /** True for packs from the shared folder (available in every instance). */
  shared: boolean
  /** Shared packs only: switched on automatically in every instance. */
  autoEnable?: boolean
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion?: string
  available: boolean
  notes?: string
  /** Where the update comes from (GitHub repo), for the settings screen. */
  source: string
  /** Set when an update was downloaded and is ready to be installed on restart. */
  downloaded?: boolean
  error?: string
}
