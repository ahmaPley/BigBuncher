import { getVersionList, type MinecraftVersion } from '@xmcl/installer'
import type { LoaderId, LoaderVersion, McVersion } from '../../shared/types'
import { getLoader } from '../loaders'

let manifestCache: { at: number; versions: MinecraftVersion[] } | undefined

/** Mojang version manifest, cached for 10 minutes. */
export async function getMinecraftVersions(): Promise<MinecraftVersion[]> {
  if (!manifestCache || Date.now() - manifestCache.at > 10 * 60_000) {
    manifestCache = { at: Date.now(), versions: (await getVersionList()).versions }
  }
  return manifestCache.versions
}

export async function findMinecraftVersion(id: string): Promise<MinecraftVersion> {
  const meta = (await getMinecraftVersions()).find((v) => v.id === id)
  if (!meta) throw new Error(`Версия Minecraft ${id} не найдена`)
  return meta
}

export async function listMinecraftVersions(includeSnapshots: boolean): Promise<McVersion[]> {
  return (await getMinecraftVersions())
    .filter((v) => includeSnapshots || v.type === 'release')
    .map(({ id, type, releaseTime }) => ({ id, type, releaseTime }))
}

export async function listLoaderVersions(loader: LoaderId, mcVersion: string): Promise<LoaderVersion[]> {
  if (loader === 'vanilla') return []
  return getLoader(loader).listVersions(mcVersion)
}

export async function listLoaderGameVersions(loader: LoaderId): Promise<string[]> {
  if (loader === 'vanilla') return (await getMinecraftVersions()).map((v) => v.id)
  return getLoader(loader).listGameVersions()
}
