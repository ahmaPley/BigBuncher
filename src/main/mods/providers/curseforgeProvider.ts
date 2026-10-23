import type { LoaderId } from '../../../shared/types'
import { fetchJson } from '../../core/http'
import { getSettings } from '../../settings/settingsService'
import type { ModProvider } from './types'

const API = 'https://api.curseforge.com/v1'
const MINECRAFT_GAME_ID = 432
const MODS_CLASS_ID = 6
const LOADER_TYPE: Record<LoaderId, number> = { vanilla: 0, forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const RELATION_REQUIRED = 3

const headers = (): Record<string, string> => ({ 'x-api-key': getSettings().curseforgeApiKey.trim(), Accept: 'application/json' })

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  authors: { name: string }[]
  logo?: { thumbnailUrl: string }
  downloadCount: number
  links: { websiteUrl: string }
}

interface CfFile {
  id: number
  displayName: string
  fileName: string
  downloadUrl: string | null
  dependencies: { modId: number; relationType: number }[]
}

/** Files whose authors disabled third-party distribution have no downloadUrl; the CDN path is predictable. */
const cdnUrl = (f: CfFile): string =>
  f.downloadUrl ?? `https://edge.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${encodeURIComponent(f.fileName)}`

export const curseforgeProvider: ModProvider = {
  id: 'curseforge',
  name: 'CurseForge',

  availability: () =>
    getSettings().curseforgeApiKey.trim()
      ? { available: true }
      : { available: false, reason: 'Нужен API-ключ CurseForge (Настройки → Моды)' },

  async search({ query, mcVersion, loader, offset, limit }) {
    const params = new URLSearchParams({
      gameId: String(MINECRAFT_GAME_ID),
      classId: String(MODS_CLASS_ID),
      searchFilter: query,
      gameVersion: mcVersion,
      modLoaderType: String(LOADER_TYPE[loader]),
      sortField: query ? '1' : '2',
      sortOrder: 'desc',
      index: String(offset),
      pageSize: String(limit)
    })
    const res = await fetchJson<{ data: CfMod[]; pagination: { totalCount: number } }>(`${API}/mods/search?${params}`, {
      headers: headers()
    })
    return {
      total: Math.min(res.pagination.totalCount, 10_000),
      hits: res.data.map((m) => ({
        provider: 'curseforge',
        projectId: String(m.id),
        slug: m.slug,
        title: m.name,
        description: m.summary,
        author: m.authors[0]?.name ?? '',
        iconUrl: m.logo?.thumbnailUrl,
        downloads: m.downloadCount,
        pageUrl: m.links.websiteUrl
      }))
    }
  },

  async resolveFile(projectId, mcVersion, loader) {
    const params = new URLSearchParams({ gameVersion: mcVersion, modLoaderType: String(LOADER_TYPE[loader]), pageSize: '1' })
    const [files, mod] = await Promise.all([
      fetchJson<{ data: CfFile[] }>(`${API}/mods/${projectId}/files?${params}`, { headers: headers() }),
      fetchJson<{ data: CfMod }>(`${API}/mods/${projectId}`, { headers: headers() })
    ])
    const file = files.data[0]
    if (!file) throw new Error(`«${mod.data.name}» нет для ${loader} ${mcVersion}`)
    return {
      provider: 'curseforge',
      projectId,
      title: mod.data.name,
      version: file.displayName,
      fileName: file.fileName,
      url: cdnUrl(file),
      iconUrl: mod.data.logo?.thumbnailUrl,
      dependencies: file.dependencies.filter((d) => d.relationType === RELATION_REQUIRED).map((d) => String(d.modId))
    }
  }
}
