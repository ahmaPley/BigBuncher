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
import { ensureJava, javaRequirementOf } from './javaService'

let current: { process: ChildProcess; instanceId: string } | undefined

export function getGameState(): GameState {
  return current
    ? { running: true, instanceId: current.instanceId, pid: current.process.pid }
    : { running: false }
}

export async function launchInstance(instanceId: string): Promise<void> {
  if (current) throw new Error('Игра уже запущена')
  if (isInstanceBusy(instanceId)) throw new Error('Сборка ещё устанавливается')

  const settings = getSettings()
  const account = settings.selectedAccountId ? findAccount(settings.selectedAccountId) : undefined
  if (!account) throw new Error('Добавьте аккаунт: офлайн-ник или вход через Microsoft')

  if (!getInstance(instanceId).installed) await installInstance(instanceId)
  const instance = getInstance(instanceId)

  const options = await runTask(`Запуск «${instance.name}»`, async (report): Promise<LaunchOption> => {
    report.update(-1, 'Проверка Java')
    const javaPath = await ensureJava(await javaRequirementOf(instance.versionId), report)
    report.update(-1, 'Авторизация')
    const creds = await getLaunchCredentials(account.uuid)
    report.update(-1, 'Подготовка скина')
    const skin = await prepareSkinInjection(account)
    report.update(-1, 'Общие текстурпаки')
    syncSharedPacksIntoInstance(instance.id)

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
      extraJVMArgs: settings.jvmArgs.split(/\s+/).filter(Boolean),
      yggdrasilAgent: skin,
      extraExecOption: { detached: false, windowsHide: true }
    }
  }, instanceId)

  const child = await launch(options)
  current = { process: child, instanceId }
  patchInstance(instanceId, { lastPlayedAt: Date.now() })
  emit('game', getGameState())

  const forward = (stream: 'out' | 'err') => (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) emit('gameLog', { instanceId, line, stream })
    }
  }
  child.stdout?.on('data', forward('out'))
  child.stderr?.on('data', forward('err'))

  const watcher = createMinecraftProcessWatcher(child)
  watcher.on('minecraft-window-ready', () => {
    if (getSettings().afterLaunch === 'minimize') BrowserWindow.getAllWindows().forEach((w) => w.minimize())
  })
  watcher.on('minecraft-exit', ({ code, crashReport }) => {
    current = undefined
    emit('game', getGameState())
    if (code !== 0) {
      emit('gameLog', { instanceId, line: `Игра завершилась с кодом ${code}`, stream: 'err' })
      if (crashReport) emit('gameLog', { instanceId, line: crashReport.slice(0, 4000), stream: 'err' })
      BrowserWindow.getAllWindows().forEach((w) => w.restore())
    }
  })
  watcher.on('error', (err) => emit('gameLog', { instanceId, line: String(err), stream: 'err' }))
}

export function stopGame(): void {
  current?.process.kill()
}
