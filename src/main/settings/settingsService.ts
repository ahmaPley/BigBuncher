import { app } from 'electron'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '../../shared/types'
import { JsonStore } from '../core/jsonStore'
import { emit } from '../core/events'

function defaults(): Settings {
  const totalMb = Math.floor(totalmem() / 1024 / 1024)
  return {
    gameDir: join(app.getPath('appData'), '.bigbuncher'),
    minRamMb: 1024,
    maxRamMb: Math.max(2048, Math.min(6144, Math.floor(totalMb / 2 / 512) * 512)),
    javaPath: '',
    jvmArgs: '',
    resolution: { width: 1280, height: 720, fullscreen: false },
    afterLaunch: 'minimize',
    background: 'sunset',
    showSnapshots: false,
    curseforgeApiKey: '',
    preflightCheck: true,
    devMode: false,
    graphicsApi: 'ask'
  }
}

let store: JsonStore<Settings> | undefined

const getStore = (): JsonStore<Settings> =>
  (store ??= new JsonStore(join(app.getPath('userData'), 'settings.json'), defaults))

export function getSettings(): Settings {
  return getStore().get()
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = sanitize({ ...getSettings(), ...patch })
  getStore().set(next)
  emit('settingsChanged', next)
  return next
}

function sanitize(s: Settings): Settings {
  const maxRamMb = clamp(Math.round(s.maxRamMb), 512, 65536)
  return {
    ...s,
    gameDir: s.gameDir.trim() || defaults().gameDir,
    maxRamMb,
    minRamMb: clamp(Math.round(s.minRamMb), 256, maxRamMb),
    resolution: {
      width: clamp(Math.round(s.resolution.width), 640, 7680),
      height: clamp(Math.round(s.resolution.height), 480, 4320),
      fullscreen: Boolean(s.resolution.fullscreen)
    }
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v || min))
