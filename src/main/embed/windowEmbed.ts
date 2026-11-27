import { app, BrowserWindow } from 'electron'
import koffi from 'koffi'
import { basename } from 'node:path'
import type { EmbedRect, EmbedState, EmbeddableWindow } from '../../shared/types'
import { emit } from '../core/events'

/**
 * «Рамка для программ»: a window of another program (Photoshop, Blockbench, IntelliJ IDEA, a sound editor…)
 * dragged onto a frame in BigBuncher becomes a child window of BigBuncher and lives inside that frame.
 * Win32 via koffi: SetParent + child style; the original style/position are restored on detach and
 * before BigBuncher closes (a destroyed parent would take the program's window with it).
 */

const isWin = process.platform === 'win32'

const GWL_STYLE = -16
const WS_CHILD = 0x40000000
const WS_POPUP = 0x80000000
const WS_VISIBLE = 0x10000000
const WS_FRAME = 0x00c00000 /* CAPTION */ | 0x00040000 /* THICKFRAME */ | 0x00080000 /* SYSMENU */ | 0x00020000 | 0x00010000
const SWP_NOZORDER = 0x4
const SWP_NOACTIVATE = 0x10
const SWP_FRAMECHANGED = 0x20
const SWP_SHOWWINDOW = 0x40
const SW_HIDE = 0
const SW_SHOW = 5
const SW_RESTORE = 9
const GA_ROOT = 2
const VK_LBUTTON = 1
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

interface Win32 {
  SetParent(child: number, parent: number): number
  GetWindowLongPtrW(h: number, index: number): number
  SetWindowLongPtrW(h: number, index: number, value: number): number
  SetWindowPos(h: number, after: number, x: number, y: number, w: number, hgt: number, flags: number): boolean
  ShowWindow(h: number, cmd: number): boolean
  IsWindow(h: number): boolean
  IsWindowVisible(h: number): boolean
  IsIconic(h: number): boolean
  GetWindowTextW(h: number, buf: Buffer, max: number): number
  GetWindowThreadProcessId(h: number, pid: number[]): number
  GetForegroundWindow(): number
  SetForegroundWindow(h: number): boolean
  GetCursorPos(p: { x?: number; y?: number }): boolean
  GetAsyncKeyState(vk: number): number
  GetAncestor(h: number, flags: number): number
  GetWindowRect(h: number, r: { left?: number; top?: number; right?: number; bottom?: number }): boolean
  ClientToScreen(h: number, p: { x: number; y: number }): boolean
  EnumWindows(cb: unknown, param: number): boolean
  OpenProcess(access: number, inherit: boolean, pid: number): number
  CloseHandle(h: number): boolean
  QueryFullProcessImageNameW(h: number, flags: number, buf: Buffer, size: number[]): boolean
  enumProto: unknown
}

let w32: Win32 | undefined
function api(): Win32 {
  if (w32) return w32
  if (!isWin) throw new Error('Рамка для программ работает только в Windows')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  koffi.struct('BB_POINT', { x: 'long', y: 'long' })
  koffi.struct('BB_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
  const enumProto = koffi.proto('bool __stdcall BB_EnumProc(intptr_t hwnd, intptr_t param)')
  w32 = {
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t, intptr_t)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t, int)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t, int, intptr_t)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t, intptr_t, int, int, int, int, uint32_t)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t, int)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t)'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t, _Out_ uint16_t *buf, int)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t, _Out_ uint32_t *pid)'),
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr_t)'),
    GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ BB_POINT *p)'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t, uint32_t)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t, _Out_ BB_RECT *r)'),
    ClientToScreen: user32.func('bool __stdcall ClientToScreen(intptr_t, _Inout_ BB_POINT *p)'),
    EnumWindows: user32.func('bool __stdcall EnumWindows(BB_EnumProc *cb, intptr_t param)'),
    OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t, bool, uint32_t)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr_t)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t, uint32_t, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
    enumProto
  } as unknown as Win32
  return w32
}

/* ---------- helpers ---------- */

const hostHwnd = (win: BrowserWindow): number => Number(win.getNativeWindowHandle().readBigUInt64LE(0))
const mainWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())

function titleOf(h: number): string {
  const buf = Buffer.alloc(1024)
  const n = api().GetWindowTextW(h, buf, 512)
  return buf.toString('utf16le', 0, n * 2)
}

