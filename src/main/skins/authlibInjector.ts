import { existsSync } from 'node:fs'
import { authlibInjectorPath } from '../core/paths'
import { downloadFile, fetchJson } from '../core/http'

/**
 * authlib-injector (https://github.com/yushijinhun/authlib-injector) is a Java agent that
 * redirects Minecraft's authlib from Mojang to a custom Yggdrasil server — here, the
 * launcher's own local server, which serves the user's skin to the game.
 */
const LATEST_URL = 'https://authlib-injector.yushi.moe/artifact/latest.json'
const GITHUB_LATEST = 'https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest'

async function resolveDownloadUrl(): Promise<string> {
  try {
    return (await fetchJson<{ download_url: string }>(LATEST_URL)).download_url
  } catch {
    const release = await fetchJson<{ assets: { name: string; browser_download_url: string }[] }>(GITHUB_LATEST)
    const jar = release.assets.find((a) => a.name.endsWith('.jar'))
    if (!jar) throw new Error('Не удалось найти authlib-injector')
    return jar.browser_download_url
  }
}

export async function ensureAuthlibInjector(): Promise<string> {
  const target = authlibInjectorPath()
  if (!existsSync(target)) await downloadFile(await resolveDownloadUrl(), target)
  return target
}
