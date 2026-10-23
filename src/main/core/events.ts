import { BrowserWindow } from 'electron'
import { EVENT_CHANNEL_PREFIX, type AppEventName, type AppEvents } from '../../shared/ipc'

type Listener = <E extends AppEventName>(event: E, payload: AppEvents[E]) => void
const localListeners = new Set<Listener>()

/** Sends a typed push event to every open renderer window (and in-process listeners). */
export function emit<E extends AppEventName>(event: E, payload: AppEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL_PREFIX + event, payload)
  }
  localListeners.forEach((listener) => listener(event, payload))
}

/** Subscribes main-process code (e.g. the smoke test) to app events. */
export function onAppEvent(listener: Listener): () => void {
  localListeners.add(listener)
  return () => localListeners.delete(listener)
}