function pidOf(h: number): number {
  const pid = [0]
  api().GetWindowThreadProcessId(h, pid)
  return pid[0]
}

function exeOf(pid: number): string {
  const p = api().OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (!p) return ''
  try {
    const buf = Buffer.alloc(2048)
    const size = [1024]
    return api().QueryFullProcessImageNameW(p, 0, buf, size) ? basename(buf.toString('utf16le', 0, size[0] * 2)) : ''
  } finally {
    api().CloseHandle(p)
  }
}

/** Windows that belong to BigBuncher itself (or the shell) can never be embedded. */
const SKIP_EXE = new Set(['explorer.exe', 'textinputhost.exe', 'shellexperiencehost.exe', 'searchhost.exe', 'startmenuexperiencehost.exe', 'applicationframehost.exe', 'systemsettings.exe'])
function embeddable(h: number): boolean {
  if (!h || !api().IsWindow(h) || !api().IsWindowVisible(h)) return false
  if (api().GetAncestor(h, GA_ROOT) !== h) return false
  const pid = pidOf(h)
  if (pid === process.pid || BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getOSProcessId() === pid)) return false
  if (BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && hostHwnd(w) === h)) return false
  if (!titleOf(h).trim()) return false
  return !SKIP_EXE.has(exeOf(pid).toLowerCase())
}

/* ---------- state ---------- */

interface Slot {
  hwnd: number
  title: string
  exe: string
  style: number
  rect: { left: number; top: number; right: number; bottom: number }
  /** Frame position in physical pixels inside the BigBuncher window; undefined = frame not on screen. */
  frame?: EmbedRect
}
const slots = new Map<string, Slot>()
/** Frames on screen (also the empty ones — they are drop targets). */
const frames = new Map<string, EmbedRect>()

function stateOf(slot: string): EmbedState {
  const s = slots.get(slot)
  return { slot, attached: Boolean(s), title: s?.title, exe: s?.exe }
}
const publish = (slot: string): void => emit('embed', stateOf(slot))

export function listEmbeddable(): EmbeddableWindow[] {
  const out: EmbeddableWindow[] = []
  const cb = koffi.register((h: number) => {
    if (embeddable(h)) out.push({ hwnd: String(h), title: titleOf(h), exe: exeOf(pidOf(h)) })
    return true
  }, koffi.pointer(api().enumProto as koffi.IKoffiCType))
  try {
    api().EnumWindows(cb, 0)
  } finally {
    koffi.unregister(cb)
  }
  const taken = new Set([...slots.values()].map((s) => String(s.hwnd)))
  return out.filter((w) => !taken.has(w.hwnd)).sort((a, b) => a.exe.localeCompare(b.exe) || a.title.localeCompare(b.title))
}

function place(s: Slot): void {
  const w = api()
  if (!w.IsWindow(s.hwnd)) return
  if (!s.frame) {
    w.ShowWindow(s.hwnd, SW_HIDE)
    return
  }
  const { x, y, width, height } = s.frame
  w.SetWindowPos(s.hwnd, 0, Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), SWP_NOACTIVATE | SWP_SHOWWINDOW)
}

export function attachWindow(slot: string, hwndText: string): EmbedState {
  const win = mainWindow()
  if (!win) throw new Error('Нет окна BigBuncher')
  const h = Number(hwndText)
  if (!embeddable(h)) throw new Error('Это окно нельзя вставить (закрылось или системное)')
  if (slots.has(slot)) detachWindow(slot)
  const w = api()
  if (w.IsIconic(h)) w.ShowWindow(h, SW_RESTORE)
  const rect = {} as Slot['rect']
  w.GetWindowRect(h, rect)
  const style = w.GetWindowLongPtrW(h, GWL_STYLE)
  const s: Slot = { hwnd: h, title: titleOf(h), exe: exeOf(pidOf(h)), style, rect, frame: frames.get(slot) }
  // restore first: a maximized window keeps its maximized size as a child
  w.ShowWindow(h, SW_RESTORE)
  w.SetWindowLongPtrW(h, GWL_STYLE, ((style & ~WS_POPUP & ~WS_FRAME) | WS_CHILD | WS_VISIBLE) >>> 0)
  w.SetParent(h, hostHwnd(win))
  w.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE | 0x1 /* NOSIZE */ | 0x2 /* NOMOVE */)
  slots.set(slot, s)
  place(s)
  startPolling()
  publish(slot)
  return stateOf(slot)
}

