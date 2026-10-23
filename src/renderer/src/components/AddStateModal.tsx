import { useEffect, useState } from 'react'
import type { LoaderId, LoaderVersion, McVersion, MultiPack } from '../../../shared/types'
import { api } from '../lib/api'
import { LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { BlockIcon, Button, Modal, Segmented, Toggle } from './ui'

const LOADERS: LoaderId[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt']

/** New state of a multi-pack: a copy of the active state, or a fresh version/loader. */
export function AddStateModal({ pack, onClose }: { pack: MultiPack; onClose(): void }) {
  const { run, instances } = useApp()
  const [stateName, setStateName] = useState('')
  const [mode, setMode] = useState<'clone' | 'fresh' | 'existing'>('clone')
  const standalone = instances.filter((i) => !i.multiPackId)
  const [existingId, setExistingId] = useState(standalone[0]?.id ?? '')
  const [copyWorlds, setCopyWorlds] = useState(false)
  const [loader, setLoader] = useState<LoaderId>('fabric')
  const [mcVersions, setMcVersions] = useState<McVersion[]>([])
  const [supported, setSupported] = useState<Set<string>>()
  const [mcVersion, setMcVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>()
  const [loaderVersion, setLoaderVersion] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode === 'fresh' && !mcVersions.length) void api.versions.listMinecraft(false).then(setMcVersions)
  }, [mode, mcVersions.length])

  useEffect(() => {
    setSupported(undefined)
    if (mode !== 'fresh' || loader === 'vanilla') return
    void api.versions.listLoaderGameVersions(loader).then((v) => setSupported(new Set(v)))
  }, [mode, loader])

  const visible = mcVersions.filter((v) => loader === 'vanilla' || supported?.has(v.id))

  useEffect(() => {
    if (visible.length && !visible.some((v) => v.id === mcVersion)) setMcVersion(visible[0].id)
  }, [visible, mcVersion])

  useEffect(() => {
    setLoaderVersions(undefined)
    setLoaderVersion('')
    if (mode !== 'fresh' || loader === 'vanilla' || !mcVersion) return
    void api.versions.listLoaderVersions(loader, mcVersion).then((list) => {
      setLoaderVersions(list)
      setLoaderVersion((list.find((v) => v.stable) ?? list[0])?.version ?? '')
    })
  }, [mode, loader, mcVersion])

  const canSave =
    mode === 'clone' || (mode === 'existing' ? Boolean(existingId) : Boolean(mcVersion && (loader === 'vanilla' || loaderVersion)))

  const save = async (): Promise<void> => {
    setBusy(true)
    const request =
      mode === 'clone'
        ? { stateName, mode, copyWorlds }
        : mode === 'existing'
          ? { stateName, mode, existingInstanceId: existingId }
          : { stateName, mode, fresh: { name: stateName, icon: pack.icon, mcVersion, loader, loaderVersion: loaderVersion || undefined } }
    // Fresh states install in the background (progress in the sidebar), so don't block the dialog on them.
    const pending = run(() => api.multipacks.addState(pack.id, request), mode === 'fresh' ? 'Новое состояние установлено' : 'Состояние добавлено')
    if (mode !== 'fresh') await pending
    setBusy(false)
    onClose()
  }

  return (
    <Modal title={`Новое состояние · ${pack.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label>Название состояния</label>
          <input className="input" autoFocus placeholder={mode === 'existing' ? 'Пусто = название сборки' : 'Например: «С шейдерами» или «Хардкор»'} value={stateName} onChange={(e) => setStateName(e.target.value)} />
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'clone', label: 'Копия текущего' },
            { value: 'existing', label: 'Существующая сборка', disabled: standalone.length === 0 },
            { value: 'fresh', label: 'Другая версия' }
          ]}
        />
        {mode === 'existing' ? (
          <div className="existing-list">
            {standalone.map((i) => (
              <label key={i.id} className={`existing-item ${existingId === i.id ? 'active' : ''}`}>
                <input type="radio" name="existing" checked={existingId === i.id} onChange={() => setExistingId(i.id)} />
                <BlockIcon icon={i.icon} size={28} />
                <span className="ellipsis" style={{ fontWeight: 600 }}>{i.name}</span>
                <span className="dim" style={{ marginLeft: 'auto', fontSize: 12 }}>
                  {i.mcVersion} · {LOADER_LABELS[i.loader]}
                </span>
              </label>
            ))}
            <p className="dim" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Сборка станет состоянием этой мультисборки со всеми своими модами и мирами — ничего не копируется.
            </p>
          </div>
        ) : mode === 'clone' ? (
          <div className="row muted" style={{ fontSize: 13 }}>
            Скопировать миры тоже <span className="spacer" />
            <Toggle on={copyWorlds} onChange={setCopyWorlds} />
          </div>
        ) : (
          <>
            <Segmented value={loader} onChange={setLoader} options={LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))} />
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Minecraft</label>
                <select className="input" value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
                  {visible.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))}
                </select>
              </div>
              {loader !== 'vanilla' && (
                <div className="field" style={{ flex: 1 }}>
                  <label>{LOADER_LABELS[loader]}</label>
                  <select className="input" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} disabled={!loaderVersions}>
                    {(loaderVersions ?? []).map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version}
                        {v.stable ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon="plus" loading={busy} disabled={!canSave} onClick={() => void save()}>
            Добавить
          </Button>
        </div>
      </div>
    </Modal>
  )
}
