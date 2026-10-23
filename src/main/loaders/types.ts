import type { MinecraftFolder } from '@xmcl/core'
import type { LoaderId, LoaderVersion } from '../../shared/types'
import type { TaskReporter } from '../core/tasks'

export interface LoaderInstallContext {
  folder: MinecraftFolder
  mcVersion: string
  loaderVersion: string
  /** Java executable — Forge/NeoForge run their installer processors with it. */
  javaPath: string
  report: TaskReporter
}

/**
 * Contract every mod loader implements. Register new loaders in ./index.ts —
 * the rest of the launcher (UI, instance creation, mod search) picks them up automatically.
 */
export interface ModLoader {
  id: Exclude<LoaderId, 'vanilla'>
  displayName: string
  /** Minecraft versions this loader supports. */
  listGameVersions(): Promise<string[]>
  /** Loader builds for one Minecraft version, newest first. */
  listVersions(mcVersion: string): Promise<LoaderVersion[]>
  /** Installs the loader on top of an already installed vanilla version; returns the new version id. */
  install(ctx: LoaderInstallContext): Promise<string>
  /** True when the loader needs Java to run installer processors. */
  needsJavaToInstall: boolean
}
