import { app, BrowserWindow, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSmokeTestPaths, runDoctorTest, runFeatureTest, runMultiTest, runShareTest, runSmokeTest } from './devtools/smokeTest'
import { startDevWatchers } from './dev/devService'
import { syncDownloadWatcher } from './downloads/downloadWatcher'
import { runLauncherTest } from './devtools/launcherTest'
import { runSkinTest } from './devtools/skinTest'
import { prepareTrailerPaths, runTrailer } from './devtools/trailer'
import { registerIpcHandlers } from './ipc'
import { guardLauncherFrames, registerLauncherScheme, serveLauncherFiles } from './launchers/launcherProtocol'
import { scheduleUpdateChecks } from './updates/updateService'

// More launchers: files of installed launchers are served as bblauncher://<id>/… in every mode.
registerLauncherScheme()
void app.whenReady().then(serveLauncherFiles)

// BIGBUNCHER_USERDATA=<dir> — screenshots (BIGBUNCHER_CAPTURE) on a separate settings folder, not the user's.
if (process.env.BIGBUNCHER_USERDATA) app.setPath('userData', process.env.BIGBUNCHER_USERDATA)

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#0d1117',
    title: 'BigBuncher',
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  // The portable exe runs a copy unpacked into %TEMP% that is deleted on exit. Without this the taskbar
  // takes its icon and "pin" target from that temporary copy, so a pinned button ends up blank.
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (process.platform === 'win32' && portable) {
    win.setAppDetails({
      appId: 'studio.tambi.bigbuncher',
      appIconPath: portable,
      appIconIndex: 0,
      relaunchCommand: `"${portable}"`,
      relaunchDisplayName: 'BigBuncher'
    })
  }

  guardLauncherFrames(win.webContents)
  win.once('ready-to-show', () => win.show())
  // External links open in the system browser, never inside the launcher.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Optional start page via hash, e.g. BIGBUNCHER_PAGE=skins; BIGBUNCHER_CAPTURE=<png> saves a screenshot and quits.
  const hash = process.env.BIGBUNCHER_PAGE ?? ''
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })

  const capture = process.env.BIGBUNCHER_CAPTURE
  if (capture) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // BIGBUNCHER_CAPTURE_CLICKS="x,y;x,y" — simulated left clicks before the screenshot (UI checks).
        for (const point of (process.env.BIGBUNCHER_CAPTURE_CLICKS ?? '').split(';').filter(Boolean)) {
          const [x, y] = point.split(',').map(Number)
          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
          await new Promise((r) => setTimeout(r, 400))
        }
        await new Promise((r) => setTimeout(r, Number(process.env.BIGBUNCHER_CAPTURE_AFTER ?? 0)))
        writeFileSync(capture, (await win.webContents.capturePage()).toPNG())
        app.quit()
      }, Number(process.env.BIGBUNCHER_CAPTURE_DELAY ?? 4000))
    })
  }
  return win
}

if (process.env.BIGBUNCHER_SMOKE) {
  prepareSmokeTestPaths()
  app.whenReady().then(() =>
    (process.env.BIGBUNCHER_SMOKE === 'skins' ? runSkinTest() : process.env.BIGBUNCHER_SMOKE === 'launchers' ? runLauncherTest() : process.env.BIGBUNCHER_SMOKE === 'features' ? runFeatureTest() : process.env.BIGBUNCHER_SMOKE === 'doctor' ? runDoctorTest() : process.env.BIGBUNCHER_SMOKE === 'multi' ? runMultiTest() : process.env.BIGBUNCHER_SMOKE === 'share' ? runShareTest() : runSmokeTest()).then(
      () => app.exit(0),
      (err) => {
        console.error('[smoke] FAILED', err)
        app.exit(1)
      }
    )
  )
} else if (process.env.BIGBUNCHER_TRAILER) {
  prepareTrailerPaths()
  app.whenReady().then(async () => {
    registerIpcHandlers()
    const win = createMainWindow()
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    console.log('[trailer] page loaded')
    await runTrailer(win, process.env.BIGBUNCHER_TRAILER!).catch((err) => console.error('[trailer] FAILED', err))
    app.exit(0)
  })
} else if (!process.env.BIGBUNCHER_CAPTURE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('studio.tambi.bigbuncher')
    registerIpcHandlers()
    scheduleUpdateChecks()
    startDevWatchers()
    syncDownloadWatcher()
    createMainWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
