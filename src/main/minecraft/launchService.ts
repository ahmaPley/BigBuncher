import { createMinecraftProcessWatcher, launch, type LaunchOption } from '@xmcl/core'
import { BrowserWindow } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import type { GameState } from '../../shared/types'
import { findAccount, getLaunchCredentials } from '../auth/accountService'
import { emit } from '../core/events'
import { gameDir, instanceDir } from '../core/paths'
import { runTask } from '../core/tasks'
import { getInstance, installInstance, isInstanceBusy, patchInstance } from '../instances/instanceService'
import { getSettings } from '../settings/settingsService'
import { syncSharedPacksIntoInstance } from '../resourcepacks/resourcePackService'
import { prepareSkinInjection } from '../skins/skinService'
import { devLaunchArgs } from '../dev/devService'
import { preflight, sessionEnded, sessionLine, sessionStarted } from '../diagnostics/crashDoctor'
import { graphicsArgs } from './graphicsService'
import { ensureJava, javaRequirementOf } from './javaService'

/** Running games by instance id — several instances can run at the same time (one process per instance). */
const running = new Map<string, { process: ChildProcess; startedAt: number }>()

export function getGameState(): GameState {
  const sessions = [...running.entries()]
    .map(([instanceId, r]) => ({ instanceId, pid: r.process.pid, startedAt: r.startedAt }))
    .sort((a, b) => a.startedAt - b.startedAt)
  const last = sessions[sessions.length - 1]
  return { running: sessions.length > 0, instanceId: last?.instanceId, pid: last?.pid, sessions }
}

export const isInstanceRunning = (instanceId: string): boolean => running.has(instanceId)

export interface LaunchOptions {
  /** Skip the mod check before launch (the player chose "launch anyway", or the culprit search runs). */
  skipPreflight?: boolean
}

/** Launches the instance. Resolves 'blocked' when the pre-launch check found problems (a diagnosis was emitted). */
export async function launchInstance(instanceId: string, opts: LaunchOptions = {}): Promise<'started' | 'blocked'> {
  // The same instance twice would fight over its worlds (session.lock) and options; other instances are fine.
  if (running.has(instanceId)) throw new Error('Эта сборка уже запущена')
  if (isInstanceBusy(instanceId)) throw new Error('Сборка ещё устанавливается')

  const settings = getSettings()
  const account = settings.selectedAccountId ? findAccount(settings.selectedAccountId) : undefined
  if (!account) throw new Error('Добавьте аккаунт: офлайн-ник или вход через Microsoft')

  if (settings.preflightCheck && !opts.skipPreflight && (await preflight(instanceId))) return 'blocked'

  if (!getInstance(instanceId).installed) await installInstance(instanceId)
  const instance = getInstance(instanceId)
  const dev = devLaunchArgs(instanceId)

  const options = await runTask(`Запуск «${instance.name}»`, async (report): Promise<LaunchOption> => {
    report.update(-1, 'Проверка Java')
    const javaPath = await ensureJava(await javaRequirementOf(instance.versionId), report)
    report.update(-1, 'Авторизация')
    const creds = await getLaunchCredentials(account.uuid)
    report.update(-1, 'Подготовка скина')
    const skin = await prepareSkinInjection(account)
    report.update(-1, 'Общие текстурпаки')
    syncSharedPacksIntoInstance(instance.id)
    report.update(-1, 'Графика')
    const graphics = await graphicsArgs(instance.mcVersion)

    const gamePath = instanceDir(instance.id)
    mkdirSync(gamePath, { recursive: true })
    return {
      gamePath,
      resourcePath: gameDir(),
      javaPath,
      version: instance.versionId,
      gameProfile: { name: creds.name, id: creds.uuid },
      accessToken: creds.accessToken,
      userType: creds.type === 'microsoft' ? ('msa' as LaunchOption['userType']) : 'legacy',
      launcherName: 'BigBuncher',
      launcherBrand: 'BigBuncher',
      versionName: instance.name,
      minMemory: settings.minRamMb,
      maxMemory: settings.maxRamMb,
      resolution: settings.resolution.fullscreen
        ? { fullscreen: true }
        : { width: settings.resolution.width, height: settings.resolution.height },
      extraJVMArgs: [...settings.jvmArgs.split(/\s+/).filter(Boolean), ...dev.jvm],
      extraMCArgs: [...graphics, ...dev.game],
      yggdrasilAgent: skin,
      extraExecOption: { detached: false, windowsHide: true }
    }
  }, instanceId)

  const child = await launch(options)
  running.set(instanceId, { process: child, startedAt: Date.now() })
  patchInstance(instanceId, { lastPlayedAt: Date.now() })
  sessionStarted(instanceId)
  emit('game', getGameState())

  const forward = (stream: 'out' | 'err') => (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      sessionLine(instanceId, line)
      emit('gameLog', { instanceId, line, stream })
    }
  }
  child.stdout?.on('data', forward('out'))
  child.stderr?.on('data', forward('err'))

  const watcher = createMinecraftProcessWatcher(child)
  watcher.on('minecraft-window-ready', () => {
    if (getSettings().afterLaunch === 'minimize') BrowserWindow.getAllWindows().forEach((w) => w.minimize())
  })
  watcher.on('minecraft-exit', ({ code, crashReport }) => {
    if (running.get(instanceId)?.process === child) running.delete(instanceId)
    emit('game', getGameState())
    if (code !== 0) {
      emit('gameLog', { instanceId, line: `Игра завершилась с кодом ${code}`, stream: 'err' })
      if (crashReport) emit('gameLog', { instanceId, line: crashReport.slice(0, 4000), stream: 'err' })
      BrowserWindow.getAllWindows().forEach((w) => w.restore())
    }
    // Доктор крашей: explains what went wrong (also for loader errors that exit with code 0)
    void sessionEnded(instanceId, code, crashReport)
  })
  watcher.on('error', (err) => emit('gameLog', { instanceId, line: String(err), stream: 'err' }))
  return 'started'
}

/** Stops one game, or every running game when no instance is given. */
export function stopGame(instanceId?: string): void {
  if (instanceId) running.get(instanceId)?.process.kill()
  else for (const r of running.values()) r.process.kill()
}
