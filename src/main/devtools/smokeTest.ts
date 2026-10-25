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

/**
 * Доктор крашей: analyzer checks on known log lines, then a real broken Fabric pack
 * (Mod Menu without Fabric API) that must be caught before launch, crash, get fixed on one click and start.
 * Run:  BIGBUNCHER_SMOKE=doctor npx electron .
 */
export async function runDoctorTest(): Promise<void> {
  const { updateSettings } = await import('../settings/settingsService')
  const { addOfflineAccount } = await import('../auth/accountService')
  const { createInstance, getInstance } = await import('../instances/instanceService')
  const { analyzeCrash, analyzeDisconnect } = await import('../diagnostics/crashAnalyzer')
  const doctor = await import('../diagnostics/crashDoctor')
  const { launchInstance, stopGame } = await import('../minecraft/launchService')
  const { onAppEvent } = await import('../core/events')
  const { fetchJson, downloadFile } = await import('../core/http')
  const log = (...a: unknown[]): void => console.log('[doctor]', ...a)
  const assert = (ok: unknown, msg: string): void => {
    if (!ok) throw new Error(`ASSERT: ${msg}`)
    log('ok -', msg)
  }

  updateSettings({ gameDir: process.env.BIGBUNCHER_SMOKE_GAMEDIR, afterLaunch: 'keep' })
  addOfflineAccount('DoctorTester')
  const { listLoaderVersions } = await import('../minecraft/versionService')
  const fabricVersions = await listLoaderVersions('fabric', '1.21.1')
  const loaderVersion = (fabricVersions.find((v) => v.stable) ?? fabricVersions[0]).version
  const inst = await createInstance({ name: 'doctor-fabric', icon: 'grass', mcVersion: '1.21.1', loader: 'fabric', loaderVersion })

  // --- analyzer on known messages ---
  const base = { instance: getInstance(inst.id), jars: [], maxRamMb: 2048, totalRamMb: 16384, customJava: false, jvmArgs: '' }
  const titles = (log: string, extra = {}): string[] => analyzeCrash({ ...base, log, ...extra }).map((p) => p.title)
  assert(titles(" - Mod 'Mod Menu' (modmenu) 11.0.3 requires version 0.100.1 or later of mod 'Fabric API' (fabric-api), which is missing!")[0] === 'Не хватает мода «Fabric API»', 'fabric missing dependency')
  assert(titles("\tMod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4.9,)', Actual version: '[MISSING]'")[0] === 'Не хватает мода «GeckoLib»', 'forge missing dependency')
  assert(titles('java.lang.OutOfMemoryError: Java heap space')[0] === 'Игре не хватило памяти', 'out of memory')
  assert(titles('Failed to create backend VULKAN: VK_ERROR_INCOMPATIBLE_DRIVER')[0] === 'Видеокарта не тянет Vulkan', 'vulkan failure')
  assert(titles('[main/ERROR]: Failed loading config file sodium-options.json ParsingException at C:\\x\\instances\\a\\config\\sodium-options.json').length > 0, 'broken config')
  const dis = (r: string, online = false): string => analyzeDisconnect(r, base, online)[0].title
  assert(dis('Outdated client! Please use 1.21.4') === 'Сервер на другой версии (1.21.4)', 'server version mismatch')
  assert(dis('multiplayer.disconnect.unverified_username') === 'Сервер пускает только лицензию', 'offline account on licensed server')
  assert(dis('Mismatched mod channel list: missing [create, flywheel]') === 'Моды не совпадают с сервером', 'mod mismatch on server')

  // --- real broken pack: a mod that needs Fabric API, without Fabric API ---
  type MrVersion = { files: { url: string; filename: string; primary: boolean }[]; dependencies: { project_id?: string; dependency_type: string }[] }
  let file: MrVersion['files'][number] | undefined
  for (const slug of ['jade', 'appleskin', 'continuity', 'emi']) {
    const versions = await fetchJson<MrVersion[]>(
      `https://api.modrinth.com/v2/project/${slug}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent('["1.21.1"]')}`
    )
    // P7dR8mSH = Fabric API on Modrinth
    if (versions[0]?.dependencies.some((dep) => dep.project_id === 'P7dR8mSH' && dep.dependency_type === 'required')) {
      file = versions[0].files.find((f) => f.primary) ?? versions[0].files[0]
      log('test mod:', slug, file.filename)
      break
    }
  }
  if (!file) throw new Error('no test mod that requires Fabric API')
  await downloadFile(file.url, join(instanceDir(inst.id), 'mods', file.filename))
  const pre = await doctor.preflight(inst.id)
  assert(pre?.problems.some((p) => p.title === 'Не хватает мода «Fabric API»'), `preflight caught missing Fabric API (${pre?.problems.map((p) => p.title)})`)

  const nextDiagnosis = (): Promise<import('../../shared/types').Diagnosis> =>
    new Promise((resolve) => {
      const off = onAppEvent((event, payload) => {
        if (event === 'diagnosis') {
          off()
          resolve(payload as import('../../shared/types').Diagnosis)
        }
      })
    })
  const crashed = nextDiagnosis()
  assert((await launchInstance(inst.id)) === 'blocked', 'launch blocked by preflight')
  await launchInstance(inst.id, { skipPreflight: true })
  const d = await crashed.then(() => nextDiagnosis())
  log('crash diagnosis:', d.headline, d.problems.map((p) => p.title))
  const fix = d.problems.find((p) => p.title === 'Не хватает мода «Fabric API»')
  assert(fix && fix.fixes[0].action.kind === 'installMod', 'crash explained with one-click install of Fabric API')

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('fixed game did not load in 6 minutes')), 6 * 60_000)
    onAppEvent((event, payload) => {
      if (event === 'gameLog' && /Sound engine started/.test((payload as { line: string }).line)) {
        clearTimeout(timeout)
        resolve()
      }
      if (event === 'diagnosis') reject(new Error(`still crashing: ${(payload as { headline: string }).headline}`))
    })
  })
  const res = await doctor.applyFixes(d.id, [fix!.fixes[0].action], true)
  log('fix result:', res)
  assert(res.done.length === 1 && res.relaunched, 'fix applied and game relaunched')
  await ready
  log('fixed game reached the main menu')
  stopGame()
  await new Promise((r) => setTimeout(r, 3000))
  log('DOCTOR TEST PASSED')
}

/** zip containing pack.mcmeta = {"pack":{"pack_format":15,"description":"BigBuncher test"}} */
const TEST_PACK_ZIP_BASE64 =
  'UEsDBBQAAAAAAAAAAADvrz7hOwAAADsAAAALAAAAcGFjay5tY21ldGF7InBhY2siOnsicGFja19mb3JtYXQiOjE1LCJkZXNjcmlwdGlvbiI6IkJpZ0J1bmNoZXIgdGVzdCJ9fVBLAQIUABQAAAAAAAAAAADvrz7hOwAAADsAAAALAAAAAAAAAAAAAAAAAAAAAABwYWNrLm1jbWV0YVBLBQYAAAAAAQABADkAAABkAAAAAAA='
