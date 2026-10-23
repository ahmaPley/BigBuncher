import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, EVENT_CHANNEL_PREFIX, type ExposedApi } from '../shared/ipc'

/**
 * Builds `window.bigbuncher` from API_METHODS: every method becomes an IPC invoke.
 * Main returns { ok, value } | { ok: false, error } so error messages survive the bridge intact.
 */
const api: Record<string, unknown> = {}

for (const [namespace, methods] of Object.entries(API_METHODS)) {
  const group: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of methods) {
    group[method] = async (...args) => {
      const res = await ipcRenderer.invoke(`${namespace}:${method}`, ...args)
      if (!res.ok) throw new Error(res.error)
      return res.value
    }
  }
  api[namespace] = group
}

api.on = (event: string, listener: (payload: unknown) => void) => {
  const channel = EVENT_CHANNEL_PREFIX + event
  const wrapped = (_: unknown, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('bigbuncher', api as unknown as ExposedApi)
