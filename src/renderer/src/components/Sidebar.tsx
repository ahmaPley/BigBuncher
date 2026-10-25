import { useState } from 'react'
import { logo } from '../lib/assets'
import { useApp, type PageId } from '../lib/appState'
import { Icon, type IconName } from './Icon'
import { SkinHead } from './SkinHead'
import { api } from '../lib/api'
import { Button, Progress } from './ui'

const NAV: { id: PageId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'install', label: 'Установка', icon: 'download' },
  { id: 'instances', label: 'Версии', icon: 'cube' },
  { id: 'mods', label: 'Моды', icon: 'puzzle' },
  { id: 'packs', label: 'Текстурпаки', icon: 'image' },
  { id: 'skins', label: 'Скины', icon: 'shirt' },
  { id: 'dev', label: 'Разработка', icon: 'code' },
  { id: 'settings', label: 'Настройки', icon: 'settings' }
]

export function Sidebar() {
  const { page, navigate, instances, multiPacks, tasks, selectedAccount, skinOf, setAccountsOpen, update, run, settings } = useApp()
  const nav = NAV.filter((n) => n.id !== 'dev' || settings?.devMode)
  const [installing, setInstalling] = useState(false)
  // A multi-pack counts once, however many states it has.
  const visibleCount = instances.filter((i) => !i.multiPackId).length + multiPacks.length
  const running = tasks.filter((t) => t.status === 'running')

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logo} alt="" draggable={false} />
        BigBuncher
      </div>

      <nav className="nav">
        {nav.map((item) => (
          <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
            <Icon name={item.icon} />
            {item.label}
            {item.id === 'instances' && visibleCount > 0 && <span className="nav-badge">{visibleCount}</span>}
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        {update?.available && (
          <div className="update-banner">
            <div className="title">Доступно обновление {update.latestVersion}</div>
            <div className="text">Сейчас у вас {update.currentVersion}. Лаунчер скачает новую версию и перезапустится.</div>
            <Button
              size="sm"
              variant="primary"
              icon="download"
              loading={installing}
              style={{ width: '100%' }}
              onClick={async () => {
                setInstalling(true)
                await run(() => api.updates.install())
                setInstalling(false)
              }}
            >
              Обновить
            </Button>
          </div>
        )}
        {running.map((task) => (
          <div key={task.id} className="task-dock">
            <div className="row">
              <span className="title ellipsis">{task.title}</span>
              <span className="spacer" />
              {task.progress >= 0 && <span className="dim" style={{ fontSize: 11 }}>{Math.round(task.progress * 100)}%</span>}
            </div>
            <div className="detail ellipsis">{task.detail ?? 'Подготовка…'}</div>
            <Progress value={task.progress} />
          </div>
        ))}

        <div className="account-card" onClick={() => setAccountsOpen(true)}>
          {selectedAccount ? (
            <>
              <SkinHead skin={skinOf(selectedAccount).dataUrl} />
              <div style={{ minWidth: 0 }}>
                <div className="name ellipsis">{selectedAccount.name}</div>
                <div className="type">{selectedAccount.type === 'microsoft' ? 'Microsoft' : 'Офлайн'}</div>
              </div>
            </>
          ) : (
            <>
              <div className="avatar" style={{ display: 'grid', placeItems: 'center' }}>
                <Icon name="user" />
              </div>
              <div>
                <div className="name">Войти</div>
                <div className="type">Добавьте аккаунт</div>
              </div>
            </>
          )}
          <Icon name="chevronRight" className="dim" />
        </div>
      </div>
    </aside>
  )
}
