import { app, BrowserWindow, dialog, shell } from 'electron'
import { totalmem } from 'node:os'

const focused = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

export const windowControls = {
  async minimize() {
    focused()?.minimize()
  },
  async toggleMaximize() {
    const win = focused()
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize()
  },
  async close() {
    focused()?.close()
  }
}

export const system = {
  async openPath(path: string) {
    await shell.openPath(path)
  },
  async openExternal(url: string) {
    if (!/^https?:\/\//.test(url)) throw new Error('Разрешены только http(s) ссылки')
    await shell.openExternal(url)
  },
  async pickDirectory(title: string) {
    const res = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  },
  async pickFile(title: string, extensions: string[]) {
    const res = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: title, extensions }] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  },
  async totalMemoryMb() {
    return Math.floor(totalmem() / 1024 / 1024)
  },
  async appVersion() {
    return app.getVersion()
  }
}
