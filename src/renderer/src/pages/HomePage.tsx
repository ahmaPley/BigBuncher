import { useEffect, useState } from 'react'
import { MINECRAFT_LAUNCHER_ID, type LoaderId, type NewsItem, type RecommendedServer, type ServerStatus } from '../../../shared/types'
import { DONATE_URL, RECOMMENDED_SERVERS } from '../../../shared/servers'
import { Icon } from '../components/Icon'
import { InstancePicker } from '../components/InstancePicker'
import { PlayButton } from '../components/PlayButton'
import { SkinViewer } from '../components/SkinViewer'
import { BlockIcon, Button, Modal } from '../components/ui'
import { api } from '../lib/api'
import { BACKGROUNDS, LOADER_ICONS, LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { formatDate, formatPlaytime } from '../lib/format'

const QUICK_LOADERS: LoaderId[] = ['forge', 'fabric', 'neoforge', 'quilt']

export function HomePage() {
  const { settings, selectedAccount, skinOf, navigate, logs, game, playtime } = useApp()
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
                  {game.sessions.length > 1 ? `Запущено игр: ${game.sessions.length}` : 'Игра запущена'}
                </span>
              ) : (
                <span className="chip">
                  <span className="dot" />
                  {selectedAccount ? (selectedAccount.type === 'microsoft' ? 'Онлайн' : 'Оффлайн') : 'Нет аккаунта'}
                </span>
              )}
              {(playtime[MINECRAFT_LAUNCHER_ID] ?? 0) > 0 && (
                <span className="chip" title="Сколько ты наиграл в Minecraft через BigBuncher">
                  <Icon name="clock" size={14} />
                  {formatPlaytime(playtime[MINECRAFT_LAUNCHER_ID])}
                </span>
              )}
              {!settings!.hideDonate && <DonateButton />}
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
          {settings!.hideServers ? <NewsCard /> : <ServersCard />}
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

function ServersCard() {
  const { selectedInstance, instances, launch, navigate, toast, game, run } = useApp()
  const [status, setStatus] = useState<Record<string, ServerStatus>>({})
  const [checking, setChecking] = useState<string>()

  useEffect(() => {
    for (const s of RECOMMENDED_SERVERS) {
      if (s.address) api.server.ping(s.address).then((st) => setStatus((m) => ({ ...m, [s.id]: st })), () => undefined)
    }
  }, [])

  const download = async (s: RecommendedServer): Promise<void> => {
    setChecking(s.id)
    const res = await run(() => api.share.installFeatured(s.id))
    setChecking(undefined)
    if (!res) return
    if (res.failed.length) toast('error', 'Не всё скачалось', `Не получилось: ${res.failed.join(', ')}`)
    else toast('success', `«${s.name}» готова`, 'Жми «Играть»')
  }

  const play = async (s: RecommendedServer): Promise<void> => {
    const own = s.pack && instances.find((i) => i.source === s.id)
    if (s.pack) return own ? launch(own.id) : download(s)
    if (!selectedInstance) {
      toast('info', 'Сначала установи версию', s.kind === 'pack' ? s.packNote : `Подойдёт ${s.versions}`)
      return navigate('install')
    }
    if (s.kind === 'pack') {
      // compares mods/version with the server and opens Доктор when something is missing
      setChecking(s.id)
      const st = await api.server.check(selectedInstance.id, s.address!).catch(() => undefined)
      setChecking(undefined)
      if (st && !st.ok && st.online) return
    }
    await launch(selectedInstance.id, { server: s.address! })
  }

  return (
    <div className="card">
      <div className="card-title">
        <Icon name="server" />
        Рекомендуемые серверы
      </div>
      <div className="server-list">
        {RECOMMENDED_SERVERS.map((s) => {
          const st = status[s.id]
          const own = s.pack && instances.find((i) => i.source === s.id)
          const busy = own ? game.sessions.some((g) => g.instanceId === own.id) : !s.pack && selectedInstance && game.sessions.some((g) => g.instanceId === selectedInstance.id)
          return (
            <div key={s.id} className="server-row" title={s.description}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="server-name">{s.name}</span>
                  <span className="server-tag">{s.versions}</span>
                  <span className={`server-tag ${s.kind}`}>{s.kind === 'vanilla' ? 'Ванилла' : 'Нужна сборка'}</span>
                </div>
                <div className="dim ellipsis" style={{ fontSize: 11 }}>
                  {s.pack
                    ? own
                      ? `✓ установлена · «${own.name}»`
                      : `сборка с картой · ${s.pack.size}`
                    : <>{st ? (st.online ? `● онлайн ${st.players ? `${st.players.online}/${st.players.max}` : ''}` : '○ не отвечает') : 'проверяю…'} · {s.address}</>}
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                icon={s.pack && !own ? 'download' : 'play'}
                loading={checking === s.id}
                disabled={Boolean(busy)}
                title={s.pack ? s.packNote : selectedInstance ? `Зайти через «${selectedInstance.name}»` : undefined}
                onClick={() => void play(s)}
              >
                {s.pack ? (own ? 'Играть' : 'Скачать') : 'Зайти'}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DonateButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" icon="heart" className="donate-btn" title="Поддержать BigBuncher" onClick={() => (DONATE_URL ? void api.system.openExternal(DONATE_URL) : setOpen(true))}>
        Поддержать
      </Button>
      {open && (
        <Modal title="Поддержать BigBuncher" onClose={() => setOpen(false)}>
          <p className="muted" style={{ margin: 0 }}>
            Ссылка на донат скоро появится. Спасибо, что пользуешься BigBuncher! Кнопку можно скрыть в настройках.
          </p>
        </Modal>
      )}
    </>
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
  const { logs, selectedInstance, run, toast } = useApp()
  return (
    <Modal title="Консоль игры" onClose={onClose} width={860}>
      {selectedInstance && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>Вылетело или не пускает на сервер? Доктор прочитает логи и объяснит.</span>
          <span className="spacer" />
          <Button
            size="sm"
            icon="stethoscope"
            onClick={async () => {
              const d = await run(() => api.doctor.analyzeLastRun(selectedInstance.id))
              if (d === null) toast('success', 'Краша не нашёл', 'Последний запуск завершился нормально')
              else if (d) onClose()
            }}
          >
            Доктор крашей
          </Button>
        </div>
      )}
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
