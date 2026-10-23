import { useEffect, useState } from 'react'
import type { LoaderId, NewsItem } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { InstancePicker } from '../components/InstancePicker'
import { PlayButton } from '../components/PlayButton'
import { SkinViewer } from '../components/SkinViewer'
import { BlockIcon, Button, Modal } from '../components/ui'
import { api } from '../lib/api'
import { BACKGROUNDS, LOADER_ICONS, LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { formatDate } from '../lib/format'

const QUICK_LOADERS: LoaderId[] = ['forge', 'fabric', 'neoforge', 'quilt']

export function HomePage() {
  const { settings, selectedAccount, skinOf, navigate, logs, game } = useApp()
  const skin = skinOf(selectedAccount)
  const [logsOpen, setLogsOpen] = useState(false)

  return (
    <div className="home">
      <div className="home-bg" style={{ backgroundImage: `url(${BACKGROUNDS[settings!.background].src})` }} />
      <div className="home-shade" />

      <div className="home-content">
        <section className="hero">
          <div className="hero-text stagger">
            <h1>BigBuncher</h1>
            <p className="tagline">Твой мир. Твой Minecraft.</p>
            <PlayButton />
            <div style={{ width: 300 }}>
              <InstancePicker />
            </div>
            <div className="row" style={{ gap: 8 }}>
              {game.running ? (
                <span className="chip green">
                  <span className="dot" />
                  Игра запущена
                </span>
              ) : (
                <span className="chip">
                  <span className="dot" />
                  {selectedAccount ? (selectedAccount.type === 'microsoft' ? 'Онлайн' : 'Оффлайн') : 'Нет аккаунта'}
                </span>
              )}
              {logs.length > 0 && (
                <Button size="sm" variant="ghost" icon="terminal" onClick={() => setLogsOpen(true)}>
                  Консоль
                </Button>
              )}
            </div>
          </div>

          <div className="hero-skin" title="Потяните, чтобы повернуть">
            <div className="hero-skin-glow" />
            <SkinViewer
              skin={skin.dataUrl}
              model={skin.model}
              width={300}
              height={400}
              nameTag={selectedAccount?.name}
              zoom={0.78}
            />
          </div>
        </section>

        <section className="home-cards">
          <NewsCard />
          <div className="card">
            <div className="card-title">
              <Icon name="zap" />
              Быстрый запуск
            </div>
            <div className="quick-grid">
              {QUICK_LOADERS.map((loader) => (
                <button key={loader} className="tile" onClick={() => navigate('install', { loader })}>
                  <BlockIcon icon={LOADER_ICONS[loader]} size={30} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{LOADER_LABELS[loader]}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {logsOpen && <LogsModal onClose={() => setLogsOpen(false)} />}
    </div>
  )
}

function NewsCard() {
  const [news, setNews] = useState<NewsItem[]>()
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api.news.latest().then(setNews, () => setFailed(true))
  }, [])

  const item = news?.[index]
  return (
    <div className="card">
      <div className="card-title">
        <Icon name="news" />
        Последние новости
        <span className="spacer" />
        {news && news.length > 1 && (
          <span className="row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" icon="chevronLeft" iconOnly onClick={() => setIndex((index - 1 + news.length) % news.length)} />
            <span className="dim" style={{ fontSize: 12 }}>
              {index + 1}/{news.length}
            </span>
            <Button size="sm" variant="ghost" icon="chevronRight" iconOnly onClick={() => setIndex((index + 1) % news.length)} />
          </span>
        )}
      </div>
      {failed && <div className="muted">Не удалось загрузить новости — проверьте интернет.</div>}
      {!news && !failed && (
        <div className="row">
          <div className="skeleton" style={{ width: 84, height: 64 }} />
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ height: 14, width: '60%' }} />
            <div className="skeleton" style={{ height: 10 }} />
            <div className="skeleton" style={{ height: 10, width: '80%' }} />
          </div>
        </div>
      )}
      {item && (
        <div className="news-item" key={item.id}>
          {item.imageUrl && <img src={item.imageUrl} alt="" />}
          <div style={{ minWidth: 0 }}>
            <div className="news-title ellipsis">{item.title}</div>
            <div className="news-text">{item.text}</div>
            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
              {formatDate(item.date)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LogsModal({ onClose }: { onClose(): void }) {
  const { logs } = useApp()
  return (
    <Modal title="Консоль игры" onClose={onClose} width={860}>
      <div className="log-view">
        {logs.map((l, i) => (
          <div key={i} className={l.stream === 'err' ? 'err' : /WARN/.test(l.line) ? 'warn' : ''}>
            {l.line}
          </div>
        ))}
      </div>
    </Modal>
  )
}
