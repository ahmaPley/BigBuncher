import { installForgeTask } from '@xmcl/installer'
import { downloadOptions } from '../core/downloadAgent'
import { fetchJson } from '../core/http'
import { runXmclTask } from './taskProgress'
import type { ModLoader } from './types'

const MAVEN_METADATA = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
const PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'

/** { "<mc>": ["<mc>-<forge>", ...] } — oldest first. */
let metadataCache: Promise<Record<string, string[]>> | undefined
const metadata = (): Promise<Record<string, string[]>> =>
  (metadataCache ??= fetchJson<Record<string, string[]>>(MAVEN_METADATA).catch((err) => {
    metadataCache = undefined
    throw err
  }))

export const forgeLoader: ModLoader = {
  id: 'forge',
  displayName: 'Forge',
  needsJavaToInstall: true,

  async listGameVersions() {
    return Object.keys(await metadata()).reverse()
  },

  async listVersions(mcVersion) {
    const [all, promos] = await Promise.all([
      metadata(),
      fetchJson<{ promos: Record<string, string> }>(PROMOTIONS).catch(() => ({ promos: {} as Record<string, string> }))
    ])
    const recommended = promos.promos[`${mcVersion}-recommended`]
    return (all[mcVersion] ?? [])
      .map((full) => full.slice(full.indexOf('-') + 1))
      .reverse()
      .map((version) => ({ version, stable: version === recommended || version.split('-')[0] === recommended }))
  },

  async install({ folder, mcVersion, loaderVersion, javaPath, report }) {
    const task = installForgeTask({ mcversion: mcVersion, version: loaderVersion }, folder, { java: javaPath, ...downloadOptions })
    return runXmclTask(task, report, `Forge ${loaderVersion}`)
  }
}
