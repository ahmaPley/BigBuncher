import { BrowserWindow, Notification, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { totalmem } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { BisectState, Diagnosis, FixAction, FixResult, Instance, ModJarInfo, Problem } from '../../shared/types'
import { findAccount } from '../auth/accountService'
import { emit, onAppEvent } from '../core/events'
import { fetchJson } from '../core/http'
import { L } from '../core/i18n'
import { instanceDir } from '../core/paths'
import { describeError } from '../core/tasks'
import { createInstance, getInstance, installInstance } from '../instances/instanceService'
import { installMod, setModEnabled } from '../mods/modService'
import { getSettings, updateSettings } from '../settings/settingsService'
import { analyzeCrash, analyzeDisconnect, jarIssues, prettyId, type AnalyzeContext } from './crashAnalyzer'
import { scanMods, type ScannedJar } from './jarScanner'

/**
 * "Доктор крашей": watches every game session, explains crashes and failed server joins,
 * and applies fixes on one click (optionally relaunching the game afterwards).
 */

const MODRINTH = 'https://api.modrinth.com/v2'
const MAX_LOG_LINES = 6000

interface Session {
  instanceId: string
  startedAt: number
  lines: string[]
  server?: string
  lastDisconnectAt: number
  pendingDisconnect?: { lines: string[]; timer: NodeJS.Timeout }
  fatalTimer?: NodeJS.Timeout
}

let session: Session | undefined
const diagnoses = new Map<string, Diagnosis>()
const lastByInstance = new Map<string, string>()
let bisecting = false

const modsDirOf = (instanceId: string): string => join(instanceDir(instanceId), 'mods')

export function publish(d: Diagnosis): Diagnosis {
  diagnoses.set(d.id, d)
  lastByInstance.set(d.instanceId, d.id)
  emit('diagnosis', d)
  return d
}

export function lastDiagnosis(instanceId: string): Diagnosis | null {
  const id = lastByInstance.get(instanceId)
  return (id && diagnoses.get(id)) || null
}

async function contextFor(instance: Instance, log: string, extra: Partial<AnalyzeContext> = {}): Promise<AnalyzeContext> {
  const s = getSettings()
  return {
    instance,
    log,
    jars: instance.loader === 'vanilla' ? [] : await scanMods(modsDirOf(instance.id), instance.loader, instance.mcVersion),
    maxRamMb: s.maxRamMb,
    totalRamMb: Math.floor(totalmem() / 1024 / 1024),
    customJava: Boolean(s.javaPath.trim()),
    jvmArgs: s.jvmArgs,
    ...extra
  }
}

/* ---------------- session tracking (called by launchService) ---------------- */

export function sessionStarted(instanceId: string): void {
  if (session?.pendingDisconnect) clearTimeout(session.pendingDisconnect.timer)
  session = { instanceId, startedAt: Date.now(), lines: [], lastDisconnectAt: 0 }
}

const CONNECTING = /Connecting to ([^\s,]+),\s*(\d+)/
const DISCONNECT = [
  /(?:Client )?[Dd]isconnected(?: from server)?(?: with reason)?:\s*(.+)/,
  /Couldn't connect to server(.*)/,
  /[Ll]ost connection:?\s*(.+)/,
  /Connection (?:lost|closed)[:\s]+(.+)/,
  /(Mismatched mod channel list.*|Missing (?:required )?mods.*|requires the following mods.*|rejected their client side version.*|Incompatible FML modded server.*|Channels \[.+\] rejected.*|Failed to negotiate.*)/,
  /(multiplayer\.disconnect\.[\w.]+.*)/
]

/**
 * Loader errors after which the game can't continue — but the process doesn't exit: Fabric opens
 * its own error window, Forge/NeoForge show an in-game error screen. The doctor closes the game
 * and explains right away instead of waiting for the player to close that window.
 */
const FATAL = /Incompatible mods found!|Mod resolution failed|Missing or unsupported mandatory dependencies|Failed to load mods|LoadingFailedException|ModLoadingException|Mod loading has failed|Encountered an unexpected exception|Preparing crash report with UUID/

export function sessionLine(line: string): void {
  const s = session
  if (!s) return
  s.lines.push(line)
  if (s.lines.length > MAX_LOG_LINES) s.lines.splice(0, s.lines.length - MAX_LOG_LINES)
  if (FATAL.test(line) && !s.fatalTimer) {
    // give the loader a moment to print the details, then stop the stuck process
    s.fatalTimer = setTimeout(async () => {
      const { getGameState, stopGame } = await import('../minecraft/launchService')
      if (session === s && getGameState().running) stopGame()
    }, bisecting ? 1500 : 4000)
  }
  if (bisecting) return

  const c = CONNECTING.exec(line)
  if (c) s.server = c[2] === '25565' ? c[1] : `${c[1]}:${c[2]}`

  if (s.pendingDisconnect) {
    if (s.pendingDisconnect.lines.length < 25) s.pendingDisconnect.lines.push(line)
    return
  }
  if (!s.server || Date.now() - s.lastDisconnectAt < 15_000) return
  if (!DISCONNECT.some((re) => re.test(line))) return
  // Collect the next lines too: the actual reason is often printed right after the first message.
  s.pendingDisconnect = {
    lines: [line],
    timer: setTimeout(() => void finishDisconnect(s), 1500)
  }
}

function reasonOf(lines: string[]): string {
  for (const l of lines) {
    for (const re of DISCONNECT) {
      const m = re.exec(l)
      if (m?.[1]?.trim()) return m[1].trim()
    }
  }
  return lines.join('\n')
}

async function finishDisconnect(s: Session): Promise<void> {
  const lines = s.pendingDisconnect?.lines ?? []
  s.pendingDisconnect = undefined
  s.lastDisconnectAt = Date.now()
  const reason = [reasonOf(lines), ...lines.slice(1)].join('\n').slice(0, 2000)
  const instance = getInstance(s.instanceId)
  const ctx = await contextFor(instance, '')
  const account = getSettings().selectedAccountId ? findAccount(getSettings().selectedAccountId!) : undefined
  const problems = analyzeDisconnect(reason, ctx, account?.type === 'microsoft')
  // Plain "Disconnected" (the player left on purpose) is not a problem.
  if (problems.length === 1 && problems[0].confidence === 'low' && /^(Disconnected|Quitting|disconnect\.quitting)\b/i.test(reasonOf(lines))) return
  const d = publish({
    id: randomUUID(),
    instanceId: s.instanceId,
    phase: 'disconnect',
    createdAt: Date.now(),
    headline: s.server ? `Не получилось играть на сервере ${s.server}` : 'Сервер отключил тебя',
    problems
  })
  notify(d)
}

function notify(d: Diagnosis): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isMinimized() && win.isFocused()) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title: `BigBuncher: ${L(d.headline)}`, body: L(`${d.problems[0]?.title ?? ''} — открой лаунчер, там решение в 1 клик`) })
  n.on('click', () => {
    win?.restore()
    win?.focus()
  })
  n.show()
}

