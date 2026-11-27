import { app } from 'electron'
import { join } from 'node:path'
import type { Playtime } from '../../shared/types'
import { emit } from '../core/events'
import { JsonStore } from '../core/jsonStore'

/**
 * Played time per launcher (Minecraft and every zip launcher). A session starts when a game starts
 * and ends when it exits; running sessions are added live, and saved every minute so a crash loses little.
 */
let store: JsonStore<Playtime> | undefined
const getStore = (): JsonStore<Playtime> => (store ??= new JsonStore<Playtime>(join(app.getPath('userData'), 'playtime.json'), () => ({})))

/** "<launcherId>\n<session key>" → when the not yet saved part of the session began. */
const active = new Map<string, number>()
let timer: NodeJS.Timeout | undefined

function flush(): void {
  const now = Date.now()
  if (active.size === 0) return
  getStore().update((t) => {
    for (const [key, since] of active) {
      const launcher = key.split('\n')[0]
      t[launcher] = (t[launcher] ?? 0) + (now - since)
      active.set(key, now)
    }
  })
}

export function getPlaytime(): Playtime {
  const now = Date.now()
  const total = { ...getStore().get() }
  for (const [key, since] of active) {
    const launcher = key.split('\n')[0]
    total[launcher] = (total[launcher] ?? 0) + (now - since)
  }
  return total
}

export function startPlaySession(launcherId: string, key: string): void {
  const k = `${launcherId}\n${key}`
  if (active.has(k)) return
  active.set(k, Date.now())
  timer ??= setInterval(() => {
    flush()
    emit('playtime', getPlaytime())
  }, 60_000)
  emit('playtime', getPlaytime())
}

export function endPlaySession(launcherId: string, key: string): void {
  const k = `${launcherId}\n${key}`
  if (!active.has(k)) return
  flush()
  active.delete(k)
  if (active.size === 0 && timer) {
    clearInterval(timer)
    timer = undefined
  }
  emit('playtime', getPlaytime())
}

export function isPlaySessionActive(launcherId: string, key: string): boolean {
  return active.has(`${launcherId}\n${key}`)
}

app.on('before-quit', flush)
