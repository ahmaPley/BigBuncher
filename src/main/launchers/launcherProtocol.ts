import { net, protocol, type WebContents } from 'electron'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launcherDir } from '../core/paths'

/**
 * bblauncher://<id>/<path> serves the files of an installed launcher. Each launcher gets its own
 * origin, so its frame cannot reach the BigBuncher page or other launchers.
 */
export const LAUNCHER_SCHEME = 'bblauncher'

/** Must run before app ready. */
export function registerLauncherScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: LAUNCHER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

export function serveLauncherFiles(): void {
  protocol.handle(LAUNCHER_SCHEME, async (request) => {
    const url = new URL(request.url)
    const id = url.hostname
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(id)) return new Response('Not found', { status: 404 })
    const root = launcherDir(id)
    const file = resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''))
    const rel = relative(root, file)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString())
    // CORS so the BigBuncher page can draw a launcher's icon on a canvas (window icon).
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    // plugin files change while editing (Дополнения → Редактор) — never serve a stale copy
    headers.set('Cache-Control', 'no-cache')
    return new Response(res.body, { status: res.status, headers })
  })
}

/** A launcher frame may only navigate inside bblauncher:// (links to sites open in the browser). */
export function guardLauncherFrames(contents: WebContents): void {
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !event.url.startsWith(`${LAUNCHER_SCHEME}://`)) event.preventDefault()
  })
}