/** Newest file in dir matching re, modified after `since`. */
function newestFile(dir: string, re: RegExp, since: number): string | undefined {
  if (!existsSync(dir)) return undefined
  let best: { path: string; mtime: number } | undefined
  for (const f of readdirSync(dir)) {
    if (!re.test(f)) continue
    const p = join(dir, f)
    const mtime = statSync(p).mtimeMs
    if (mtime >= since - 2000 && (!best || mtime > best.mtime)) best = { path: p, mtime }
  }
  return best?.path
}

const readText = (p?: string): string | undefined => {
  try {
    return p ? readFileSync(p, 'utf8') : undefined
  } catch {
    return undefined
  }
}

/** Gathers latest.log, the crash report and the JVM error file of the last run and explains them. */
async function diagnoseRun(instanceId: string, since: number, sessionLines: string[], exitCode?: number, crashReportText?: string): Promise<Diagnosis | null> {
  const instance = getInstance(instanceId)
  const dir = instanceDir(instanceId)
  const latest = join(dir, 'logs', 'latest.log')
  const logFromFile = existsSync(latest) && statSync(latest).mtimeMs >= since - 2000 ? readText(latest) : undefined
  const crashPath = newestFile(join(dir, 'crash-reports'), /^crash-.*\.txt$/, since)
  const crashReport = crashReportText || readText(crashPath)
  const hsErr = readText(newestFile(dir, /^hs_err_pid\d+\.log$/, since))
  // stdout carries early errors (before log4j starts) that never reach latest.log
  const log = `${logFromFile ?? ''}\n${sessionLines.join('\n')}`
  const ctx = await contextFor(instance, log, { crashReport, hsErr, exitCode })
  const problems = analyzeCrash(ctx)

  const crashed = (exitCode !== undefined && exitCode !== 0) || Boolean(crashReport) || Boolean(hsErr)
  const loaderError = /Some of your mods are incompatible|Missing or unsupported mandatory dependencies|Mod resolution failed|Error loading mods|LoadingFailedException|ModLoadingException|FormattedException/.test(log)
  if (!crashed && !loaderError) return null

  if (!problems.length) {
    const fixes: Problem['fixes'] = []
    if (ctx.jars.filter((j) => j.enabled).length > 1) fixes.push({ label: 'Найти сломанный мод автоматически', action: { kind: 'bisect' } })
    fixes.push({ label: 'Починить файлы игры', action: { kind: 'repairInstance' } })
    problems.push({
      title: 'Точную причину по логам определить не удалось',
      explanation:
        ctx.jars.length > 1
          ? 'В логах нет понятной подсказки. Лаунчер может сам найти виновника: он будет запускать игру с половиной модов и сужать круг, пока не найдёт мод, из-за которого краш (займёт несколько минут).'
          : 'В логах нет понятной подсказки. Попробуй починить файлы игры — лаунчер перепроверит и докачает всё, что повреждено.',
      confidence: 'low',
      evidence: (crashReport ?? log).split('\n').find((l) => /Exception|Error/.test(l))?.trim().slice(0, 300),
      fixes
    })
  }
  return publish({
    id: randomUUID(),
    instanceId,
    phase: 'crash',
    createdAt: Date.now(),
    headline: loaderError && !crashReport ? 'Моды не дали игре запуститься' : `Minecraft крашнулся${exitCode !== undefined ? ` (код ${exitCode})` : ''}`,
    problems,
    exitCode,
    crashReportPath: crashPath
  })
}

