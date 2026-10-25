/**
 * Interface language. The source texts are Russian; English comes from the dictionary in
 * i18n-en.ts. Entries may contain `${}` holes (template parts like a mod name or version) —
 * the English side refers to them as %1, %2… and whatever filled a hole is translated too
 * (so «Не хватает мода «${}»» with «Сборка» inside comes out fully English).
 *
 * The renderer applies translate() to every text node and placeholder/title (lib/i18nDom.ts),
 * so components keep plain Russian strings. Main uses it for OS dialogs and notifications.
 * No runtime imports: this file is shared by both processes.
 */
import { EN } from './i18n-en'

export type Language = 'ru' | 'en'

const CYR = /[А-Яа-яЁё]/
const exact = new Map<string, string>()
const patterns: { re: RegExp; en: string }[] = []

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const [ru, en] of EN) {
  const key = norm(ru)
  if (!key.includes('${}')) exact.set(key, en)
  else patterns.push({ re: new RegExp(`^${key.split('${}').map(escape).join('([\\s\\S]*?)')}$`), en })
}
// longer templates first: they are more specific than short ones like "${} ГБ"
patterns.sort((a, b) => b.re.source.length - a.re.source.length)

const cache = new Map<string, string>()

/** Russian → English for one UI text; returns the input unchanged when nothing matches. */
export function translate(text: string): string {
  if (!CYR.test(text)) return text
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text)![0]
  const core = norm(text)
  let out = cache.get(core)
  if (out === undefined) {
    out = translateCore(core, 0)
    if (cache.size > 5000) cache.clear()
    cache.set(core, out)
  }
  return lead + out + trail
}

function translateCore(core: string, depth: number): string {
  const hit = exact.get(core)
  if (hit !== undefined) return quotes(hit)
  if (depth < 4) {
    for (const p of patterns) {
      const m = p.re.exec(core)
      if (!m) continue
      return quotes(p.en.replace(/%(\d)/g, (_, i: string) => {
        const part = m[Number(i)] ?? ''
        return CYR.test(part) ? translatePart(part, depth + 1) : part
      }))
    }
  }
  // sentences joined at runtime: translate each one on its own
  const sentences = core.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/)
  if (depth < 4 && sentences.length > 1) {
    const parts = sentences.map((s) => translateCore(s, depth + 1))
    if (parts.some((p, i) => p !== sentences[i])) return parts.join(' ')
  }
  return quotes(core)
}

/** A hole's content: keep surrounding punctuation/spaces, translate the inside. */
function translatePart(part: string, depth: number): string {
  const whole = translateCore(norm(part), depth)
  if (whole !== quotes(norm(part))) return part.replace(norm(part), whole)
  const m = /^([\s«(":·,—-]*)([\s\S]*?)([\s»)":·,.—-]*)$/.exec(part)
  if (!m) return part
  return m[1] + translateCore(m[2], depth) + m[3]
}

/** Guillemets read oddly in English UI text. */
const quotes = (s: string): string => s.replace(/«/g, '“').replace(/»/g, '”')

/** Picks the text for the current language (main process). */
export function tr(language: Language, text: string): string {
  return language === 'en' ? translate(text) : text
}
