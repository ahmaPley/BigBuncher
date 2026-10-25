import { translate, type Language } from '../../../shared/i18n'

/**
 * Applies the interface language to the DOM: every text node and the placeholder / title /
 * aria-label attributes go through translate() (Russian source → English), including texts
 * React updates later (MutationObserver). Logs and user input are left alone.
 * Switching back to Russian reloads the window (the original texts are gone by then).
 */

const ATTRS = ['placeholder', 'title', 'aria-label']
// log lines are game output, but the hint shown in an empty log is UI text
const SKIP = '.log-view > :not(.log-hint), input, textarea, [data-no-i18n]'
const STORAGE_KEY = 'bigbuncher.language'

let current: Language = readStored()
let observer: MutationObserver | undefined

function readStored(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ru' ? 'ru' : 'en'
  } catch {
    return 'en'
  }
}

export const getLanguage = (): Language => current

/** Locale for dates and numbers. */
export const locale = (): string => (current === 'en' ? 'en-US' : 'ru-RU')

function skipped(el: Element | null): boolean {
  return Boolean(el?.closest(SKIP))
}

function translateText(node: Text): void {
  const v = node.nodeValue
  if (!v || skipped(node.parentElement)) return
  const t = translate(v)
  if (t !== v) node.nodeValue = t
}

function translateAttrs(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v) {
      const t = translate(v)
      if (t !== v) el.setAttribute(a, t)
    }
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const el = root as Element
  if (skipped(el)) return
  translateAttrs(el)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text)
    else translateAttrs(n as Element)
  }
}

/** Starts (en) or stops (ru) translating; returns true when a reload is needed to restore Russian. */
export function applyLanguage(lang: Language): boolean {
  const needsReload = current === 'en' && lang === 'ru' && Boolean(observer)
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = lang
  if (lang === 'ru') {
    observer?.disconnect()
    observer = undefined
    return needsReload
  }
  if (observer) return false
  translateTree(document.body)
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') translateText(m.target as Text)
      else if (m.type === 'attributes') translateAttrs(m.target as Element)
      else m.addedNodes.forEach(translateTree)
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  return false
}
