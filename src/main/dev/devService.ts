import { L } from '../core/i18n'
import { app, dialog, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
import type { DevLogLine, DevProfile, DevProjectInfo, ModPlatform } from '../../shared/types'
import { emit, onAppEvent } from '../core/events'
import { JsonStore } from '../core/jsonStore'
import { instanceDir } from '../core/paths'
import { parseModsToml } from '../diagnostics/jarScanner'
import { getInstance } from '../instances/instanceService'
import { getSettings } from '../settings/settingsService'

/**
 * "Режим разработчика модов": links a Gradle mod project to an instance, builds it,
 * drops the fresh jar into the instance's mods folder and launches the game with
 * debugger / mixin / quick-play options.
 */

let store: JsonStore<{ profiles: Record<string, DevProfile> }> | undefined
const getStore = (): JsonStore<{ profiles: Record<string, DevProfile> }> =>
  (store ??= new JsonStore(join(app.getPath('userData'), 'devprofiles.json'), () => ({ profiles: {} })))

const defaults = (instanceId: string): DevProfile => ({
  instanceId,
  buildTask: 'build',
  autoDeploy: true,
  debug: true,
  debugPort: 5005,
  suspend: false,
  mixinExport: false,
  mixinVerbose: false,
  quickPlayWorld: '',
  quickPlayServer: '',
  extraJvmArgs: ''
})

export function getProfile(instanceId: string): DevProfile {
  return { ...defaults(instanceId), ...getStore().get().profiles[instanceId] }
}

export function saveProfile(instanceId: string, patch: Partial<DevProfile>): DevProfile {
  const next = { ...getProfile(instanceId), ...patch, instanceId }
  next.debugPort = Math.min(65535, Math.max(1024, Math.round(next.debugPort) || 5005))
  getStore().update((d) => {
    d.profiles[instanceId] = next
  })
  syncWatcher(instanceId)
  return next
}

const log = (line: string, source: DevLogLine['source'] = 'deploy', level?: DevLogLine['level']): void =>
  emit('devLog', { source, line, level: level ?? (/error|failed|FAILURE|exception/i.test(line) ? 'error' : /warn|deprecat/i.test(line) ? 'warn' : 'info') })

/* ---------------- project ---------------- */

/** Mod source folders: the project itself and, for multi-loader projects, its loader subprojects. */
function projectRoots(dir: string): string[] {
  const roots = [dir]
  for (const sub of ['fabric', 'quilt', 'forge', 'neoforge', 'common']) if (existsSync(join(dir, sub))) roots.push(join(dir, sub))
  return roots
}

export function inspectProject(dir: string): DevProjectInfo {
  if (!existsSync(dir)) throw new Error('Папка проекта не найдена')
  const info: DevProjectInfo = { dir, hasGradle: existsSync(join(dir, 'gradlew.bat')) || existsSync(join(dir, 'build.gradle')) || existsSync(join(dir, 'build.gradle.kts')), jars: [] }
  for (const root of projectRoots(dir)) {
    const res = join(root, 'src', 'main', 'resources')
    if (!info.modId && existsSync(join(res, 'fabric.mod.json'))) {
      try {
        const j = JSON.parse(readFileSync(join(res, 'fabric.mod.json'), 'utf8'))
        Object.assign(info, { modId: j.id, modName: j.name, platform: 'fabric' as ModPlatform })
      } catch {
        /* templated json */
      }
    }
    for (const [file, platform] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']] as const) {
      const p = join(res, file)
      if (info.modId || !existsSync(p)) continue
      const mod = parseModsToml(readFileSync(p, 'utf8')).mods[0]
      if (mod) Object.assign(info, { modId: mod.id, modName: mod.name, platform })
    }
    info.jars.push(...builtJars(root, root === dir ? '' : basename(root)))
  }
  info.jars.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return info
}

const CLASSIFIER = /-(sources|javadoc|dev|dev-shadow|shadow-dev|api|slim|all-dev)\.jar$/i

/** Jars in <root>/build/libs; `prefix` (subproject name) is shown in front of the file name. */
function builtJars(root: string, prefix = ''): DevProjectInfo['jars'] {
  const libs = join(root, 'build', 'libs')
  if (!existsSync(libs)) return []
  return readdirSync(libs)
    .filter((f) => f.endsWith('.jar') && !CLASSIFIER.test(f))
    .map((f) => {
      const st = statSync(join(libs, f))
      return { fileName: prefix ? `${prefix}/${f}` : f, sizeBytes: st.size, modifiedAt: st.mtimeMs }
    })
}

export async function pickProject(instanceId: string): Promise<DevProfile> {
  const picked = await dialog.showOpenDialog({ title: L('Папка проекта мода (где build.gradle)'), properties: ['openDirectory'] })
  const dir = picked.filePaths[0]
  if (!dir) return getProfile(instanceId)
  const info = inspectProject(dir)
  if (!info.hasGradle) throw new Error('В этой папке нет Gradle-проекта (build.gradle / gradlew.bat)')
  return saveProfile(instanceId, { projectDir: dir })
}

/* ---------------- build & deploy ---------------- */

let gradle: ChildProcess | undefined

export function build(instanceId: string): Promise<void> {
  const profile = getProfile(instanceId)
  if (!profile.projectDir) throw new Error('Сначала выбери папку проекта')
  if (gradle) throw new Error('Сборка уже идёт')
  const dir = profile.projectDir
  const wrapper = existsSync(join(dir, 'gradlew.bat'))
  log(`> ${wrapper ? 'gradlew' : 'gradle'} ${profile.buildTask}`, 'gradle', 'info')
  return new Promise((resolve, reject) => {
    const child = spawn(wrapper ? 'gradlew.bat' : 'gradle', [...profile.buildTask.split(/\s+/).filter(Boolean), '--console=plain'], { cwd: dir, shell: true, windowsHide: true })
    gradle = child
    const pipe = (chunk: Buffer): void => {
      for (const l of chunk.toString().split(/\r?\n/)) if (l.trim()) log(l, 'gradle')
    }
    child.stdout?.on('data', pipe)
    child.stderr?.on('data', pipe)
    child.on('error', (err) => {
      gradle = undefined
      reject(err)
    })
    child.on('close', (code) => {
      gradle = undefined
      if (code === 0) {
        log('Сборка прошла успешно', 'gradle', 'info')
        resolve()
      } else reject(new Error(`Gradle завершился с кодом ${code} — смотри вывод в консоли`))
    })
  })
}

export function cancelBuild(): void {
  if (gradle?.pid) spawn('taskkill', ['/pid', String(gradle.pid), '/T', '/F'], { windowsHide: true })
}

/** Copies the newest built jar (for this instance's loader in multi-loader projects) into mods/. */
export function deploy(instanceId: string): DevProfile {
  const profile = getProfile(instanceId)
  if (!profile.projectDir) throw new Error('Сначала выбери папку проекта')
  const instance = getInstance(instanceId)
  const candidates = projectRoots(profile.projectDir).flatMap((root) =>
    builtJars(root).map((j) => ({ ...j, path: join(root, 'build', 'libs', basename(j.fileName)), root }))
  )
  const forLoader = candidates.filter((c) => basename(c.root).toLowerCase() === instance.loader || c.fileName.toLowerCase().includes(instance.loader))
  const pool = (forLoader.length ? forLoader : candidates).filter((c) => basename(c.root) !== 'common')
  const newest = pool.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
  if (!newest) throw new Error('В build/libs нет собранного jar — сначала «Собрать»')

  const mods = join(instanceDir(instanceId), 'mods')
  mkdirSync(mods, { recursive: true })
  const name = basename(newest.path)
  // The previous deploy is our own copy of a build output, not player data — safe to replace.
  if (profile.deployedFile && profile.deployedFile !== name) {
    rmSync(join(mods, profile.deployedFile), { force: true })
    rmSync(join(mods, `${profile.deployedFile}.disabled`), { force: true })
  }
  copyFileSync(newest.path, join(mods, name))
  log(`Скопирован ${name} → mods/`, 'deploy', 'info')
  return saveProfile(instanceId, { deployedFile: name })
}

export async function buildAndRun(instanceId: string): Promise<void> {
  await build(instanceId)
  deploy(instanceId)
  await restartGame(instanceId)
}

export async function restartGame(instanceId: string): Promise<void> {
  const { getGameState, launchInstance, stopGame } = await import('../minecraft/launchService')
  if (getGameState().running) {
    log('Перезапуск игры…', 'deploy', 'info')
    await new Promise<void>((resolve) => {
      const off = onAppEvent((event, payload) => {
        if (event === 'game' && !(payload as { running: boolean }).running) {
          off()
          resolve()
        }
      })
      stopGame()
      setTimeout(() => {
        off()
        resolve()
      }, 15_000)
    })
  }
  await launchInstance(instanceId)
}

/* ---------------- auto deploy ---------------- */

const watchers = new Map<string, FSWatcher[]>()

function syncWatcher(instanceId: string): void {
  watchers.get(instanceId)?.forEach((w) => w.close())
  watchers.delete(instanceId)
  const p = getProfile(instanceId)
  if (!getSettings().devMode || !p.autoDeploy || !p.projectDir || !existsSync(p.projectDir)) return
  let timer: NodeJS.Timeout | undefined
  const list: FSWatcher[] = []
  for (const root of projectRoots(p.projectDir)) {
    const libs = join(root, 'build', 'libs')
    mkdirSync(libs, { recursive: true })
    try {
      list.push(
        watch(libs, (_e, file) => {
          if (!file?.endsWith('.jar') || gradle) return // during a launcher build, deploy() runs right after it
          clearTimeout(timer)
          timer = setTimeout(async () => {
            try {
              deploy(instanceId)
              const { getGameState } = await import('../minecraft/launchService')
              if (getGameState().running) log('Игра запущена — нажми «Перезапустить», чтобы подхватить новый jar', 'deploy', 'warn')
            } catch (err) {
              log(String(err), 'deploy', 'error')
            }
          }, 1500)
        })
      )
    } catch {
      /* folder vanished */
    }
  }
  watchers.set(instanceId, list)
}

/** Starts the auto-deploy watchers for every profile (called on startup and when dev mode is switched on). */
export function startDevWatchers(): void {
  for (const id of Object.keys(getStore().get().profiles)) {
    try {
      syncWatcher(id)
    } catch {
      /* instance removed */
    }
  }
}

/* ---------------- launch options ---------------- */

/** Minecraft 1.20+ understands --quickPlaySingleplayer / --quickPlayMultiplayer. */
function hasQuickPlay(mcVersion: string): boolean {
  const [major, minor] = mcVersion.split(/[.-]/).map(Number)
  return major > 1 || (major === 1 && minor >= 20)
}

/** Extra JVM / game arguments of the dev profile (empty when dev mode is off). */
export function devLaunchArgs(instanceId: string): { jvm: string[]; game: string[] } {
  if (!getSettings().devMode) return { jvm: [], game: [] }
  const p = getProfile(instanceId)
  const instance = getInstance(instanceId)
  const jvm: string[] = []
  const game: string[] = []
  if (p.debug) jvm.push(`-agentlib:jdwp=transport=dt_socket,server=y,suspend=${p.suspend ? 'y' : 'n'},address=127.0.0.1:${p.debugPort}`)
  if (p.mixinExport) jvm.push('-Dmixin.debug.export=true')
  if (p.mixinVerbose) jvm.push('-Dmixin.debug.verbose=true', '-Dmixin.debug.countInjections=true')
  jvm.push(...p.extraJvmArgs.split(/\s+/).filter(Boolean))
  if (hasQuickPlay(instance.mcVersion)) {
    if (p.quickPlayWorld.trim()) game.push('--quickPlaySingleplayer', p.quickPlayWorld.trim())
    else if (p.quickPlayServer.trim()) game.push('--quickPlayMultiplayer', p.quickPlayServer.trim())
  }
  return { jvm, game }
}

/** Worlds of the instance, for the quick-play picker. */
export function listWorlds(instanceId: string): string[] {
  const saves = join(instanceDir(instanceId), 'saves')
  if (!existsSync(saves)) return []
  return readdirSync(saves).filter((w) => existsSync(join(saves, w, 'level.dat')))
}

export type DevFolder = 'mods' | 'config' | 'logs' | 'crash-reports' | 'mixin' | 'project'

export async function openDevFolder(instanceId: string, which: DevFolder): Promise<void> {
  const base = instanceDir(instanceId)
  const p =
    which === 'project' ? getProfile(instanceId).projectDir : which === 'mixin' ? join(base, '.mixin.out') : join(base, which)
  if (!p) throw new Error('Папка проекта не выбрана')
  mkdirSync(p, { recursive: true })
  await shell.openPath(p)
}
