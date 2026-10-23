import type { LoaderId, ModProviderId, ModSearchQuery, ModSearchResult } from '../../../shared/types'

export interface ResolvedModFile {
  provider: ModProviderId
  projectId: string
  title: string
  version: string
  fileName: string
  url: string
  iconUrl?: string
  /** Required dependencies, as project ids of the same provider. */
  dependencies: string[]
}

/**
 * A mod hosting platform. Implement this and register it in ../modService.ts
 * to add a new source (the UI lists providers dynamically).
 */
export interface ModProvider {
  id: ModProviderId
  name: string
  availability(): { available: boolean; reason?: string }
  search(query: ModSearchQuery): Promise<ModSearchResult>
  /** Newest file of a project compatible with the Minecraft version and loader. */
  resolveFile(projectId: string, mcVersion: string, loader: LoaderId): Promise<ResolvedModFile>
}
