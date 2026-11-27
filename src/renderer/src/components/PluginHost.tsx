import { useEffect, useRef, useState } from 'react'
import type { LauncherInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { errorText } from '../lib/format'
import { TitleBar } from './TitleBar'

/** Plugins whose interface is on screen; main watches their files (hot reload). */
const watched = new Map<string, number>()
function useAddonWatch(id: string): void {
  useEffect(() => {
    watched.set(id, (watched.get(id) ?? 0) + 1)
    void api.addons.watch([...watched.keys()]).catch(() => undefined)
    return () => {
      const n = (watched.get(id) ?? 1) - 1
      if (n > 0) watched.set(id, n)
      else watched.delete(id)
      void api.addons.watch([...watched.keys()]).catch(() => undefined)
    }
  }, [id])
}

/**
 * Shows an installed launcher's own interface in a sandboxed frame (its own bblauncher:// origin,
 * no Node, no IPC). The frame talks to BigBuncher with postMessage:
 *   frame → host  { __bb: 'req', id, method, args }
 *   host → frame  { __bb: 'res', id, ok, value | error }   and   { __bb: 'event', name: 'context', payload }
 * The host adds the launcher id itself, so a frame can only act as itself (main/launchers/launcherBridge.ts).
 * Saved html/css/js/json of the plugin reload the frame at once (rule «изменения видны сразу»).
 */
export function PluginFrame({ launcher, startPage }: { launcher: LauncherInfo; startPage?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { settings } = useApp()
  const [reload, setReload] = useState(0)
  const origin = new URL(launcher.entryUrl).origin
  const src = launcher.entryUrl + (reload ? `${launcher.entryUrl.includes('?') ? '&' : '?'}r=${reload}` : '') + (startPage ? `#${startPage}` : '')
  useAddonWatch(launcher.id)

  useEffect(() => api.on('addonChanged', (e) => e.id === launcher.id && setReload(Date.now())), [launcher.id])

  useEffect(() => {
    const onMessage = async (e: MessageEvent): Promise<void> => {
      const win = frame.current?.contentWindow
      const msg = e.data as { __bb?: string; id?: unknown; method?: unknown; args?: unknown } | null
      if (!win || e.source !== win || !msg || msg.__bb !== 'req') return
      const reply = (r: { ok: boolean; value?: unknown; error?: string }): void => win.postMessage({ __bb: 'res', id: msg.id, ...r }, origin)
      try {
        const value = await api.launchers.bridge(launcher.id, String(msg.method), Array.isArray(msg.args) ? msg.args : [])
        reply({ ok: true, value })
      } catch (err) {
        reply({ ok: false, error: errorText(err) })
      }
    }
    const listener = (e: MessageEvent): void => void onMessage(e)
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [launcher.id, origin])

  // A file downloaded in a browser: the launcher decides whether it's a mod for its game.
  useEffect(
    () => api.on('downloadedMod', (f) => frame.current?.contentWindow?.postMessage({ __bb: 'event', name: 'download', payload: f }, origin)),
    [origin]
  )

  // Language or icon changed in BigBuncher → tell the launcher.
  const icon = settings?.launcherIcons[launcher.id] ?? launcher.icons[0].key
  const accent = settings?.launcherAccents[launcher.id] ?? ''
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ __bb: 'event', name: 'context', payload: { lang: settings?.language, icon, accent } }, origin)
  }, [settings?.language, icon, accent, origin])

  return (
    <iframe
      ref={frame}
      src={src}
      title={launcher.name}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      data-no-i18n
    />
  )
}

export function PluginHost({ launcher }: { launcher: LauncherInfo }) {
  // BIGBUNCHER_PAGE=home/plugin=settings — opens that page of the launcher (screenshots: synthetic clicks don't reach the frame).
  const startPage = /plugin=([\w-]+)/.exec(location.hash)?.[1]
  return (
    <div className="plugin-host">
      <TitleBar />
      <PluginFrame launcher={launcher} startPage={startPage} />
    </div>
  )
}
