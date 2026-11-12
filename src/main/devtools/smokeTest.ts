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

/**
 * Two instances at once: both must reach the main menu while the other one runs.
 * Run:  BIGBUNCHER_SMOKE=multi npx electron .
 */
export async function runMultiTest(): Promise<void> {
  const { updateSettings } = await import('../settings/settingsService')
  const { addOfflineAccount } = await import('../auth/accountService')
  const { createInstance } = await import('../instances/instanceService')
  const { launchInstance, stopGame, getGameState } = await import('../minecraft/launchService')
  const { onAppEvent } = await import('../core/events')
  const log = (...a: unknown[]): void => console.log('[multi]', ...a)

  updateSettings({ gameDir: process.env.BIGBUNCHER_SMOKE_GAMEDIR, afterLaunch: 'keep', maxRamMb: 2048, preflightCheck: false })
  addOfflineAccount('MultiTester')
  const a = await createInstance({ name: 'multi-a', icon: 'grass', mcVersion: '1.21.1', loader: 'vanilla' })
  const b = await createInstance({ name: 'multi-b', icon: 'stone', mcVersion: '1.21.1', loader: 'vanilla' })
  const ready = new Set<string>()
  const both = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('both games did not load in 5 minutes')), 5 * 60_000)
    onAppEvent((event, payload) => {
      if (event === 'gameLog') {
        const p = payload as { instanceId: string; line: string }
        if (/Sound engine started/.test(p.line) && !ready.has(p.instanceId)) {
          ready.add(p.instanceId)
          log('ready:', p.instanceId, `(${ready.size}/2), running now:`, getGameState().sessions.length)
          if (ready.size === 2) {
            clearTimeout(timeout)
            resolve()
          }
        }
      }
    })
  })
  await launchInstance(a.id)
  await launchInstance(b.id)
  log('both processes started:', getGameState().sessions.map((s) => s.instanceId))
  let sameTwice = ''
  await launchInstance(a.id).catch((err: Error) => (sameTwice = err.message))
  log('same instance twice ->', sameTwice || 'NOT BLOCKED')
  await both
  if (getGameState().sessions.length !== 2) throw new Error('expected two running sessions')
  stopGame(a.id)
  await new Promise((r) => setTimeout(r, 4000))
  log('after stopping A, still running:', getGameState().sessions.map((s) => s.instanceId))
  if (getGameState().sessions.length !== 1 || getGameState().instanceId !== b.id) throw new Error('stopping A must leave B running')
  stopGame()
  await new Promise((r) => setTimeout(r, 3000))
  log('MULTI TEST PASSED')
}

/** zip containing pack.mcmeta = {"pack":{"pack_format":15,"description":"BigBuncher test"}} */
const TEST_PACK_ZIP_BASE64 =
  'UEsDBBQAAAAAAAAAAADvrz7hOwAAADsAAAALAAAAcGFjay5tY21ldGF7InBhY2siOnsicGFja19mb3JtYXQiOjE1LCJkZXNjcmlwdGlvbiI6IkJpZ0J1bmNoZXIgdGVzdCJ9fVBLAQIUABQAAAAAAAAAAADvrz7hOwAAADsAAAALAAAAAAAAAAAAAAAAAAAAAABwYWNrLm1jbWV0YVBLBQYAAAAAAQABADkAAABkAAAAAAA='

/**
 * BIGBUNCHER_SMOKE=share — share codes and pack files round trip, plus "check a server" against a fake
 * Forge server on localhost (status JSON with the packed mod list, like Forge 1.18+ sends).
 */
