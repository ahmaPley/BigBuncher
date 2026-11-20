import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { BlockIcon as BlockIconId } from '../../../shared/types'
import { BLOCK_ICONS } from '../lib/assets'
import { Icon, type IconName } from './Icon'

/** Small shared building blocks used across pages. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'default'
  size?: 'sm' | 'md'
  icon?: IconName
  iconOnly?: boolean
  loading?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, iconOnly, loading, children, className = '', ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'default' && variant, size === 'sm' && 'sm', iconOnly && 'icon', className]
  return (
    <button className={classes.filter(Boolean).join(' ')} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 18} />}
      {!iconOnly && children}
    </button>
  )
}

export function BlockIcon({ icon, size = 34 }: { icon: BlockIconId; size?: number }) {
  return <img className="block-icon" src={BLOCK_ICONS[icon]} width={size} height={size} alt="" draggable={false} />
}

export function Toggle({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />
}

export function Progress({ value }: { value: number }) {
  const indeterminate = value < 0
  return (
    <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}>
      <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: NoInfer<T>; label: ReactNode; disabled?: boolean }[]
  onChange(v: NoInfer<T>): void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, width }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 48px))` } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <div className="spacer" />
          <Button variant="ghost" size="sm" icon="x" iconOnly onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}

/** Generic dropdown with custom option rendering. */
export function Dropdown<T>({
  items,
  selected,
  renderItem,
  renderTrigger,
  onSelect,
  keyOf,
  up,
  empty
}: {
  items: T[]
  selected?: NoInfer<T>
  renderItem(item: NoInfer<T>): ReactNode
  renderTrigger(item?: NoInfer<T>): ReactNode
  onSelect(item: NoInfer<T>): void
  keyOf(item: NoInfer<T>): string
  up?: boolean
  empty?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pos = usePortalPosition(ref, open, up)

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
    <div className={`dropdown ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen(!open)}>
        {renderTrigger(selected)}
        <Icon name="chevronDown" className="chev" />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className={`dropdown-menu portal ${up ? 'up' : ''}`} style={pos}>
          {items.length === 0 && <div className="empty" style={{ padding: 16 }}>{empty}</div>}
          {items.map((item) => (
            <button
              key={keyOf(item)}
              type="button"
              className={`dropdown-option ${selected && keyOf(selected) === keyOf(item) ? 'selected' : ''}`}
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
            >
              {renderItem(item)}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

/**
 * Menus are drawn in a portal on <body> with fixed coordinates of their trigger, so cards, blur and transforms
 * around them can never cover them. Follows scrolling/resizing while open.
 */
export function usePortalPosition(anchor: RefObject<HTMLElement | null>, open: boolean, up?: boolean, alignRight?: boolean): CSSProperties | undefined {
  const [pos, setPos] = useState<CSSProperties>()
  useLayoutEffect(() => {
    if (!open) return setPos(undefined)
    const place = (): void => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      setPos({
        position: 'fixed',
        left: alignRight ? undefined : r.left,
        right: alignRight ? window.innerWidth - r.right : undefined,
        width: alignRight ? undefined : r.width,
        top: up ? undefined : r.bottom + 6,
        bottom: up ? window.innerHeight - r.top + 6 : undefined
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, up, alignRight, anchor])
  return pos
}

export function EmptyState({ icon, title, children }: { icon: BlockIconId; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <BlockIcon icon={icon} size={56} />
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {children}
    </div>
  )
}
