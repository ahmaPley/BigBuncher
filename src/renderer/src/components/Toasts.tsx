import { useApp } from '../lib/appState'
import { Icon } from './Icon'

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={20} />
          <div style={{ minWidth: 0 }}>
            <div className="title">{t.title}</div>
            {t.text && <div className="text">{t.text}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
