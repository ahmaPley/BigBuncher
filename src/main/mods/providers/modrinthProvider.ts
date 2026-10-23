import type { LoaderId } from '../../../shared/types'
import { fetchJson } from '../../core/http'
import type { ModProvider } from './types'

const API = 'https://api.modrinth.com/v2'

/** Quilt runs most Fabric mods, so Quilt instances also see Fabric builds. */
const compatibleLoaders = (loader: LoaderId): string[] => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader])

interface SearchResponse {
  hits: {
    project_id: string
    slug: string
    title: string
    description: string
    author: string
    icon_url?: string
    downloads: number
  }[]
  total_hits: number
}

interface ModrinthVersion {
  version_number: string
  files: { url: string; filename: string; primary: boolean }[]
  dependencies: { project_id?: string; dependency_type: string }[]
}

export const modrinthProvider: ModProvider = {
  id: 'modrinth',
  name: 'Modrinth',

  availability: () => ({ available: true }),

  async search({ query, mcVersion, loader, offset, limit }) {
    const facets = [
      ['project_type:mod'],
      [`versions:${mcVersion}`],
      compatibleLoaders(loader).map((l) => `categories:${l}`)
    ]
    const params = new URLSearchParams({
      query,
      facets: JSON.stringify(facets),
      index: query ? 'relevance' : 'downloads',
      offset: String(offset),
      limit: String(limit)
    })
    const res = await fetchJson<SearchResponse>(`${API}/search?${params}`)
    return {
      total: res.total_hits,
      hits: res.hits.map((h) => ({
        provider: 'modrinth',
        projectId: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        author: h.author,
        iconUrl: h.icon_url || undefined,
        downloads: h.downloads,
        pageUrl: `https://modrinth.com/mod/${h.slug}`
      }))
    }
  },

  async resolveFile(projectId, mcVersion, loader) {
    const params = new URLSearchParams({
      loaders: JSON.stringify(compatibleLoaders(loader)),
      game_versions: JSON.stringify([mcVersion])
    })
    const [versions, project] = await Promise.all([
      fetchJson<ModrinthVersion[]>(`${API}/project/${projectId}/version?${params}`),
      fetchJson<{ title: string; icon_url?: string }>(`${API}/project/${projectId}`)
    ])
    const latest = versions[0]
    if (!latest) throw new Error(`«${project.title}» нет для ${loader} ${mcVersion}`)
    const file = latest.files.find((f) => f.primary) ?? latest.files[0]
    return {
      provider: 'modrinth',
      projectId,
      title: project.title,
      version: latest.version_number,
      fileName: file.filename,
      url: file.url,
      iconUrl: project.icon_url || undefined,
      dependencies: latest.dependencies
        .filter((d) => d.dependency_type === 'required' && d.project_id)
        .map((d) => d.project_id!)
    }
  }
}
