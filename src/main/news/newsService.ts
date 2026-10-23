import type { NewsItem } from '../../shared/types'
import { fetchJson } from '../core/http'

const BASE = 'https://launchercontent.mojang.com'

interface PatchNotes {
  entries: {
    id: string
    title: string
    version: string
    type: string
    date: string
    shortText: string
    image?: { url: string }
  }[]
}

let cache: { at: number; items: NewsItem[] } | undefined

/** Official Java Edition patch notes (the feed the Mojang launcher shows). */
export async function latestNews(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache.items
  const notes = await fetchJson<PatchNotes>(`${BASE}/v2/javaPatchNotes.json`)
  const items = notes.entries
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)
    .map((e) => ({
      id: e.id,
      title: e.title,
      text: e.shortText,
      version: e.version,
      date: e.date,
      imageUrl: e.image ? BASE + e.image.url : undefined
    }))
  cache = { at: Date.now(), items }
  return items
}
