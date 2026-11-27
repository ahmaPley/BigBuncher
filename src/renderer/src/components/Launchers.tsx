import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MINECRAFT_LAUNCHER_ID, type LauncherInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { iconOf, isPixelIcon } from '../lib/launchers'
import { Icon } from './Icon'
import { usePortalPosition } from './ui'

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
  const { launchers, activeLauncher, run, navigate } = useApp()
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
              // Дополнения live in the Minecraft UI (sidebar)
              if (activeLauncher.id !== MINECRAFT_LAUNCHER_ID) void run(() => api.launchers.activate(MINECRAFT_LAUNCHER_ID))
              navigate('addons')
            }}
          >
            <span className="more-icon">
              <Icon name="puzzle" size={16} />
            </span>
            <span className="name">Дополнения…</span>
          </button>
        </div>,
        document.body
      )}
    </div>
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
