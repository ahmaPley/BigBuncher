import { useCallback, useEffect, useState } from 'react'
import type { InstalledMod, ModProviderId, ModProviderInfo, ModSearchHit } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { InstancePicker } from '../components/InstancePicker'
import { Button, EmptyState, Segmented, Toggle } from '../components/ui'
import { api } from '../lib/api'
import { LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { errorText, formatCount, formatSize } from '../lib/format'

const PAGE_SIZE = 20

export function ModsPage() {
  const { selectedInstance, navigate } = useApp()
  const [tab, setTab] = useState<'browse' | 'installed'>('browse')
  const [installed, setInstalled] = useState<InstalledMod[]>([])

  const reloadInstalled = useCallback(async () => {
    if (selectedInstance) setInstalled(await api.mods.listInstalled(selectedInstance.id))
  }, [selectedInstance])

  useEffect(() => {
    void reloadInstalled()
  }, [reloadInstalled])

  const moddable = selectedInstance && selectedInstance.loader !== 'vanilla'

  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Моды</h1>
          <p>Поиск и установка модов с Modrinth и CurseForge прямо в сборку.</p>
        </div>
        <span className="spacer" />
        <div style={{ width: 290 }}>
          <InstancePicker />
        </div>
      </div>

      {!selectedInstance ? (
        <EmptyState icon="crafting" title="Нет сборки">
          <Button variant="primary" icon="download" onClick={() => navigate('install', { loader: 'fabric' })}>
            Установить сборку с модами
          </Button>
        </EmptyState>
      ) : !moddable ? (
        <EmptyState icon="crafting" title="Это ванильная сборка">
          <span>Моды работают только со сборками на Forge, Fabric, NeoForge или Quilt.</span>
          <Button variant="primary" icon="plus" onClick={() => navigate('install', { loader: 'fabric' })}>
            Создать сборку с загрузчиком
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="mods-toolbar">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'browse', label: <><Icon name="search" size={15} /> Каталог</> },
                { value: 'installed', label: <><Icon name="puzzle" size={15} /> Установленные ({installed.length})</> }
              ]}
            />
            <span className="chip blue">
              {LOADER_LABELS[selectedInstance.loader]} · {selectedInstance.mcVersion}
            </span>
          </div>
          {tab === 'browse' ? (
            <Browse instanceId={selectedInstance.id} installed={installed} onInstalled={setInstalled} />
          ) : (
            <Installed instanceId={selectedInstance.id} mods={installed} onChange={setInstalled} />
          )}
        </>
      )}
    </div>
  )
}