export async function sessionEnded(instanceId: string, exitCode: number, crashReport?: string): Promise<void> {
  const s = session?.instanceId === instanceId ? session : undefined
  session = undefined
  if (s?.pendingDisconnect) clearTimeout(s.pendingDisconnect.timer)
  if (bisecting) return
  try {
    const d = await diagnoseRun(instanceId, s?.startedAt ?? Date.now() - 60_000, s?.lines ?? [], exitCode, crashReport)
    if (d) {
      BrowserWindow.getAllWindows().forEach((w) => {
        w.restore()
        w.focus()
      })
    }
  } catch (err) {
    console.error('[doctor] analysis failed', err)
  }
}

/** "Проверить последний запуск" — analyses whatever the last run left in logs/ and crash-reports/. */
export async function analyzeLastRun(instanceId: string): Promise<Diagnosis | null> {
  const dir = instanceDir(instanceId)
  const latest = join(dir, 'logs', 'latest.log')
  const since = existsSync(latest) ? statSync(latest).mtimeMs - 10 * 60_000 : 0
  return diagnoseRun(instanceId, since, [], undefined)
}

/** Explains any pasted log / stack trace (dev console "Разобрать"). */
export async function analyzeText(instanceId: string, text: string): Promise<Diagnosis> {
  const instance = getInstance(instanceId)
  const ctx = await contextFor(instance, text, { crashReport: /---- Minecraft Crash Report ----/.test(text) ? text : undefined })
  const problems = analyzeCrash({ ...ctx, jars: ctx.jars.map((j) => ({ ...j, issues: [] })) })
  return publish({
    id: randomUUID(),
    instanceId,
    phase: 'crash',
    createdAt: Date.now(),
    headline: 'Разбор ошибки',
    problems: problems.length
      ? problems
      : [{ title: 'Знакомых признаков не нашёл', explanation: 'В этом тексте нет известных причин крашей. Попробуй выделить весь стек ошибки целиком (от строки с Exception до последней строки «at …»).', confidence: 'low', fixes: [] }]
  })
}