export function detachWindow(slot: string): EmbedState {
  const s = slots.get(slot)
  slots.delete(slot)
  if (s && api().IsWindow(s.hwnd)) {
    const w = api()
    w.SetParent(s.hwnd, 0)
    w.SetWindowLongPtrW(s.hwnd, GWL_STYLE, s.style)
    const { left, top, right, bottom } = s.rect
    w.SetWindowPos(s.hwnd, 0, left, top, Math.max(200, right - left), Math.max(150, bottom - top), SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW)
    w.ShowWindow(s.hwnd, SW_SHOW)
    w.SetForegroundWindow(s.hwnd)
  }
  publish(slot)
  return stateOf(slot)
}

export function detachAll(): void {
  if (!isWin || !w32) return
  for (const slot of [...slots.keys()]) {
    try {
      detachWindow(slot)
    } catch {
      /* the window is gone */
    }
  }
}

/** The frame moved/resized (physical px inside the window) or left the screen (null). */
export function setFrame(slot: string, rect: EmbedRect | null): void {
  if (rect) frames.set(slot, rect)
  else frames.delete(slot)
  const s = slots.get(slot)
  if (s) {
    s.frame = rect ?? undefined
    place(s)
  }
  if (rect) startPolling()
}

export function embedState(slot: string): EmbedState {
  return stateOf(slot)
}

/* ---------- drag a window onto a frame ---------- */

let timer: NodeJS.Timeout | undefined
let drag: { hwnd: number; left: number; top: number } | undefined

function frameUnderCursor(win: BrowserWindow): string | undefined {
  const w = api()
  const cur = {} as { x: number; y: number }
  w.GetCursorPos(cur)
  const origin = { x: 0, y: 0 }
  w.ClientToScreen(hostHwnd(win), origin)
  for (const [slot, f] of frames) {
    if (slots.has(slot)) continue
    const x = cur.x - origin.x
    const y = cur.y - origin.y
    if (x >= f.x && y >= f.y && x <= f.x + f.width && y <= f.y + f.height) return slot
  }
  return undefined
}

function tick(): void {
  const w = api()
  // a program closed its embedded window → free the frame
  for (const [slot, s] of slots) {
    if (!w.IsWindow(s.hwnd)) {
      slots.delete(slot)
      publish(slot)
    }
  }
  const win = mainWindow()
  const empty = [...frames.keys()].some((slot) => !slots.has(slot))
  if (!win || (!empty && slots.size === 0)) return stopPolling()
  if (!empty) return

  const down = (w.GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0
  if (down) {
    if (!drag) {
      const fg = w.GetForegroundWindow()
      if (fg && fg !== hostHwnd(win)) {
        const r = {} as Slot['rect']
        w.GetWindowRect(fg, r)
        drag = { hwnd: fg, left: r.left, top: r.top }
      }
    }
    return
  }
  if (!drag) return
  const d = drag
  drag = undefined
  // released: was a window moved (its title bar dragged) and dropped over an empty frame?
  const r = {} as Slot['rect']
  if (!w.IsWindow(d.hwnd) || !w.GetWindowRect(d.hwnd, r) || (r.left === d.left && r.top === d.top)) return
  const slot = frameUnderCursor(win)
  if (!slot || !embeddable(d.hwnd)) return
  try {
    attachWindow(slot, String(d.hwnd))
    win.focus()
  } catch (err) {
    console.warn('[embed] drop failed', err)
  }
}

function startPolling(): void {
  if (!isWin || timer) return
  timer = setInterval(() => {
    try {
      tick()
    } catch (err) {
      console.warn('[embed]', err)
      stopPolling()
    }
  }, 80)
}

function stopPolling(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  drag = undefined
}

/** Gives every embedded program its own window back before BigBuncher's window goes away. */
export function guardEmbeds(win: BrowserWindow): void {
  win.on('close', detachAll)
  win.webContents.on('render-process-gone', detachAll)
  win.webContents.on('did-start-navigation', (e) => e.isMainFrame && !e.isSameDocument && detachAll())
}
app.on('before-quit', detachAll)
