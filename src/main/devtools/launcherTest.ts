import { net } from 'electron'
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yazl from 'yazl'

/**
 * BIGBUNCHER_SMOKE=launchers BIGBUNCHER_LAUNCHER_ZIP=<zip> — More launchers without dialogs:
 * install, list, bblauncher:// files, bridge (context/data/backend/icon), activate, zip-slip refusal, remove.
 * Runs on a temporary settings folder (prepareSmokeTestPaths).
 */
export async function runLauncherTest(): Promise<void> {
  const svc = await import('../launchers/launcherService')
  const { bridgeCall } = await import('../launchers/launcherBridge')
  const { getSettings } = await import('../settings/settingsService')
  const log = (...a: unknown[]): void => console.log('[launchers]', ...a)
  const check = (ok: unknown, what: string): void => {
    if (!ok) throw new Error(`FAIL: ${what}`)
    log('ok:', what)
  }

  const zip = process.env.BIGBUNCHER_LAUNCHER_ZIP
  if (!zip || !existsSync(zip)) throw new Error('BIGBUNCHER_LAUNCHER_ZIP не задан')

  const info = await svc.installLauncherFromFile(zip, false)
  check(info, 'установлен из zip')
  const id = info!.id
  log(id, info!.version, `${info!.icons.length} иконок`)
  check(svc.listLaunchers().some((l) => l.id === id), 'есть в списке')

  const manifest = await net.fetch(`bblauncher://${id}/launcher.json`)
  check(manifest.ok && (await manifest.json()).id === id, 'bblauncher:// отдаёт файлы')
  const escape = await net.fetch(`bblauncher://${id}/..%2F..%2Fsettings.json`)
  check(escape.status === 403 || escape.status === 404, `выход за папку запрещён (${escape.status})`)
  const ctx = (await bridgeCall(id, 'context', [])) as { icon: string }
  check(ctx.icon === info!.icons[0].key, `иконка по умолчанию ${ctx.icon}`)
  await bridgeCall(id, 'setData', [{ test: 1 }])
  check(((await bridgeCall(id, 'getData', [])) as { test?: number }).test === 1, 'данные лаунчера сохраняются')
  const found = (await bridgeCall(id, 'backend', [['find']])) as { game?: string | null }
  log('backend find →', found.game)
  check(found && 'game' in found, 'программа лаунчера отвечает JSON')
  if (found.game && id === 'slime-rancher') {
    // Картинок в zip нет — лаунчер достаёт их из игры игрока.
    const art = (await bridgeCall(id, 'backend', [['art', found.game]])) as { ready: boolean; failed: string[] }
    check(art.ready, `картинки достаны из игры ${art.failed.join('; ')}`)
    await bridgeCall(id, 'refreshIcons', [])
    const icon = svc.listLaunchers().find((l) => l.id === id)!.icons[0].url
    check(icon.includes('?v='), 'у иконок новый адрес после refreshIcons')
    const res = await net.fetch(icon)
    check(res.ok && res.headers.get('access-control-allow-origin') === '*', 'иконка отдаётся, CORS есть')
  }
  let backendError = ''
  await bridgeCall(id, 'backend', [['status', 'C:\\нет-такой-папки']]).catch((e: Error) => (backendError = e.message))
  check(backendError.includes('SlimeRancher.exe') || backendError.length > 0, `ошибка программы доходит текстом: ${backendError}`)
  let openError = ''
  await bridgeCall(id, 'openPath', [process.execPath]).catch((e: Error) => (openError = e.message))
  check(openError, 'openPath не запускает .exe')

  const key = info!.icons[3]?.key ?? info!.icons[0].key
  await bridgeCall(id, 'setIcon', [key])
  check(getSettings().launcherIcons[id] === key, `иконка сменена на ${key}`)
  svc.setLauncherIcon('minecraft', 'chest')
  check(getSettings().launcherIcons.minecraft === 'chest', 'иконка Minecraft сменена')

  svc.activateLauncher(id)
  check(getSettings().activeLauncher === id, 'лаунчер открыт')

  // Злой архив: путь ../ должен отклоняться, ничего не распаковав наружу.
  const evil = join(tmpdir(), `bb-evil-${Date.now()}.zip`)
  await new Promise<void>((ok) => {
    const z = new yazl.ZipFile()
    z.addBuffer(Buffer.from('{"id":"evil-x","name":"x","entry":"a","icons":[]}'), 'launcher.json')
    // yazl itself refuses "../" — write a same-length name and patch the bytes afterwards.
    z.addBuffer(Buffer.from('pwned'), 'xx/xx/bb-pwned.txt')
    z.outputStream.pipe(createWriteStream(evil)).on('close', () => ok())
    z.end()
  })
  const raw = readFileSync(evil)
  for (let i = raw.indexOf('xx/xx/'); i >= 0; i = raw.indexOf('xx/xx/', i + 6)) raw.write('../../', i)
  writeFileSync(evil, raw)
  let evilError = ''
  await svc.installLauncherFromFile(evil, false).catch((e: Error) => (evilError = e.message))
  check(evilError && !existsSync(join(tmpdir(), 'bb-pwned.txt')), `zip-slip отклонён: ${evilError}`)

  // Моды из браузера: файл в «Загрузках» с Zone.Identifier → событие с сайтом.
  {
    const { app } = await import('electron')
    const { unlinkSync } = await import('node:fs')
    const { onAppEvent } = await import('../core/events')
    const { syncDownloadWatcher } = await import('../downloads/downloadWatcher')
    syncDownloadWatcher()
    const file = join(app.getPath('downloads'), `bb-test-mod-${Date.now()}.jar`)
    const got = new Promise<{ site?: string }>((ok, fail) => {
      const off = onAppEvent((event, payload) => {
        if (event === 'downloadedMod' && (payload as { path: string }).path === file) {
          off()
          ok(payload as { site?: string })
        }
      })
      setTimeout(() => fail(new Error('FAIL: загрузка не замечена')), 15000)
    })
    writeFileSync(file, Buffer.alloc(2048, 1))
    writeFileSync(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://modrinth.com/mod/sodium\r\nHostUrl=https://cdn.modrinth.com/data/x/sodium.jar\r\n')
    const ev = await got
    unlinkSync(file)
    check(ev.site === 'Modrinth', `скачанный мод замечен, сайт: ${ev.site}`)
  }

  const after = await svc.removeLauncher(id)
  check(!after.some((l) => l.id === id) && getSettings().activeLauncher === 'minecraft', 'удалён, открыт Minecraft')
  writeFileSync(join(tmpdir(), 'bb-launchers-test.ok'), new Date().toISOString())
  log('ВСЁ ОК')
}
