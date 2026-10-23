import { useEffect, useMemo, useState } from 'react'
import type { BlockIcon as BlockIconId, LoaderId, LoaderVersion, McVersion } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { BlockIcon, Button, Dropdown, Toggle } from '../components/ui'
import { api } from '../lib/api'
import { BLOCK_ICONS, LOADER_ICONS, LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { errorText } from '../lib/format'

const LOADERS: LoaderId[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt']

export function InstallPage() {
  const { consumePendingLoader, run, navigate, settings } = useApp()
  const [loader, setLoader] = useState<LoaderId>(() => consumePendingLoader() ?? 'vanilla')
  const [snapshots, setSnapshots] = useState(settings?.showSnapshots ?? false)
  const [mcVersions, setMcVersions] = useState<McVersion[]>()
  const [supported, setSupported] = useState<Set<string>>()
  const [mcVersion, setMcVersion] = useState<string>()
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>()
  const [loaderVersion, setLoaderVersion] = useState<LoaderVersion>()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<BlockIconId>(LOADER_ICONS[loader])
  const [error, setError] = useState<string>()

  useEffect(() => {
    setMcVersions(undefined)
    api.versions.listMinecraft(snapshots).then(setMcVersions, (e) => setError(errorText(e)))
  }, [snapshots])

  useEffect(() => {
    setSupported(undefined)
    setError(undefined)
    setIcon(LOADER_ICONS[loader])
    if (loader === 'vanilla') return
    api.versions.listLoaderGameVersions(loader).then(
      (v) => setSupported(new Set(v)),
      (e) => setError(errorText(e))
    )
  }, [loader])

  const visible = useMemo(
    () => (mcVersions ?? []).filter((v) => loader === 'vanilla' || supported?.has(v.id)),
    [mcVersions, supported, loader]
  )

  // Keep the selected Minecraft version valid for the current loader.
  useEffect(() => {
    if (visible.length && !visible.some((v) => v.id === mcVersion)) setMcVersion(visible[0].id)
  }, [visible, mcVersion])

  useEffect(() => {
    setLoaderVersions(undefined)
    setLoaderVersion(undefined)
    if (loader === 'vanilla' || !mcVersion) return
    let cancelled = false
    api.versions.listLoaderVersions(loader, mcVersion).then(
      (list) => {
        if (cancelled) return
        setLoaderVersions(list)
        setLoaderVersion(list.find((v) => v.stable) ?? list[0])
      },
      (e) => !cancelled && setError(errorText(e))
    )
    return () => {
      cancelled = true
    }
  }, [loader, mcVersion])

  const loadingList = !mcVersions || (loader !== 'vanilla' && !supported)
  const canInstall = Boolean(mcVersion && (loader === 'vanilla' || loaderVersion))

  const install = (): void => {
    if (!mcVersion) return
    void run(
      () => api.instances.create({ name, icon, mcVersion, loader, loaderVersion: loaderVersion?.version }),
      'Установка завершена'
    )
    navigate('instances')
  }

  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Установка</h1>
          <p>Выберите загрузчик и версию — BigBuncher скачает игру, Java и всё нужное сам.</p>
        </div>
      </div>

      <div className="loader-cards stagger" style={{ marginBottom: 18 }}>
        {LOADERS.map((l) => (
          <button key={l} className={`tile loader-card ${loader === l ? 'active' : ''}`} onClick={() => setLoader(l)}>
            <BlockIcon icon={LOADER_ICONS[l]} size={34} />
            <span style={{ fontWeight: 600 }}>{LOADER_LABELS[l]}</span>
          </button>
        ))}
      </div>

      <div className="install-layout">
        <div className="card">
          <div className="card-title">
            <Icon name="layers" />
            Версия Minecraft
            <span className="spacer" />
            <span className="row muted" style={{ fontSize: 13, fontWeight: 500 }}>
              Снапшоты <Toggle on={snapshots} onChange={setSnapshots} />
            </span>
          </div>
          {error && <div className="chip red" style={{ marginBottom: 10 }}>{error}</div>}
          {loadingList ? (
            <div className="version-list">
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 38 }} />
              ))}
            </div>
          ) : (
            <div className="version-list">
              {visible.map((v) => (
                <div key={v.id} className={`version-item ${v.id === mcVersion ? 'active' : ''}`} onClick={() => setMcVersion(v.id)}>
                  <span className="radio" />
                  <span className="ellipsis">{v.id}</span>
                  {v.type !== 'release' && <span className="tag" style={{ color: 'var(--yellow)' }}>β</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            <Icon name="download" />
            Новая сборка
          </div>

          <div className="field">
            <label>Название</label>
            <input
              className="input"
              placeholder={mcVersion ? `${mcVersion}${loader === 'vanilla' ? '' : ' ' + LOADER_LABELS[loader]}` : 'Моя сборка'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Иконка</label>
            <div className="icon-picker">
              {(Object.keys(BLOCK_ICONS) as BlockIconId[]).map((b) => (
                <button key={b} className={icon === b ? 'active' : ''} onClick={() => setIcon(b)}>
                  <BlockIcon icon={b} size={28} />
                </button>
              ))}
            </div>
          </div>

          {loader !== 'vanilla' && (
            <div className="field">
              <label>Версия {LOADER_LABELS[loader]}</label>
              {loaderVersions === undefined && mcVersion ? (
                <div className="skeleton" style={{ height: 46 }} />
              ) : loaderVersions && loaderVersions.length === 0 ? (
                <div className="chip yellow">Нет сборок {LOADER_LABELS[loader]} для {mcVersion}</div>
              ) : (
                <Dropdown
                  items={loaderVersions ?? []}
                  selected={loaderVersion}
                  keyOf={(v) => v.version}
                  onSelect={setLoaderVersion}
                  renderTrigger={(v) => <span style={{ fontWeight: 600 }}>{v?.version ?? '—'}</span>}
                  renderItem={(v) => (
                    <>
                      <span>{v.version}</span>
                      {v.stable && <span className="chip green" style={{ marginLeft: 'auto', height: 20 }}>stable</span>}
                    </>
                  )}
                />
              )}
            </div>
          )}

          <div className="muted" style={{ fontSize: 13 }}>
            {mcVersion ? (
              <>
                Будет установлено: <b style={{ color: 'var(--text)' }}>Minecraft {mcVersion}</b>
                {loader !== 'vanilla' && loaderVersion && (
                  <>
                    {' '}+ <b style={{ color: 'var(--text)' }}>{LOADER_LABELS[loader]} {loaderVersion.version}</b>
                  </>
                )}
              </>
            ) : (
              'Выберите версию'
            )}
          </div>

          <Button variant="primary" icon="download" style={{ height: 48 }} disabled={!canInstall} onClick={install}>
            Установить
          </Button>
        </div>
      </div>
    </div>
  )
}
