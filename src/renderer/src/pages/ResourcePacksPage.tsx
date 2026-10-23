import { useCallback, useEffect, useState } from 'react'
import type { ResourcePack } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { InstancePicker } from '../components/InstancePicker'
import { Button, EmptyState, Toggle } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { formatSize } from '../lib/format'

export function ResourcePacksPage() {
  const { selectedInstance, run } = useApp()
  const [shared, setShared] = useState<ResourcePack[]>()
  const [own, setOwn] = useState<ResourcePack[]>()

  useEffect(() => {
    api.resourcepacks.listShared().then(setShared, () => setShared([]))
  }, [])

  const reloadOwn = useCallback(() => {
    setOwn(undefined)
    if (selectedInstance) api.resourcepacks.listForInstance(selectedInstance.id).then(setOwn, () => setOwn([]))
  }, [selectedInstance])

  useEffect(reloadOwn, [reloadOwn])

  const sharedAction = async (action: () => Promise<ResourcePack[]>, ok?: string): Promise<void> => {
    const res = await run(action, ok)
    if (res) setShared(res)
  }
  const ownAction = async (action: () => Promise<ResourcePack[]>, ok?: string): Promise<void> => {
    const res = await run(action, ok)
    if (res) setOwn(res)
  }

  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Текстурпаки</h1>
          <p>Общие паки подключаются к каждой сборке на любой версии, а свои — только к выбранной.</p>
        </div>
      </div>

      <div className="packs-layout">
        <div className="card">
          <div className="card-title">
            <Icon name="globe" />
            Общие паки
            <span className="spacer" />
            <Button size="sm" icon="folder" iconOnly title="Открыть папку" onClick={() => void run(() => api.resourcepacks.openSharedFolder())} />
            <Button size="sm" variant="primary" icon="plus" onClick={() => void sharedAction(() => api.resourcepacks.addShared())}>
              Добавить .zip
            </Button>
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: -6 }}>
            «Авто» — пак сам включается в игре в каждой сборке, даже если он сделан для другой версии.
          </p>
          <PackList
            packs={shared}
            empty="Общих паков пока нет"
            onRemove={(p) => void sharedAction(() => api.resourcepacks.removeShared(p.fileName), 'Пак отправлен в Корзину')}
            onAuto={(p, on) => void sharedAction(() => api.resourcepacks.setAutoEnable(p.fileName, on))}
          />
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="cube" />
            Только для сборки
            <span className="spacer" />
            {selectedInstance && (
              <>
                <Button size="sm" icon="folder" iconOnly title="Открыть папку" onClick={() => void run(() => api.resourcepacks.openInstanceFolder(selectedInstance.id))} />
                <Button size="sm" variant="primary" icon="plus" onClick={() => void ownAction(() => api.resourcepacks.addToInstance(selectedInstance.id))}>
                  Добавить .zip
                </Button>
              </>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <InstancePicker />
          </div>
          {selectedInstance ? (
            <PackList
              packs={own}
              empty="В этой сборке своих паков нет"
              onRemove={(p) => void ownAction(() => api.resourcepacks.removeFromInstance(selectedInstance.id, p.fileName), 'Пак отправлен в Корзину')}
            />
          ) : (
            <EmptyState icon="grass" title="Сначала создайте сборку" />
          )}
        </div>
      </div>
    </div>
  )
}

function PackList({
  packs,
  empty,
  onRemove,
  onAuto
}: {
  packs?: ResourcePack[]
  empty: string
  onRemove(p: ResourcePack): void
  onAuto?(p: ResourcePack, on: boolean): void
}) {
  if (!packs) return <div className="mod-list">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12 }} />)}</div>
  if (!packs.length) return <EmptyState icon="chest" title={empty}><span>Перетащите .zip в папку или нажмите «Добавить».</span></EmptyState>
  return (
    <div className="mod-list stagger">
      {packs.map((p) => (
        <div key={p.fileName} className="mod-row">
          {p.iconDataUrl ? <img className="mod-icon pixelated" src={p.iconDataUrl} alt="" /> : <div className="mod-icon"><Icon name="image" /></div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="title ellipsis">{p.title}</div>
            {p.description && <div className="desc">{p.description}</div>}
            <div className="meta">
              {p.packFormat !== undefined ? `pack_format ${p.packFormat}` : 'папка'}
              {p.sizeBytes ? ` · ${formatSize(p.sizeBytes)}` : ''}
            </div>
          </div>
          {onAuto && (
            <span className="row muted" style={{ fontSize: 12, gap: 6 }}>
              Авто <Toggle on={Boolean(p.autoEnable)} onChange={(v) => onAuto(p, v)} />
            </span>
          )}
          <Button size="sm" variant="danger" icon="trash" iconOnly title="Удалить (в Корзину)" onClick={() => onRemove(p)} />
        </div>
      ))}
    </div>
  )
}
