import { getLoaderArtifactListFor, installFabric } from '@xmcl/installer'
import { fetchJson } from '../core/http'
import type { ModLoader } from './types'

export const fabricLoader: ModLoader = {
  id: 'fabric',
  displayName: 'Fabric',
  needsJavaToInstall: false,

  async listGameVersions() {
    // @xmcl getFabricGames() calls a non-existent endpoint (/v2/game), so query the meta API directly.
    const games = await fetchJson<{ version: string }[]>('https://meta.fabricmc.net/v2/versions/game')
    return games.map((g) => g.version)
  },

  async listVersions(mcVersion) {
    const artifacts = await getLoaderArtifactListFor(mcVersion)
    return artifacts.map((a) => ({ version: a.loader.version, stable: a.loader.stable }))
  },

  async install({ folder, mcVersion, loaderVersion, report }) {
    report.update(-1, `Fabric ${loaderVersion}`)
    return installFabric({ minecraftVersion: mcVersion, version: loaderVersion, minecraft: folder })
  }
}