/** Static check before launch: wrong loader, duplicates, missing dependencies, corrupt jars. */
export async function preflight(instanceId: string): Promise<Diagnosis | null> {
  const instance = getInstance(instanceId)
  if (instance.loader === 'vanilla') return null
  const ctx = await contextFor(instance, '')
  const problems = jarIssues(ctx).filter((p) => p.confidence === 'high' || p.title.startsWith('Не хватает'))
  if (!problems.length) return null
  return publish({
    id: randomUUID(),
    instanceId,
    phase: 'preflight',
    createdAt: Date.now(),
    headline: 'Перед запуском нашёл проблемы с модами',
    problems
  })
}

/* ---------------- fixes ---------------- */

const ALIASES: Record<string, string> = {
  fabric: 'fabric-api', 'fabric-api-base': 'fabric-api', cloth_config: 'cloth-config', clothconfig: 'cloth-config', 'cloth-config2': 'cloth-config',
  architectury: 'architectury-api', kotlinforforge: 'kotlin-for-forge', fabric_language_kotlin: 'fabric-language-kotlin',
  forgeconfigapiport: 'forge-config-api-port', puzzleslib: 'puzzles-lib', owo: 'owo-lib', yet_another_config_lib_v3: 'yacl',
  'yet-another-config-lib': 'yacl', resourcefullib: 'resourceful-lib', bookshelf: 'bookshelf-lib', geckolib3: 'geckolib',
  prism: 'prism-lib', supermartijn642corelib: 'supermartijn642s-core-lib', supermartijn642configlib: 'supermartijn642s-config-lib',
  playeranimator: 'playeranimator', placeholder_api: 'placeholder-api', trinkets: 'trinkets', lithostitched: 'lithostitched'
}

interface MrHit { project_id: string; slug: string }

/** Finds the Modrinth project for a mod id that has a build for this instance. */
async function findProject(instance: Instance, modId: string, title?: string): Promise<string | undefined> {
  const loaders = instance.loader === 'quilt' ? ['quilt', 'fabric'] : [instance.loader]
  const hasBuild = async (project: string): Promise<boolean> => {
    const params = new URLSearchParams({ loaders: JSON.stringify(loaders), game_versions: JSON.stringify([instance.mcVersion]) })
    try {
      return (await fetchJson<unknown[]>(`${MODRINTH}/project/${project}/version?${params}`)).length > 0
    } catch {
      return false
    }
  }
  const candidates = [ALIASES[modId], modId, modId.replace(/_/g, '-')].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i)
  for (const c of candidates) if (await hasBuild(c)) return c
  const facets = JSON.stringify([['project_type:mod'], [`versions:${instance.mcVersion}`], loaders.map((l) => `categories:${l}`)])
  for (const query of [modId.replace(/[_-]/g, ' '), title].filter(Boolean) as string[]) {
    const res = await fetchJson<{ hits: MrHit[] }>(`${MODRINTH}/search?${new URLSearchParams({ query, facets, limit: '5' })}`)
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const exact = res.hits.find((h) => norm(h.slug) === norm(modId) || norm(h.slug) === norm(ALIASES[modId] ?? ''))
    if (exact) return exact.project_id
    if (res.hits[0] && query === title) return res.hits[0].project_id
  }
  return undefined
}

