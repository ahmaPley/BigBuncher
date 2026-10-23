import { app, nativeImage } from 'electron'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoaderId } from '../../shared/types'
import { instanceDir } from '../core/paths'

/**
 * End-to-end check against the real services (real downloads, real game launch).
 * Run:  npx electron-vite build && BIGBUNCHER_SMOKE=1 npx electron .
 * Options (env):
 *   BIGBUNCHER_SMOKE_MC=1.21.1          Minecraft version
 *   BIGBUNCHER_SMOKE_LOADERS=fabric,... loaders to install (default: all four)
 *   BIGBUNCHER_SMOKE_LAUNCH=fabric      loader instance to launch with an offline skin (empty = skip)
 *   BIGBUNCHER_SMOKE_PACK=<dir>         instead: copy <dir> (mods/, config/…) into a fresh instance and launch it
 *   BIGBUNCHER_SMOKE_PACK_LOADER=neoforge:21.1.264
 * Uses a temporary userData folder, but the real game folder so downloads are cached.
 */
export function prepareSmokeTestPaths(): void {
  const realGameDir = join(app.getPath('appData'), '.bigbuncher')
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'bigbuncher-smoke-')))
  process.env.BIGBUNCHER_SMOKE_GAMEDIR = realGameDir
}

export async function runSmokeTest(): Promise<void> {
  const { updateSettings } = await import('../settings/settingsService')
  const { addOfflineAccount } = await import('../auth/accountService')
  const { createInstance, listInstances } = await import('../instances/instanceService')
  const { listLoaderVersions } = await import('../minecraft/versionService')
  const { installMod, listInstalledMods } = await import('../mods/modService')
  const { saveSkin } = await import('../skins/skinLibrary')
  const { applySkinToAccount } = await import('../skins/skinService')
  const { onAppEvent } = await import('../core/events')

  const log = (...args: unknown[]): void => console.log('[smoke]', ...args)
  const mc = process.env.BIGBUNCHER_SMOKE_MC ?? '1.21.1'
  const loaders = (process.env.BIGBUNCHER_SMOKE_LOADERS ?? 'fabric,quilt,neoforge,forge').split(',').filter(Boolean) as LoaderId[]
  const launchLoader = process.env.BIGBUNCHER_SMOKE_LAUNCH ?? 'fabric'

  onAppEvent((event, payload) => {
    if (event === 'task') {
      const t = payload as { title: string; status: string; progress: number; detail?: string; error?: string }
      if (t.status !== 'running') log(`task ${t.status}: ${t.title}`, t.error ?? '')
    }
  })

  updateSettings({ gameDir: process.env.BIGBUNCHER_SMOKE_GAMEDIR, afterLaunch: 'keep' })
  const account = addOfflineAccount('BunchTester')
  log('account', account)

  const packDir = process.env.BIGBUNCHER_SMOKE_PACK
  if (packDir) {
    const [loader, loaderVersion] = (process.env.BIGBUNCHER_SMOKE_PACK_LOADER ?? 'neoforge:21.1.264').split(':') as [LoaderId, string]
    const inst = await createInstance({ name: 'smoke-pack', icon: 'grass', mcVersion: mc, loader, loaderVersion })
    cpSync(packDir, instanceDir(inst.id), { recursive: true })
    log('pack copied into', instanceDir(inst.id))
    await launchAndWait(inst.id, 15 * 60_000)
    return
  }

  for (const loader of loaders) {
    const versions = await listLoaderVersions(loader, mc)
    const pick = versions.find((v) => v.stable) ?? versions[0]
    log(`${loader}: ${versions.length} versions, installing ${pick?.version}`)
    const started = Date.now()
    const inst = await createInstance({ name: `smoke-${loader}`, icon: 'grass', mcVersion: mc, loader, loaderVersion: pick?.version })
    log(`${loader} installed as ${inst.versionId} in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }

  const target = listInstances().find((i) => i.loader === launchLoader)
  if (!target) {
    log('no launch requested — done')
    return
  }

  if (target.loader === 'fabric' || target.loader === 'quilt') {
    const mods = await installMod(target.id, 'modrinth', 'modmenu') // Mod Menu (requires Fabric API)
    log('mods installed:', listInstalledMods(target.id).map((m) => m.title), mods.length)
  }

  // Bright red/green test skin, so the served texture is easy to recognise.
  const raw = Buffer.alloc(64 * 64 * 4)
  for (let i = 0; i < 64 * 64; i++) raw.set(i % 2 ? [40, 40, 220, 255] : [40, 200, 40, 255], i * 4)
  const skin = saveSkin({ name: 'smoke', model: 'classic', png: nativeImage.createFromBitmap(raw, { width: 64, height: 64 }).toPNG() })
  await applySkinToAccount(account.uuid, skin.id)

  await launchAndWait(target.id, 5 * 60_000)
}

/** Launches an instance, waits until the client finished loading and stays alive for 20s, then stops it. */
async function launchAndWait(instanceId: string, timeoutMs: number): Promise<void> {
  const { launchInstance, stopGame } = await import('../minecraft/launchService')
  const { onAppEvent } = await import('../core/events')
  const log = (...args: unknown[]): void => console.log('[smoke]', ...args)
  let exited = false
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`game did not finish loading in ${timeoutMs / 60_000} minutes`)), timeoutMs)
    onAppEvent((event, payload) => {
      if (event === 'gameLog') {
        const line = (payload as { line: string }).line
        if (/ERROR|Exception|Sound engine started|Created: .*atlas|authlib-injector/i.test(line)) log('game:', line.slice(0, 220))
        if (/Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks/.test(line)) {
          clearTimeout(timeout)
          resolve()
        }
      }
      if (event === 'game' && !(payload as { running: boolean }).running) {
        exited = true
        clearTimeout(timeout)
        reject(new Error('game exited before it was ready'))
      }
    })
  })

  await launchInstance(instanceId)
  log('game process started, waiting for the client to load…')
  await ready
  log('client loaded — keeping it alive 20s (skin fetch, late crashes)')
  await new Promise((r) => setTimeout(r, 20_000))
  if (exited) throw new Error('game crashed right after loading')
  stopGame()
  log('SMOKE TEST PASSED')
}

/**
 * Feature check for multi-packs and shared resource packs (no game launch).
 * Run:  BIGBUNCHER_SMOKE=features npx electron .
 */
export async function runFeatureTest(): Promise<void> {
  const { updateSettings } = await import('../settings/settingsService')
  const { createInstance, getInstance, listInstances } = await import('../instances/instanceService')
  const mp = await import('../instances/multiPackService')
  const packs = await import('../resourcepacks/resourcePackService')
  const { checkForUpdates } = await import('../updates/updateService')
  const { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } = await import('node:fs')
  const { gameDir, instanceDir } = await import('../core/paths')
  const log = (...a: unknown[]): void => console.log('[features]', ...a)
  const assert = (ok: unknown, msg: string): void => {
    if (!ok) throw new Error(`ASSERT: ${msg}`)
    log('ok -', msg)
  }

  updateSettings({ gameDir: process.env.BIGBUNCHER_SMOKE_GAMEDIR })
  const base = await createInstance({ name: 'feat-base', icon: 'grass', mcVersion: '1.21.1', loader: 'vanilla' })
  mkdirSync(join(instanceDir(base.id), 'saves', 'Мир-тест'), { recursive: true })
  writeFileSync(join(instanceDir(base.id), 'saves', 'Мир-тест', 'level.dat'), 'x')
  writeFileSync(join(instanceDir(base.id), 'mods', 'a.jar'), 'jar')

  const pack = mp.createMultiPack(base.id, 'Тестовая мультисборка')
  assert(getInstance(base.id).multiPackId === pack.id, 'instance became state 1')
  const clone = await mp.addState(pack.id, { stateName: 'Копия', mode: 'clone', copyWorlds: false })
  assert(existsSync(join(instanceDir(clone.id), 'mods', 'a.jar')), 'clone copied mods')
  assert(!existsSync(join(instanceDir(clone.id), 'saves')), 'clone skipped worlds')
  mp.switchState(pack.id, base.id)
  const withWorlds = await mp.addState(pack.id, { stateName: 'С мирами', mode: 'clone', copyWorlds: true })
  assert(existsSync(join(instanceDir(withWorlds.id), 'saves', 'Мир-тест', 'level.dat')), 'clone with worlds copied cyrillic world')
  assert(mp.listMultiPacks()[0].activeStateId === withWorlds.id, 'new state became active')
  mp.switchState(pack.id, base.id)
  assert(mp.listMultiPacks()[0].activeStateId === base.id, 'switched back to state 1')
  const other = await createInstance({ name: 'feat-other', icon: 'stone', mcVersion: '1.21.1', loader: 'vanilla' })
  const attached = await mp.addState(pack.id, { stateName: '', mode: 'existing', existingInstanceId: other.id })
  assert(attached.multiPackId === pack.id && attached.stateName === 'feat-other', 'existing instance attached as state')
  assert(mp.listMultiPacks()[0].activeStateId === other.id, 'attached state became active')
  mp.switchState(pack.id, base.id)
  await mp.removeState(clone.id)
  assert(listInstances().filter((i) => i.multiPackId === pack.id).length === 3, 'state removed (to Recycle Bin)')

  // Shared resource pack: a minimal zip with pack.mcmeta is enough for the game and for us.
  const sharedDir = join(gameDir(), 'shared', 'resourcepacks')
  mkdirSync(sharedDir, { recursive: true })
  const zipFile = join(sharedDir, 'feat-test.zip')
  writeFileSync(zipFile, Buffer.from(TEST_PACK_ZIP_BASE64, 'base64'))
  const listed = await packs.listSharedPacks()
  const mine = listed.find((p) => p.fileName === 'feat-test.zip')
  assert(mine && mine.description === 'BigBuncher test' && mine.packFormat === 15, 'shared pack metadata read from zip')
  await packs.setSharedAutoEnable('feat-test.zip', true)
  packs.syncSharedPacksIntoInstance(base.id)
  assert(readdirSync(join(instanceDir(base.id), 'resourcepacks')).includes('feat-test.zip'), 'shared pack linked into instance')
  const options = readFileSync(join(instanceDir(base.id), 'options.txt'), 'utf8')
  assert(options.includes('"file/feat-test.zip"') && options.includes('incompatibleResourcePacks'), 'pack auto-enabled in options.txt')
  assert((await packs.listInstancePacks(base.id)).every((p) => p.fileName !== 'feat-test.zip'), 'synced pack hidden from instance list')
  await packs.removeSharedPack('feat-test.zip')
  packs.syncSharedPacksIntoInstance(base.id)
  assert(!existsSync(join(instanceDir(base.id), 'resourcepacks', 'feat-test.zip')), 'removed shared pack unlinked from instance')

  const upd = await checkForUpdates()
  log('update check:', JSON.stringify(upd))
  mp.dissolveMultiPack(pack.id)
  assert(listInstances().every((i) => !i.multiPackId), 'dissolve keeps states as instances')
  log('FEATURE TEST PASSED')
}

/** zip containing pack.mcmeta = {"pack":{"pack_format":15,"description":"BigBuncher test"}} */
const TEST_PACK_ZIP_BASE64 =
  'UEsDBBQAAAAAAAAAAADvrz7hOwAAADsAAAALAAAAcGFjay5tY21ldGF7InBhY2siOnsicGFja19mb3JtYXQiOjE1LCJkZXNjcmlwdGlvbiI6IkJpZ0J1bmNoZXIgdGVzdCJ9fVBLAQIUABQAAAAAAAAAAADvrz7hOwAAADsAAAALAAAAAAAAAAAAAAAAAAAAAABwYWNrLm1jbWV0YVBLBQYAAAAAAQABADkAAABkAAAAAAA='
