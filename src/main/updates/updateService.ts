import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateInfo } from '../../shared/types'
import { emit } from '../core/events'
import { downloadFile, fetchJson } from '../core/http'
import { runTask } from '../core/tasks'

/**
 * Self-update for the portable exe via GitHub Releases.
 * Publishing a release (scripts/publish-release.ps1) uploads release/BigBuncher.exe to
 * github.com/<UPDATE_REPO>/releases with tag v<version>; every launcher checks it on start.
 */
export const UPDATE_REPO = 'ahmaPley/BigBuncher'
const ASSET_NAME = 'BigBuncher.exe'
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

interface GithubRelease {
  tag_name: string
  body?: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string; size: number }[]
}

let state: UpdateInfo = { currentVersion: app.getVersion(), available: false, source: `github.com/${UPDATE_REPO}` }
let downloadUrl: string | undefined
let downloadedFile: string | undefined

function publish(next: Partial<UpdateInfo>): UpdateInfo {
  state = { ...state, ...next }
  emit('update', state)
  return state
}

/** "1.2.10" > "1.2.9" */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export function getUpdateInfo(): UpdateInfo {
  return state
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    const release = await fetchJson<GithubRelease>(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`)
    const latest = release.tag_name.replace(/^v/i, '')
    const asset = release.assets.find((a) => a.name === ASSET_NAME)
    downloadUrl = asset?.browser_download_url
    return publish({
      latestVersion: latest,
      available: Boolean(asset) && isNewer(latest, state.currentVersion),
      notes: release.body?.trim() || undefined,
      error: undefined
    })
  } catch (err) {
    return publish({ error: `Не удалось проверить обновления: ${(err as Error).message}` })
  }
}

export async function downloadUpdate(): Promise<UpdateInfo> {
  if (!state.available || !downloadUrl) await checkForUpdates()
  if (!state.available || !downloadUrl) throw new Error('Обновлений нет — у вас последняя версия')
  const dir = join(app.getPath('userData'), 'update')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `BigBuncher-${state.latestVersion}.exe`)
  if (!existsSync(file)) {
    await runTask(`Обновление до ${state.latestVersion}`, (report) =>
      downloadFile(downloadUrl!, file, (got, total) => report.update(total ? got / total : -1, 'Скачивание новой версии'))
    )
  }
  downloadedFile = file
  return publish({ downloaded: true })
}

/**
 * Replaces the portable exe and restarts. The running exe is locked, so a tiny batch script
 * waits until the launcher has exited, copies the new file over it and starts it again.
 */
export async function installUpdate(): Promise<void> {
  const target = process.env.PORTABLE_EXECUTABLE_FILE
  if (!app.isPackaged || !target) throw new Error('Автообновление работает только в собранном BigBuncher.exe')
  if (!downloadedFile) await downloadUpdate()

  const script = join(app.getPath('temp'), `bigbuncher-update-${Date.now()}.cmd`)
  writeFileSync(
    script,
    [
      '@echo off',
      'chcp 65001 >nul',
      'set tries=0',
      ':copy',
      `copy /y "${downloadedFile}" "${target}" >nul 2>&1 && goto done`,
      'set /a tries+=1',
      'if %tries% geq 60 goto done',
      'timeout /t 1 /nobreak >nul',
      'goto copy',
      ':done',
      `start "" "${target}"`,
      'del "%~f0"'
    ].join('\r\n'),
    'utf8'
  )
  spawn('cmd.exe', ['/c', script], { detached: true, windowsHide: true, stdio: 'ignore' }).unref()
  app.quit()
}

/** Checks shortly after start and then periodically; the UI shows a banner when an update exists. */
export function scheduleUpdateChecks(): void {
  if (!app.isPackaged) return
  setTimeout(() => void checkForUpdates(), 5_000)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL)
}