async function updateModFile(instance: Instance, fileName: string): Promise<string> {
  const dir = modsDirOf(instance.id)
  const path = join(dir, fileName)
  const jar = (await scanMods(dir, instance.loader, instance.mcVersion)).find((j) => j.fileName === fileName)
  let project: string | undefined
  if (existsSync(path)) {
    const sha1 = createHash('sha1').update(readFileSync(path)).digest('hex')
    try {
      project = (await fetchJson<{ project_id: string }>(`${MODRINTH}/version_file/${sha1}?algorithm=sha1`)).project_id
    } catch {
      /* not a Modrinth file */
    }
  }
  if (!project && jar?.ids[0]) project = await findProject(instance, jar.ids[0], jar.name)
  const disableOld = (why: string): string => {
    setModEnabled(instance.id, fileName, false)
    return `${why} — мод «${jar?.name ?? fileName}» выключен`
  }
  if (!project) return disableOld('Подходящей версии на Modrinth нет')
  const before = new Set(readdirSync(dir))
  try {
    await installMod(instance.id, 'modrinth', project)
  } catch (err) {
    return disableOld(describeError(err))
  }
  const added = readdirSync(dir).filter((f) => !before.has(f))
  if (!added.length) return disableOld('Это уже последняя версия, обновлять некуда')
  if (existsSync(path)) setModEnabled(instance.id, fileName, false) // the old jar stays as .disabled, just in case
  return `«${jar?.name ?? fileName}» обновлён: ${added.join(', ')}`
}

async function applyOne(instanceId: string, action: FixAction): Promise<string> {
  const instance = getInstance(instanceId)
  switch (action.kind) {
    case 'installMod': {
      const project = await findProject(instance, action.modId)
      if (!project) throw new Error(`Мод «${prettyId(action.modId)}» для ${instance.loader} ${instance.mcVersion} не найден на Modrinth`)
      await installMod(instanceId, 'modrinth', project)
      return `Установлен «${prettyId(action.modId)}»`
    }
    case 'disableMod':
      setModEnabled(instanceId, action.fileName, false)
      return `Выключен ${action.fileName} (включить обратно можно во вкладке «Моды»)`
    case 'updateMod':
      return updateModFile(instance, action.fileName)
    case 'setRam':
      updateSettings({ maxRamMb: action.maxRamMb })
      return `Выделено ${(action.maxRamMb / 1024).toFixed(1)} ГБ памяти`
    case 'autoJava':
      updateSettings({ javaPath: '' })
      return 'Java теперь выбирается автоматически'
    case 'clearJvmArgs':
      updateSettings({ jvmArgs: '' })
      return 'Аргументы JVM очищены'
    case 'setGraphics':
      updateSettings({ graphicsApi: action.api })
      return `Игра будет запускаться на ${action.api === 'opengl' ? 'OpenGL' : 'Vulkan'}`
    case 'repairInstance':
      await installInstance(instanceId)
      return 'Файлы игры проверены и докачаны'
    case 'trashFile': {
      const root = instanceDir(instanceId)
      const target = resolve(root, action.path)
      const rel = relative(root, target)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Файл вне папки сборки')
      if (existsSync(target)) await shell.trashItem(target)
      return `${action.path} перемещён в корзину`
    }
    case 'createInstance': {
      const created = await createInstance({ name: `${action.mcVersion} (для сервера)`, icon: 'grass', mcVersion: action.mcVersion, loader: 'vanilla' })
      return `Создана сборка «${created.name}»`
    }
    case 'openUrl':
      await shell.openExternal(action.url)
      return 'Открыта страница загрузки'
    case 'bisect':
      void startBisect(instanceId)
      return 'Запущен автопоиск сломанного мода'
    case 'openAccounts':
      return 'Открой окно аккаунтов'
  }
}

