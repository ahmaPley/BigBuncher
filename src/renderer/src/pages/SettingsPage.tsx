import { useEffect, useState } from 'react'
import type { Settings } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { Button, Dropdown, Segmented, Toggle } from '../components/ui'
import { api } from '../lib/api'
import { BACKGROUNDS, banner } from '../lib/assets'
import { useApp } from '../lib/appState'
import { formatRam } from '../lib/format'

type JavaOption = { path: string; version: string }

export function SettingsPage() {
  const { settings, run, toast, update: updateInfo } = useApp()
  const [checking, setChecking] = useState(false)
  const [totalMb, setTotalMb] = useState(8192)
  const [javas, setJavas] = useState<JavaOption[]>()
  const [version, setVersion] = useState('')
  const [jvmArgs, setJvmArgs] = useState(settings!.jvmArgs)
  const [cfKey, setCfKey] = useState(settings!.curseforgeApiKey)
  const [res, setRes] = useState(settings!.resolution)

  useEffect(() => {
    void api.system.totalMemoryMb().then(setTotalMb)
    void api.system.appVersion().then(setVersion)
    api.settings.detectJava().then(setJavas, () => setJavas([]))
  }, [])

  const s = settings!
  const update = (patch: Partial<Settings>): void => void run(() => api.settings.update(patch))
  const maxAllowed = Math.max(1024, Math.floor((totalMb - 1024) / 512) * 512)

  const pickGameDir = async (): Promise<void> => {
    const dir = await api.system.pickDirectory('Папка игры BigBuncher')
    if (dir) update({ gameDir: dir })
  }
  const pickJava = async (): Promise<void> => {
    const file = await api.system.pickFile('java.exe / javaw.exe', ['exe'])
    if (file) update({ javaPath: file })
  }

  const javaItems: JavaOption[] = [{ path: '', version: '' }, ...(javas ?? [])]

  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Настройки</h1>
          <p>Сохраняются автоматически.</p>
        </div>
      </div>

      <div className="settings-grid stagger">
        <div className="card">
          <div className="card-title">
            <Icon name="memory" /> Память и производительность
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label>
              Выделение памяти: <span style={{ color: 'var(--green-bright)' }}>{formatRam(s.maxRamMb)}</span>
            </label>
            <input
              type="range"
              min={1024}
              max={maxAllowed}
              step={512}
              value={Math.min(s.maxRamMb, maxAllowed)}
              style={{ ['--fill' as string]: `${((Math.min(s.maxRamMb, maxAllowed) - 1024) / (maxAllowed - 1024)) * 100}%` }}
              onChange={(e) => update({ maxRamMb: Number(e.target.value) })}
            />
            <div className="row dim" style={{ fontSize: 11 }}>
              <span>1 ГБ</span>
              <span className="spacer" />
              <span>Всего в системе: {formatRam(totalMb)}</span>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 18 }}>
            <label>Разрешение окна игры</label>
            <div className="row">
              <input
                className="input"
                type="number"
                value={res.width}
                disabled={res.fullscreen}
                onChange={(e) => setRes({ ...res, width: Number(e.target.value) })}
                onBlur={() => update({ resolution: res })}
              />
              <span className="dim">×</span>
              <input
                className="input"
                type="number"
                value={res.height}
                disabled={res.fullscreen}
                onChange={(e) => setRes({ ...res, height: Number(e.target.value) })}
                onBlur={() => update({ resolution: res })}
              />
            </div>
            <div className="row muted" style={{ fontSize: 13, marginTop: 6 }}>
              Полноэкранный режим <span className="spacer" />
              <Toggle
                on={res.fullscreen}
                onChange={(v) => {
                  const next = { ...res, fullscreen: v }
                  setRes(next)
                  update({ resolution: next })
                }}
              />
            </div>
          </div>

          <div className="field">
            <label>Аргументы JVM</label>
            <input
              className="input"
              placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              onBlur={() => update({ jvmArgs })}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="coffee" /> Java и папка игры
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label>Java</label>
            <Dropdown
              items={javaItems}
              selected={javaItems.find((j) => j.path === s.javaPath) ?? { path: s.javaPath, version: '' }}
              keyOf={(j) => j.path}
              onSelect={(j) => update({ javaPath: j.path })}
              renderTrigger={(j) => <JavaLabel java={j} />}
              renderItem={(j) => <JavaLabel java={j} />}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <Button size="sm" icon="folder" onClick={() => void pickJava()}>
                Указать вручную
              </Button>
              {!javas && <span className="dim" style={{ fontSize: 12 }}>Поиск установленных Java…</span>}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 18 }}>
            <label>Папка игры</label>
            <div className="row">
              <input className="input" readOnly value={s.gameDir} title={s.gameDir} />
              <Button icon="folder" iconOnly title="Изменить" onClick={() => void pickGameDir()} />
              <Button icon="external" iconOnly title="Открыть" onClick={() => void api.system.openPath(s.gameDir)} />
            </div>
            <span className="dim" style={{ fontSize: 12 }}>Здесь хранятся версии, библиотеки, Java и сборки.</span>
          </div>

          <div className="setting-row">
            <div>
              <div className="label">После запуска игры</div>
              <div className="hint">Что делать с окном лаунчера</div>
            </div>
            <span className="spacer" />
            <Segmented
              value={s.afterLaunch}
              onChange={(v) => update({ afterLaunch: v })}
              options={[
                { value: 'minimize', label: 'Свернуть' },
                { value: 'keep', label: 'Оставить' }
              ]}
            />
          </div>
          <div className="setting-row">
            <div>
              <div className="label">Снапшоты</div>
              <div className="hint">Показывать тестовые версии при установке</div>
            </div>
            <span className="spacer" />
            <Toggle on={s.showSnapshots} onChange={(v) => update({ showSnapshots: v })} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="image" /> Фон главного экрана
          </div>
          <div className="bg-picker">
            {Object.entries(BACKGROUNDS).map(([id, bg]) => (
              <button
                key={id}
                title={bg.name}
                className={s.background === id ? 'active' : ''}
                style={{ backgroundImage: `url(${bg.src})` }}
                onClick={() => update({ background: id as Settings['background'] })}
              />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="puzzle" /> Моды
          </div>
          <div className="field">
            <label>API-ключ CurseForge</label>
            <input
              className="input"
              type="password"
              placeholder="Необязательно — Modrinth работает без ключа"
              value={cfKey}
              onChange={(e) => setCfKey(e.target.value)}
              onBlur={() => update({ curseforgeApiKey: cfKey })}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              Ключ выдаётся бесплатно на{' '}
              <a href="#" onClick={() => void api.system.openExternal('https://console.curseforge.com/')}>
                console.curseforge.com
              </a>
            </span>
          </div>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1', display: 'flex', gap: 18, alignItems: 'center' }}>
          <div className="about-banner" style={{ backgroundImage: `url(${banner})`, width: 360, flexShrink: 0 }} />
          <div>
            <h3>BigBuncher {version}</h3>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Лаунчер Minecraft: Java Edition от TambiStudio. Forge, Fabric, NeoForge, Quilt, моды с Modrinth и CurseForge,
              скины с офлайн-поддержкой через authlib-injector.
            </p>
            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              {updateInfo?.available ? (
                <span className="chip green">
                  <span className="dot" />
                  Доступна версия {updateInfo.latestVersion}
                </span>
              ) : updateInfo?.latestVersion ? (
                <span className="chip">
                  <span className="dot" />
                  Последняя версия
                </span>
              ) : null}
              {updateInfo?.error && <span className="chip red">{updateInfo.error}</span>}
              <Button
                size="sm"
                icon="refresh"
                loading={checking}
                onClick={async () => {
                  setChecking(true)
                  const res = await run(() => api.updates.check())
                  setChecking(false)
                  if (res && !res.available && !res.error) toast('success', 'У вас последняя версия')
                }}
              >
                Проверить обновления
              </Button>
              {updateInfo?.available && (
                <Button size="sm" variant="primary" icon="download" onClick={() => void run(() => api.updates.install())}>
                  Обновить и перезапустить
                </Button>
              )}
              <span className="dim" style={{ fontSize: 11 }}>Источник: {updateInfo?.source}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function JavaLabel({ java }: { java?: JavaOption }) {
  if (!java || !java.path) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>Автоматически</div>
        <div className="muted" style={{ fontSize: 12 }}>
          Нужная версия Java скачивается сама
        </div>
      </div>
    )
  }
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600 }}>Java {java.version || '?'}</div>
      <div className="muted ellipsis" style={{ fontSize: 12 }}>
        {java.path}
      </div>
    </div>
  )
}
