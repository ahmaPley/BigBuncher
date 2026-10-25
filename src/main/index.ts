import { app, BrowserWindow, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSmokeTestPaths, runDoctorTest, runFeatureTest, runSmokeTest } from './devtools/smokeTest'
import { startDevWatchers } from './dev/devService'
import { prepareTrailerPaths, runTrailer } from './devtools/trailer'
import { registerIpcHandlers } from './ipc'
import { scheduleUpdateChecks } from './updates/updateService'

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
    (process.env.BIGBUNCHER_SMOKE === 'features' ? runFeatureTest() : process.env.BIGBUNCHER_SMOKE === 'doctor' ? runDoctorTest() : runSmokeTest()).then(
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
    createMainWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