/** Applies fixes in order; failures don't stop the rest. Optionally launches the game again. */
export async function applyFixes(diagnosisId: string, actions: FixAction[], relaunch: boolean): Promise<FixResult> {
  const d = diagnoses.get(diagnosisId)
  if (!d) throw new Error('Диагноз устарел — запусти игру ещё раз')
  const result: FixResult = { done: [], failed: [], relaunched: false }
  let target = d.instanceId
  for (const action of actions) {
    try {
      result.done.push(await applyOne(d.instanceId, action))
      if (action.kind === 'createInstance') target = getSettings().selectedInstanceId ?? target
    } catch (err) {
      result.failed.push(describeError(err))
    }
  }
  if (relaunch && process.env.BIGBUNCHER_TRAILER) {
    result.relaunched = true // trailer recording: show the flow without starting a real game
  } else if (relaunch && !actions.some((a) => a.kind === 'bisect')) {
    const { launchInstance } = await import('../minecraft/launchService')
    await launchInstance(target, { skipPreflight: d.phase === 'preflight' && result.failed.length > 0 })
    result.relaunched = true
  }
  return result
}

/* ---------------- automatic culprit search ---------------- */

let bisect: BisectState | undefined
let cancelRequested = false

export const bisectState = (): BisectState | null => bisect ?? null

function setBisect(patch: Partial<BisectState>): void {
  bisect = { ...(bisect as BisectState), ...patch }
  emit('bisect', bisect)
}

export function cancelBisect(): void {
  cancelRequested = true
}

/** Launches the game and waits: 'ok' when the main menu loaded, 'crash' when it died first. */
async function trial(instanceId: string): Promise<'ok' | 'crash'> {
  const { launchInstance, stopGame } = await import('../minecraft/launchService')
  return new Promise((resolvePromise, reject) => {
    let settled = false
    const finish = (r: 'ok' | 'crash' | Error): void => {
      if (settled) return
      settled = true
      off()
      clearTimeout(timeout)
      if (r instanceof Error) reject(r)
      else resolvePromise(r)
    }
    let readyTimer: NodeJS.Timeout | undefined
    const off = onAppEvent((event, payload) => {
      if (event === 'gameLog' && /Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks/.test((payload as { line: string }).line) && !readyTimer) {
        // stay a little longer: some crashes happen right after the menu appears
        readyTimer = setTimeout(() => {
          finish('ok')
          stopGame()
        }, 8000)
      }
      if (event === 'game' && !(payload as { running: boolean }).running) {
        // died before the "stayed alive" timer fired (after it, finish() already resolved 'ok')
        if (readyTimer) clearTimeout(readyTimer)
        finish('crash')
      }
    })
    const timeout = setTimeout(() => {
      stopGame()
      finish(new Error('Игра грузится дольше 8 минут — автопоиск остановлен'))
    }, 8 * 60_000)
    launchInstance(instanceId, { skipPreflight: true }).catch((err) => finish(err instanceof Error ? err : new Error(String(err))))
  })
}

async function waitGameStopped(): Promise<void> {
  const { getGameState } = await import('../minecraft/launchService')
  for (let i = 0; i < 40 && getGameState().running; i++) await new Promise((r) => setTimeout(r, 500))
}

/**
 * Binary search over the mods: run with half of the suspects (plus what they depend on);
 * if it still crashes the culprit is in that half, otherwise in the other one.
 */
export async function startBisect(instanceId: string): Promise<void> {
  try {
    await runBisect(instanceId)
  } catch (err) {
    bisect = { instanceId, running: false, step: 0, detail: describeError(err), error: describeError(err) }
    emit('bisect', bisect)
  }
}

