import { useEffect, useRef, useState } from 'react'
import type { EmbeddableWindow, EmbedState } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'
import { Button, Modal } from './ui'

/**
 * «Рамка для программ»: drag the window of any program (Photoshop, Blockbench, IntelliJ IDEA, a sound editor…)
 * by its title bar onto this frame — it opens inside BigBuncher. The program's window is a native child window
 * placed over the frame (main/embed/windowEmbed.ts); while a dialog or menu of BigBuncher is open it is hidden,
 * otherwise it would cover them.
 */
export function WindowDock({ slot, hint, height = 520 }: { slot: string; hint: string; height?: number }) {
  const { run } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<EmbedState>({ slot, attached: false })
  const [picker, setPicker] = useState(false)
  const [covered, setCovered] = useState(false)

  useEffect(() => {
    api.embed.state(slot).then(setState, () => undefined)
    return api.on('embed', (s) => s.slot === slot && setState(s))
  }, [slot])

  // BigBuncher's own dialogs/menus are drawn on <body>; hide the program while one is open
  useEffect(() => {
    const check = (): void => setCovered(Boolean(document.querySelector('.modal-backdrop, .dropdown-menu.portal, .launcher-switcher-menu.portal')))
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true })
    check()
    return () => mo.disconnect()
  }, [])

  // keep the program exactly over the frame (scroll, resize, layout changes)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    let last = ''
    const send = (): void => {
      raf = 0
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      // only the visible part of the frame (the page may be scrolled under the title bar)
      const top = Math.max(r.top, 40)
      const visible = r.width > 0 && r.bottom > top && r.top < window.innerHeight && !covered && !document.hidden
      const rect = visible ? { x: r.left * dpr, y: top * dpr, width: r.width * dpr, height: (Math.min(r.bottom, window.innerHeight) - top) * dpr } : null
      const key = JSON.stringify(rect)
      if (key === last) return
      last = key
      void api.embed.setFrame(slot, rect).catch(() => undefined)
    }
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(send)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    const poll = setInterval(schedule, 500) // layout shifts no observer sees
    schedule()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      clearInterval(poll)
      cancelAnimationFrame(raf)
      void api.embed.setFrame(slot, null).catch(() => undefined)
    }
  }, [slot, covered])

  return (
    <div className="window-dock-wrap">
      <div className="row" style={{ marginBottom: 8 }}>
        <Icon name="frame" />
        <span className="ellipsis" style={{ fontWeight: 600 }}>
          {state.attached ? state.title || state.exe : 'Рамка для программ'}
        </span>
        {state.attached && state.exe && <span className="dim" style={{ fontSize: 12 }}>{state.exe}</span>}
        <span className="spacer" />
        {state.attached ? (
          <Button size="sm" icon="x" onClick={() => void run(() => api.embed.detach(slot))}>
            Вернуть окно
          </Button>
        ) : (
          <Button size="sm" icon="grid" onClick={() => setPicker(true)}>
            Выбрать окно
          </Button>
        )}
      </div>
      <div ref={ref} className={`window-dock ${state.attached ? 'attached' : ''}`} style={{ height }}>
        {!state.attached && (
          <div className="window-dock-hint">
            <Icon name="frame" size={40} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>Перетащи сюда окно программы</div>
            <div className="muted" style={{ fontSize: 13, maxWidth: 420 }}>
              {hint} Тащи окно за заголовок и отпусти над рамкой — программа откроется внутри BigBuncher.
            </div>
          </div>
        )}
      </div>
      {picker && <WindowPicker slot={slot} onClose={() => setPicker(false)} />}
    </div>
  )
}

function WindowPicker({ slot, onClose }: { slot: string; onClose(): void }) {
  const { run } = useApp()
  const [list, setList] = useState<EmbeddableWindow[]>()
  useEffect(() => {
    api.embed.list().then(setList, () => setList([]))
  }, [])
  return (
    <Modal title="Какое окно вставить?" onClose={onClose} width={620}>
      <div className="addon-list" style={{ maxHeight: 420 }}>
        {!list && <div className="skeleton" style={{ height: 44 }} />}
        {list?.length === 0 && <div className="muted">Открытых окон программ нет. Запусти программу и нажми ещё раз.</div>}
        {list?.map((w) => (
          <button
            key={w.hwnd}
            className="addon-row"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={async () => {
              onClose()
              await run(() => api.embed.attach(slot, w.hwnd))
            }}
          >
            <Icon name="frame" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="title ellipsis">{w.title}</div>
              <div className="dim ellipsis" style={{ fontSize: 12 }}>
                {w.exe}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
