import { app, BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { JsonStore } from '../core/jsonStore'
import { launcherDataFile, launcherDir } from '../core/paths'
import { getSettings, updateSettings } from '../settings/settingsService'
import { activateLauncher, backendPath, getManifest, refreshLauncherIcons, setLauncherIcon } from './launcherService'

/**
 * What a launcher's interface may do. The frame has no Node or IPC: it posts a message to the
 * BigBuncher page, which forwards it here with the launcher id it knows (never trusting the frame
 * to say who it is). Everything that touches the PC goes through this small list.
 */
const OPENABLE_FILES = new Set(['.log', '.txt', '.json', '.md'])
const stores = new Map<string, JsonStore<Record<string, unknown>>>()

const store = (id: string): JsonStore<Record<string, unknown>> => {
  let s = stores.get(id)
  if (!s) stores.set(id, (s = new JsonStore<Record<string, unknown>>(launcherDataFile(id), () => ({}))))
  return s
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`bridge: ${what} must be a string`)
  return v
}
const strArray = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`bridge: ${what} must be a string[]`)
  return v as string[]
}

/** Runs the launcher's backend program; it prints JSON, {"error": "..."} becomes an Error. */
function runBackend(id: string, args: string[]): Promise<unknown> {
  const exe = backendPath(id)
  return new Promise((ok, fail) => {
    execFile(exe, args, { cwd: launcherDir(id), windowsHide: true, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      let parsed: unknown
      try {
        parsed = stdout.trim() ? JSON.parse(stdout) : null
      } catch {
        return fail(new Error(err ? err.message : `Программа лаунчера ответила не JSON: ${stdout.slice(0, 200)}`))
      }
      const error = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : undefined
      if (error) return fail(new Error(error))
      if (err) return fail(err)
      ok(parsed)
    })
  })
}

export async function bridgeCall(id: string, method: string, args: unknown[]): Promise<unknown> {
  const manifest = getManifest(id)
  const win = BrowserWindow.getAllWindows()[0]
  switch (method) {
    case 'context': {
      const s = getSettings()
      return {
        launcherId: id,
        lang: s.language,
        icon: s.launcherIcons[id] ?? manifest.icons[0].key,
        accent: s.launcherAccents[id] ?? '',
        appVersion: app.getVersion()
      }
    }
    case 'setAccent': {
      // '' = own colour of the launcher; otherwise a CSS hex colour
      const color = str(args[0], 'color')
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('bridge: color must be #rrggbb')
      updateSettings({ launcherAccents: { ...getSettings().launcherAccents, [id]: color } })
      return null
    }
    case 'backend':
      return runBackend(id, strArray(args[0], 'args'))
    case 'getData':
      return store(id).get()
    case 'setData': {
      const patch = args[0]
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('bridge: setData needs an object')
      return store(id).set({ ...store(id).get(), ...(patch as Record<string, unknown>) })
    }
    case 'pickFiles': {
      const res = await dialog.showOpenDialog(win, {
        title: str(args[0], 'title'),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: str(args[0], 'title'), extensions: strArray(args[1], 'extensions') }]
      })
      return res.canceled ? [] : res.filePaths
    }
    case 'pickSaveFile': {
      // «Поделиться сборкой»: куда сохранить архив. Только расширения, которые попросил лаунчер.
      const res = await dialog.showSaveDialog(win, {
        title: str(args[0], 'title'),
        defaultPath: str(args[1], 'defaultName').replace(/[\\/:*?"<>|]/g, '_'),
        filters: [{ name: str(args[0], 'title'), extensions: strArray(args[2], 'extensions') }]
      })
      return res.canceled ? null : (res.filePath ?? null)
    }
    case 'pickDirectory': {
      const res = await dialog.showOpenDialog(win, { title: str(args[0], 'title'), properties: ['openDirectory'] })
      return res.canceled ? null : (res.filePaths[0] ?? null)
    }
    case 'openPath': {
      // Folders and plain-text files only: opening anything else could start a program.
      const path = str(args[0], 'path')
      if (!existsSync(path)) throw new Error('Файл не найден')
      if (!statSync(path).isDirectory() && !OPENABLE_FILES.has(extname(path).toLowerCase())) throw new Error('Этот файл открыть нельзя')
      const err = await shell.openPath(path)
      if (err) throw new Error(err)
      return null
    }
    case 'openExternal': {
      const url = str(args[0], 'url')
      if (!/^https?:\/\//.test(url)) throw new Error('Разрешены только http(s) ссылки')
      await shell.openExternal(url)
      return null
    }
    case 'openSteam': {
      // Только «проверить файлы» и «страница игры» в Steam, по номеру игры — никаких запусков чужого.
      const url = str(args[0], 'url')
      if (!/^steam:\/\/(validate|nav\/games\/details|store)\/\d+$/.test(url)) throw new Error('bridge: эта Steam-ссылка не разрешена')
      await shell.openExternal(url)
      return null
    }
    case 'setIcon':
      setLauncherIcon(id, str(args[0], 'key'))
      return null
    case 'refreshIcons':
      refreshLauncherIcons(id)
      return null
    case 'switchLauncher':
      activateLauncher(str(args[0], 'id'))
      return null
    case 'gameStarted':
      // Same behaviour as Minecraft launches: "after launch" setting.
      if (getSettings().afterLaunch === 'minimize') win?.minimize()
      return null
    default:
      throw new Error(`bridge: unknown method ${method}`)
  }
}