async function runBisect(instanceId: string): Promise<void> {
  if (bisecting) throw new Error('Автопоиск уже идёт')
  const instance = getInstance(instanceId)
  const dir = modsDirOf(instanceId)
  const jars = (await scanMods(dir, instance.loader, instance.mcVersion)).filter((j) => j.enabled)
  if (jars.length < 2) throw new Error('В сборке меньше двух модов — искать не из чего')
  bisecting = true
  cancelRequested = false
  const original = jars.map((j) => j.fileName)
  const maxSteps = Math.ceil(Math.log2(jars.length)) + 1
  bisect = { instanceId, running: true, step: 0, detail: 'Проверяю, повторяется ли краш…' }
  emit('bisect', bisect)

  const byId = new Map<string, ScannedJar>()
  for (const j of jars) for (const id of [...j.ids, ...j.provides]) byId.set(id.toLowerCase().replace(/_/g, '-'), j)
  const withDeps = (set: ScannedJar[]): Set<string> => {
    const out = new Set<string>()
    const queue = [...set]
    while (queue.length) {
      const j = queue.pop()!
      if (out.has(j.fileName)) continue
      out.add(j.fileName)
      for (const d of j.dependencies) {
        const dep = byId.get(d.id.toLowerCase().replace(/_/g, '-'))
        if (dep) queue.push(dep)
      }
    }
    return out
  }
  const enableOnly = (keep: Set<string>): void => {
    for (const f of original) setModEnabled(instanceId, f, keep.has(f))
  }
  const check = (): void => {
    if (cancelRequested) throw new Error('Автопоиск отменён')
  }

  try {
    let step = 0
    if ((await trial(instanceId)) === 'ok') throw new Error('Со всеми модами игра запустилась нормально — краш не повторился')
    // Libraries (things others depend on) are rarely the culprit and are pulled in automatically.
    const depended = new Set<string>()
    for (const j of jars) for (const d of j.dependencies) {
      const dep = byId.get(d.id.toLowerCase().replace(/_/g, '-'))
      if (dep && dep !== j) depended.add(dep.fileName)
    }
    let suspects = jars.filter((j) => !depended.has(j.fileName))
    if (suspects.length === 0) suspects = jars
    while (suspects.length > 1) {
      check()
      step++
      const half = suspects.slice(0, Math.ceil(suspects.length / 2))
      setBisect({ step, detail: `Шаг ${step} из ~${maxSteps}: запуск с ${half.length} из ${suspects.length} подозреваемых модов` })
      enableOnly(withDeps(half))
      await waitGameStopped()
      const r = await trial(instanceId)
      suspects = r === 'crash' ? half : suspects.slice(half.length)
    }
    const culprit = suspects[0]
    enableOnly(new Set(original))
    setBisect({ running: false, detail: `Найден виновник: ${culprit.name}`, culprit: culprit.fileName })
    publish({
      id: randomUUID(),
      instanceId,
      phase: 'crash',
      createdAt: Date.now(),
      headline: 'Автопоиск нашёл сломанный мод',
      problems: [{
        title: `Виноват мод «${culprit.name}»`,
        explanation: `Лаунчер запускал игру с разными половинами модов (${step} запусков): без «${culprit.name}» игра работает, с ним — крашится. Обнови его или выключи.`,
        confidence: 'high',
        evidence: culprit.fileName,
        fixes: [{ label: `Обновить «${culprit.name}»`, action: { kind: 'updateMod', fileName: culprit.fileName } }, { label: `Выключить «${culprit.name}»`, action: { kind: 'disableMod', fileName: culprit.fileName } }]
      }]
    })
  } catch (err) {
    setBisect({ running: false, error: describeError(err), detail: describeError(err) })
  } finally {
    // whatever happened, the player gets their mod list back exactly as it was
    try {
      await waitGameStopped()
      enableOnly(new Set(original))
    } catch {
      /* best effort */
    }
    bisecting = false
  }
}

/** Mod list with static-check issues for the dev page. */
export async function inspectMods(instanceId: string): Promise<ModJarInfo[]> {
  const instance = getInstance(instanceId)
  const jars = await scanMods(modsDirOf(instanceId), instance.loader, instance.mcVersion)
  return jars.map(({ provides: _p, packages: _k, corrupt: _c, ...info }) => info)
}