function Browse({
  instanceId,
  installed,
  onInstalled
}: {
  instanceId: string
  installed: InstalledMod[]
  onInstalled(m: InstalledMod[]): void
}) {
  const { selectedInstance, run } = useApp()
  const [providers, setProviders] = useState<ModProviderInfo[]>([])
  const [provider, setProvider] = useState<ModProviderId>('modrinth')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModSearchHit[]>()
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string>()
  const [installing, setInstalling] = useState<string>()

  useEffect(() => {
    void api.mods.providers().then(setProviders)
  }, [])

  const search = useCallback(
    async (offset: number) => {
      if (!selectedInstance) return
      setError(undefined)
      if (offset === 0) setHits(undefined)
      try {
        const res = await api.mods.search({
          provider,
          query,
          mcVersion: selectedInstance.mcVersion,
          loader: selectedInstance.loader,
          offset,
          limit: PAGE_SIZE
        })
        setTotal(res.total)
        setHits((prev) => (offset === 0 ? res.hits : [...(prev ?? []), ...res.hits]))
      } catch (err) {
        setError(errorText(err))
        setHits([])
      }
    },
    [provider, query, selectedInstance]
  )

  useEffect(() => {
    const t = setTimeout(() => void search(0), 350)
    return () => clearTimeout(t)
  }, [search])

  const installedIds = new Set(installed.map((m) => `${m.provider}:${m.projectId}`))

  const install = async (hit: ModSearchHit): Promise<void> => {
    setInstalling(hit.projectId)
    const res = await run(() => api.mods.install(instanceId, hit.provider, hit.projectId), `«${hit.title}» установлен`)
    if (res) onInstalled(res)
    setInstalling(undefined)
  }

  return (
    <>
      <div className="mods-toolbar">
        <div className="input-with-icon" style={{ flex: 1, minWidth: 240 }}>
          <Icon name="search" />
          <input className="input" placeholder="Поиск модов…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Segmented
          value={provider}
          onChange={setProvider}
          options={providers.map((p) => ({
            value: p.id,
            label: <span title={p.reason}>{p.name}</span>,
            disabled: !p.available
          }))}
        />
      </div>
      {providers.find((p) => !p.available) && (
        <div className="dim" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          {providers.find((p) => !p.available)?.reason}
        </div>
      )}

      {error && <div className="chip red" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="mod-list">
        {!hits &&
          Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 74, borderRadius: 12 }} />)}
        {hits?.length === 0 && !error && <EmptyState icon="chest" title="Ничего не найдено" />}
        {hits?.map((hit) => {
          const isInstalled = installedIds.has(`${hit.provider}:${hit.projectId}`)
          return (
            <div key={hit.projectId} className="mod-row" style={{ animation: 'fade-up .35s var(--ease) both' }}>
              {hit.iconUrl ? <img className="mod-icon" src={hit.iconUrl} alt="" /> : <div className="mod-icon"><Icon name="puzzle" /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="title ellipsis">{hit.title}</span>
                  <span className="dim" style={{ fontSize: 12 }}>
                    от {hit.author}
                  </span>
                </div>
                <div className="desc">{hit.description}</div>
                <div className="meta">
                  <Icon name="download" size={11} /> {formatCount(hit.downloads)}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon="external" iconOnly title="Страница мода" onClick={() => void api.system.openExternal(hit.pageUrl)} />
              {isInstalled ? (
                <span className="chip green">
                  <Icon name="check" size={13} /> Установлен
                </span>
              ) : (
                <Button size="sm" variant="primary" icon="download" loading={installing === hit.projectId} onClick={() => void install(hit)}>
                  Установить
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {hits && hits.length < total && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <Button onClick={() => void search(hits.length)}>Показать ещё</Button>
        </div>
      )}
    </>
  )
}

function Installed({ instanceId, mods, onChange }: { instanceId: string; mods: InstalledMod[]; onChange(m: InstalledMod[]): void }) {
  const { run } = useApp()
  const apply = async (action: () => Promise<InstalledMod[]>): Promise<void> => {
    const res = await run(action)
    if (res) onChange(res)
  }

  return (
    <>
      <div className="mods-toolbar">
        <Button icon="plus" onClick={() => void apply(() => api.mods.addFromFile(instanceId))}>
          Добавить .jar
        </Button>
        <Button icon="folder" onClick={() => void run(() => api.mods.openFolder(instanceId))}>
          Папка модов
        </Button>
        <Button variant="ghost" icon="refresh" onClick={() => void apply(() => api.mods.listInstalled(instanceId))}>
          Обновить список
        </Button>
      </div>
      {mods.length === 0 ? (
        <EmptyState icon="chest" title="Модов пока нет">
          <span>Найдите их в каталоге или добавьте свои .jar файлы.</span>
        </EmptyState>
      ) : (
        <div className="mod-list stagger">
          {mods.map((m) => (
            <div key={m.fileName} className={`mod-row ${m.enabled ? '' : 'disabled'}`}>
              {m.iconUrl ? <img className="mod-icon" src={m.iconUrl} alt="" /> : <div className="mod-icon"><Icon name="puzzle" /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title ellipsis">{m.title}</div>
                <div className="meta">
                  {m.version ? `${m.version} · ` : ''}
                  {m.fileName} · {formatSize(m.sizeBytes)}
                  {m.provider ? ` · ${m.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}` : ''}
                </div>
              </div>
              <Toggle on={m.enabled} onChange={(v) => void apply(() => api.mods.setEnabled(instanceId, m.fileName, v))} />
              <Button size="sm" variant="danger" icon="trash" iconOnly title="Удалить" onClick={() => void apply(() => api.mods.remove(instanceId, m.fileName))} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
