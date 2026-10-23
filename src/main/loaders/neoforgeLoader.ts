import { installNeoForgedTask } from '@xmcl/installer'
import { downloadOptions } from '../core/downloadAgent'
import { fetchJson } from '../core/http'
import { runXmclTask } from './taskProgress'
import type { ModLoader } from './types'

const MAVEN_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged'

let versionsCache: Promise<string[]> | undefined
const neoforgeVersions = (): Promise<string[]> =>
  (versionsCache ??= fetchJson<{ versions: string[] }>(`${MAVEN_API}/neoforge`)
    .then((r) => r.versions)
    .catch((err) => {
      versionsCache = undefined
      throw err
    }))

/**
 * NeoForge encodes the Minecraft version in its own number:
 *   1.21.1 -> 21.1.x,  1.20.4 -> 20.4.x
 *   26.1 -> 26.1.0.x,  26.1.2 -> 26.1.2.x (year-based scheme since 2026)
 * 1.20.1 is served by the legacy "forge" artifact of NeoForged (1.20.1-47.1.x).
 */
function mcFromNeoVersion(v: string): string {
  const [a, b, c] = v.split('.')
  if (Number(a) >= 25) return c === '0' ? `${a}.${b}` : `${a}.${b}.${c}`
  return b === '0' ? `1.${a}` : `1.${a}.${b}`
}

export const neoforgeLoader: ModLoader = {
  id: 'neoforge',
  displayName: 'NeoForge',
  needsJavaToInstall: true,

  async listGameVersions() {
    const games = new Set((await neoforgeVersions()).map(mcFromNeoVersion))
    games.add('1.20.1')
    return [...games].reverse()
  },

  async listVersions(mcVersion) {
    if (mcVersion === '1.20.1') {
      const legacy = await fetchJson<{ versions: string[] }>(`${MAVEN_API}/forge`)
      return legacy.versions
        .filter((v) => v.startsWith('1.20.1-'))
        .reverse()
        .map((version) => ({ version, stable: true }))
    }
    return (await neoforgeVersions())
      .filter((v) => mcFromNeoVersion(v) === mcVersion)
      .reverse()
      .map((version) => ({ version, stable: !/beta|alpha/i.test(version) }))
  },

  async install({ folder, mcVersion, loaderVersion, javaPath, report }) {
    const project = mcVersion === '1.20.1' ? 'forge' : 'neoforge'
    const task = installNeoForgedTask(project, loaderVersion, folder, { java: javaPath, ...downloadOptions })
    return runXmclTask(task, report, `NeoForge ${loaderVersion}`)
  }
}
