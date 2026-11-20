import { app } from 'electron'
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { extname, join } from 'node:path'
import type { DownloadedFile } from '../../shared/types'
import { emit } from '../core/events'
import { getSettings } from '../settings/settingsService'

/**
 * Mods downloaded from ANY browser: watches the Downloads folder and tells the UI when a mod file lands there.
 * Where it came from is taken from the NTFS "Zone.Identifier" stream that every browser on Windows writes
 * (HostUrl / ReferrerUrl) — so we can say "from Modrinth" without any browser extension.
 */
const MOD_EXTS = new Set(['.jar', '.dll', '.zip', '.mrpack', '.bbpack', '.bbmods', '.pak', '.tmod', '.win'])
const TEMP_EXTS = /\.(crdownload|part|partial|download|tmp|opdownload)$/i

let watcher: FSWatcher | undefined
const seen = new Map<string, number>() // path → mtime already reported

const SITES: [RegExp, string][] = [
  [/(^|\.)modrinth\.com$/, 'Modrinth'],
  [/(^|\.)(curseforge\.com|forgecdn\.net)$/, 'CurseForge'],
  [/(^|\.)(github\.com|githubusercontent\.com)$/, 'GitHub'],
  [/(^|\.)nexusmods\.com$/, 'Nexus Mods'],
  [/(^|\.)thunderstore\.io$/, 'Thunderstore'],
  [/(^|\.)planetminecraft\.com$/, 'Planet Minecraft'],
  [/(^|\.)gamebanana\.com$/, 'GameBanana'],
  [/(^|\.)mediafire\.com$/, 'MediaFire']
]

/** Human name of the site a URL belongs to ("Modrinth", "CurseForge"… or just the domain). */
export function siteOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return SITES.find(([re]) => re.test(host))?.[1] ?? host
  } catch {
    return undefined
  }
}

/** Where a downloaded file came from (Windows Mark-of-the-Web). The referrer page is better than the CDN host. */
export function readDownloadOrigin(path: string): { site?: string; url?: string } {
  try {
    const zone = readFileSync(`${path}:Zone.Identifier`, 'utf8')
    const host = /^HostUrl=(.+)$/m.exec(zone)?.[1]?.trim()
    const referrer = /^ReferrerUrl=(.+)$/m.exec(zone)?.[1]?.trim()
    const url = referrer && !/^about:/.test(referrer) ? referrer : host
    return { url, site: siteOf(referrer) ?? siteOf(host) }
  } catch {
    return {}
  }
}

async function settle(path: string): Promise<boolean> {
  // A browser may still be writing: wait until the size stops changing.
  let last = -1
  for (let i = 0; i < 20; i++) {
    if (!existsSync(path)) return false
    const size = statSync(path).size
    if (size > 0 && size === last) return true
    last = size
    await new Promise((r) => setTimeout(r, 700))
  }
  return false
}

async function onChange(dir: string, name: string): Promise<void> {
  if (!name || TEMP_EXTS.test(name)) return
  const ext = extname(name).toLowerCase()
  if (!MOD_EXTS.has(ext)) return
  const path = join(dir, name)
  if (!(await settle(path))) return
  const st = statSync(path)
  const mtime = st.mtimeMs
  // Windows постоянно «трогает» старые файлы (антивирус, проводник, превью) — fs.watch шлёт на них события.
  // Предлагаем только то, что реально только что скачали: файл появился в «Загрузках» не раньше 10 минут назад.
  if (Date.now() - st.birthtimeMs > 10 * 60_000) return
  if (seen.get(path) === mtime) return
  seen.set(path, mtime)
  const origin = readDownloadOrigin(path)
  const file: DownloadedFile = { path, fileName: name, ext, sizeBytes: statSync(path).size, ...origin }
  console.log('[downloads] mod downloaded:', name, origin.site ?? '')
  emit('downloadedMod', file)
}

/** Starts or stops watching according to the setting (called at startup and when settings change). */
export function syncDownloadWatcher(): void {
  const on = getSettings().watchDownloads !== false
  if (!on) {
    watcher?.close()
    watcher = undefined
    return
  }
  if (watcher) return
  const dir = app.getPath('downloads')
  if (!existsSync(dir)) return
  watcher = watch(dir, (_event, name) => void onChange(dir, String(name ?? '')))
  watcher.on('error', () => {
    watcher = undefined
  })
}