export async function runShareTest(): Promise<void> {
  const { updateSettings } = await import('../settings/settingsService')
  const { createInstance, addInstanceRecord, newInstanceId, getInstance } = await import('../instances/instanceService')
  const { installMod, listInstalledMods, setModEnabled, modsDir } = await import('../mods/modService')
  const share = await import('../share/shareService')
  const { checkServer, decodeForgeData } = await import('../share/serverCheck')
  const { listLoaderVersions } = await import('../minecraft/versionService')
  const { onAppEvent } = await import('../core/events')
  const { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } = await import('node:fs')
  const { createServer } = await import('node:net')
  const { deflateRawSync } = await import('node:zlib')
  type Diagnosis = import('../../shared/types').Diagnosis
  const log = (...a: unknown[]): void => console.log('[share]', ...a)
  const assert = (ok: unknown, msg: string): void => {
    if (!ok) throw new Error(`ASSERT: ${msg}`)
    log('ok -', msg)
  }
  const files = (id: string): string[] => (existsSync(modsDir(id)) ? readdirSync(modsDir(id)).sort() : [])

  updateSettings({ gameDir: process.env.BIGBUNCHER_SMOKE_GAMEDIR, afterLaunch: 'keep' })
  const fabric = await listLoaderVersions('fabric', '1.21.1')
  const loaderVersion = (fabric.find((v) => v.stable) ?? fabric[0]).version
  const a = await createInstance({ name: 'share-src', icon: 'log', mcVersion: '1.21.1', loader: 'fabric', loaderVersion })
  await installMod(a.id, 'modrinth', 'modmenu') // + Fabric API as a dependency
  const modmenu = listInstalledMods(a.id).find((m) => /modmenu/i.test(m.fileName))!
  setModEnabled(a.id, modmenu.fileName, false)
  writeFileSync(join(modsDir(a.id), 'my-local-mod.jar'), Buffer.from(TEST_PACK_ZIP_BASE64, 'base64'))
  mkdirSync(join(instanceDir(a.id), 'config'), { recursive: true })
  writeFileSync(join(instanceDir(a.id), 'config', 'share-test.toml'), 'hello = "friend"\n')
  log('source mods:', files(a.id))

  // --- pack code ---
  const res = await share.createShareCode(a.id)
  log('code length:', res.code.length, res.code.slice(0, 40) + '…')
  assert(res.code.startsWith('BB1-') && res.shared === files(a.id).length - 1, 'code carries every Modrinth mod')
  assert(res.missing.length === 1 && res.missing[0] === 'my-local-mod', 'local jar reported as not shareable by code')
  const preview = await share.previewCode(`  ${res.code.slice(0, 30)}\n${res.code.slice(30)}  `)
  assert(preview.kind === 'pack' && preview.mods === res.shared && preview.loader === 'fabric' && preview.loaderVersion === loaderVersion, 'preview survives line breaks')
  const bad = async (code: string): Promise<string> => share.previewCode(code).then(() => 'accepted', (e: Error) => e.message)
  assert((await bad('hello')) !== 'accepted', 'random text rejected')
  assert((await bad('BB1-AAAA')) !== 'accepted', 'broken code rejected')
  const evil = 'BB1-' + deflateRawSync(Buffer.from(JSON.stringify({ k: 'p', n: 'x', v: '1.21.1', l: 'fabric', m: ['../../etc'] }))).toString('base64url')
  assert((await bad(evil)) !== 'accepted', 'malicious version id rejected')

  const b = (await share.importCode(res.code)).instance
  const expected = files(a.id).filter((f) => f !== 'my-local-mod.jar')
  log('imported mods:', files(b.id))
  assert(JSON.stringify(files(b.id)) === JSON.stringify(expected), 'friend gets the same jars (disabled stays disabled)')
  assert(getInstance(b.id).installed && getInstance(b.id).loaderVersion === loaderVersion, 'friend instance installed with the same loader')

  // --- mod code into another instance: dependency comes along ---
  const c = addInstanceRecord({ id: newInstanceId(), name: 'share-mod-target', icon: 'grass', mcVersion: '1.21.1', loader: 'fabric', loaderVersion, versionId: '1.21.1', installed: false, createdAt: Date.now() })
  const modCode = await share.createShareCode(a.id, modmenu.fileName)
  assert((await share.previewCode(modCode.code)).kind === 'mod', 'mod code previews as a mod')
  await share.importCode(modCode.code, c.id)
  log('mod target:', files(c.id))
  assert(files(c.id).some((f) => /modmenu/i.test(f)) && files(c.id).some((f) => /fabric-api/i.test(f)), 'mod + its Fabric API dependency installed')
  const local = await share.createShareCode(a.id, 'my-local-mod.jar').then(() => '', (e: Error) => e.message)
  assert(local.includes('Modrinth'), 'local jar cannot be shared by code: clear message')

  // --- pack file: local jar + config travel too ---
  const packFile = join(app.getPath('userData'), 'test.bbpack')
  await share.writeShareFile(a.id, packFile)
  const d = (await share.importShareFile(packFile)).instance
  log('file import mods:', files(d.id))
  assert(JSON.stringify(files(d.id)) === JSON.stringify(files(a.id)), 'pack file brings every jar, the local one too')
  assert(readFileSync(join(instanceDir(d.id), 'config', 'share-test.toml'), 'utf8').includes('friend'), 'config inside the pack file')

  // --- server check against a fake Forge server ---
  const varint = (n: number): number[] => {
    const out: number[] = []
    do {
      let x = n & 0x7f
      n >>>= 7
      if (n) x |= 0x80
      out.push(x)
    } while (n)
    return out
  }
  const encodeForge = (mods: { id: string; serverOnly: boolean }[]): string => {
    const bytes: number[] = [0, mods.length >> 8, mods.length & 0xff]
    const utf = (s: string): void => {
      const buf = Buffer.from(s)
      bytes.push(...varint(buf.length), ...buf)
    }
    for (const m of mods) {
      bytes.push(...varint(m.serverOnly ? 3 : 2)) // one channel (+ server-only flag)
      utf(m.id)
      if (!m.serverOnly) utf('1.0')
      utf('main')
      utf('1')
      bytes.push(1)
    }
    bytes.push(0)
    let out = String.fromCharCode(bytes.length & 0x7fff, bytes.length >> 15)
    let buffer = 0
    let bits = 0
    for (const byte of bytes) {
      buffer |= byte << bits
      bits += 8
      if (bits >= 15) {
        out += String.fromCharCode(buffer & 0x7fff)
        buffer >>>= 15
        bits -= 15
      }
    }
    if (bits > 0) out += String.fromCharCode(buffer & 0x7fff)
    return out
  }
  const serverMods = [
    { id: 'forge', serverOnly: false },
    { id: 'jei', serverOnly: false },
    { id: 'geckolib', serverOnly: false },
    { id: 'spark', serverOnly: true }
  ]
  const decoded = decodeForgeData(encodeForge(serverMods))
  assert(decoded.mods.map((m) => m.id).join() === 'forge,jei,geckolib,spark' && decoded.mods[3].serverOnly, 'forge mod list decoder')

  const status = JSON.stringify({
    version: { name: '1.20.1', protocol: 763 },
    players: { online: 3, max: 20 },
    description: { text: 'BigBuncher ', extra: [{ text: 'test server' }] },
    forgeData: { channels: [], mods: [], fmlNetworkVersion: 3, truncated: false, d: encodeForge(serverMods) }
  })
  const server = createServer((socket) => {
    socket.on('error', () => undefined)
    socket.once('data', () => {
      const body = Buffer.from(status)
      const payload = Buffer.concat([Buffer.from(varint(0)), Buffer.from(varint(body.length)), body])
      socket.end(Buffer.concat([Buffer.from(varint(payload.length)), payload]))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const forgeInst = addInstanceRecord({ id: newInstanceId(), name: 'share-forge', icon: 'furnace', mcVersion: '1.20.1', loader: 'forge', loaderVersion: '47.4.10', versionId: '1.20.1', installed: false, createdAt: Date.now() })
  mkdirSync(modsDir(forgeInst.id), { recursive: true })
  let published: Diagnosis | undefined
  const off = onAppEvent((event, payload) => {
    if (event === 'diagnosis') published = payload as Diagnosis
  })
  const st = await checkServer(forgeInst.id, `127.0.0.1:${port}`)
  log('server status:', JSON.stringify(st))
  assert(st.online && st.loader === 'forge' && st.version === '1.20.1' && st.motd === 'BigBuncher test server', 'ping read version, loader, motd')
  assert(st.missing.join() === 'jei,geckolib', 'missing = jei + geckolib (forge builtin and server-only spark skipped)')
  assert(published?.phase === 'server' && published.problems[0].fixes[0].action.kind === 'installMods', 'doctor opened with one "install all" fix')

  published = undefined
  const wrong = await checkServer(b.id, `127.0.0.1:${port}`)
  const titles = (published as Diagnosis | undefined)?.problems.map((p) => p.title) ?? []
  log('fabric instance vs forge server:', titles)
  assert(!wrong.ok && titles.includes('Сервер на другой версии (1.20.1)') && titles.some((t) => t.startsWith('Сервер на Forge')), 'fabric 1.21.1 instance: version + loader mismatch')
  off()
  server.close()
  const closed = await checkServer(b.id, '127.0.0.1:1')
  assert(!closed.online && closed.error, `closed port reported: ${closed.error}`)
  // BIGBUNCHER_SMOKE_SERVER=host[:port] — also ping a real server (prints what it announced)
  if (process.env.BIGBUNCHER_SMOKE_SERVER) {
    const real = await checkServer(b.id, process.env.BIGBUNCHER_SMOKE_SERVER)
    log('real server:', JSON.stringify({ ...real, mods: real.mods?.length }))
    assert(real.online, 'real server answered the ping')
  }
  log('SHARE TEST PASSED')
}
