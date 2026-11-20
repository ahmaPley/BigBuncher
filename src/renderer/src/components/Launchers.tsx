import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MINECRAFT_LAUNCHER_ID, type LauncherInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { iconOf, isPixelIcon } from '../lib/launchers'
import { Icon } from './Icon'
import { Button, Modal, usePortalPosition } from './ui'

export function LauncherIcon({ launcher, size = 22 }: { launcher: LauncherInfo; size?: number }) {
  const { settings } = useApp()
  const url = iconOf(launcher, settings)
  // A launcher may build its icons on first run; until then show no icon at all (just its name).
  const [failed, setFailed] = useState<string>()
  if (failed === url) return null
  return (
    <img
      className={`launcher-icon ${isPixelIcon(url) ? 'pixel' : ''}`}
      src={url}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailed(url)}
    />
  )
}

/** Title bar button: current launcher + list to switch, and «More launchers…». */
export function LauncherSwitcher() {
  const { launchers, activeLauncher, run, setLaunchersOpen } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pos = usePortalPosition(ref, open)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="launcher-switcher" ref={ref}>
      <button className="launcher-switcher-trigger" title="Сменить лаунчер" onClick={() => setOpen(!open)}>
        <LauncherIcon launcher={activeLauncher} size={20} />
        <span>{activeLauncher.name}</span>
        <Icon name="chevronDown" size={15} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className="launcher-switcher-menu portal titlebar-menu" style={{ ...pos, width: undefined }}>
          {launchers.map((l) => (
            <button
              key={l.id}
              className={l.id === activeLauncher.id ? 'active' : ''}
              onClick={() => {
                setOpen(false)
                if (l.id !== activeLauncher.id) void run(() => api.launchers.activate(l.id))
              }}
            >
              <LauncherIcon launcher={l} size={26} />
              <span className="name">{l.name}</span>
              {l.id === activeLauncher.id && <Icon name="check" size={16} />}
            </button>
          ))}
          <div className="sep" />
          <button
            onClick={() => {
              setOpen(false)
              setLaunchersOpen(true)
            }}
          >
            <span className="more-icon">
              <Icon name="grid" size={16} />
            </span>
            <span className="name">More launchers…</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

/** «More launchers»: installed launchers, install from zip, remove. */
export function LaunchersModal() {
  const { launchers, activeLauncher, run, toast, setLaunchersOpen } = useApp()
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string>()
  const close = (): void => setLaunchersOpen(false)

  const install = async (): Promise<void> => {
    setBusy(true)
    const info = await run(() => api.launchers.installZip())
    setBusy(false)
    if (info) {
      toast('success', `Лаунчер «${info.name}» установлен`)
      await run(() => api.launchers.activate(info.id))
      close()
    }
  }

  return (
    <Modal title="More launchers" onClose={close} width={620}>
      <p className="muted" style={{ marginTop: 0 }}>
        Лаунчеры других игр. Установи zip — и переключайся между ними в заголовке окна или в настройках.
      </p>
      <div className="launcher-list">
        {launchers.map((l) => (
          <div key={l.id} className={`launcher-card ${l.id === activeLauncher.id ? 'active' : ''}`} style={{ ['--accent' as string]: l.accent }}>
            <LauncherIcon launcher={l} size={48} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="title">
                {l.name} {l.version && <span className="dim">v{l.version}</span>}
              </div>
              <div className="muted ellipsis" style={{ fontSize: 13 }}>
                {l.description || l.author}
              </div>
            </div>
            {l.id === activeLauncher.id ? (
              <span className="launcher-badge">Открыт</span>
            ) : (
              <Button size="sm" variant="primary" icon="play" onClick={() => void run(() => api.launchers.activate(l.id)).then(close)}>
                Открыть
              </Button>
            )}
            {l.id !== MINECRAFT_LAUNCHER_ID && (
              <Button
                size="sm"
                variant={confirmRemove === l.id ? 'danger' : 'ghost'}
                icon="trash"
                iconOnly={confirmRemove !== l.id}
                title="Удалить лаунчер"
                onClick={() => {
                  if (confirmRemove !== l.id) return setConfirmRemove(l.id)
                  setConfirmRemove(undefined)
                  void run(() => api.launchers.remove(l.id), `Лаунчер «${l.name}» удалён в Корзину`)
                }}
              >
                Точно удалить?
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          Ставь лаунчеры только от тех, кому доверяешь.
        </span>
        <span className="spacer" />
        <Button variant="primary" icon="upload" loading={busy} onClick={() => void install()}>
          Установить из ZIP…
        </Button>
      </div>
    </Modal>
  )
}

/** Keeps the window/taskbar icon in sync with the active launcher's chosen icon. */
export function useWindowIcon(): void {
  const { activeLauncher, settings } = useApp()
  const url = settings ? iconOf(activeLauncher, settings) : undefined
  useEffect(() => {
    if (!url) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = !isPixelIcon(url)
      const k = Math.min(size / img.width, size / img.height)
      const w = img.width * k
      const h = img.height * k
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      api.launchers.setWindowIcon(canvas.toDataURL('image/png')).catch(() => undefined)
    }
    img.src = url
  }, [url])
}
