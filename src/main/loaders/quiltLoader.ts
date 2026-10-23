import { getQuiltLoaderVersionsByMinecraft, installQuiltVersion } from '@xmcl/installer'
import { fetchJson } from '../core/http'
import type { ModLoader } from './types'

export const quiltLoader: ModLoader = {
  id: 'quilt',
  displayName: 'Quilt',
  needsJavaToInstall: false,

  async listGameVersions() {
    // @xmcl getQuiltGames() calls a non-existent endpoint (/v3/game), so query the meta API directly.
    const games = await fetchJson<{ version: string }[]>('https://meta.quiltmc.org/v3/versions/game')
    return games.map((g) => g.version)
  },

  async listVersions(mcVersion) {
    const artifacts = await getQuiltLoaderVersionsByMinecraft({ minecraftVersion: mcVersion })
    return artifacts.map((a) => ({ version: a.loader.version, stable: !/beta|pre|rc/i.test(a.loader.version) }))
  },

  async install({ folder, mcVersion, loaderVersion, report }) {
    report.update(-1, `Quilt ${loaderVersion}`)
    return installQuiltVersion({ minecraftVersion: mcVersion, version: loaderVersion, minecraft: folder })
  }
}
