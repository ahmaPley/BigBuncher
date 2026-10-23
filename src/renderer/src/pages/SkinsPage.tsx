import { useEffect, useState } from 'react'
import type { SkinEntry, SkinModel } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { SkinEditor } from '../components/SkinEditor'
import { SkinFront } from '../components/SkinFront'
import { SkinViewer } from '../components/SkinViewer'
import { Button, EmptyState, Modal, Toggle } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'

type Editing = { id?: string; name: string; model: SkinModel; dataUrl: string }

export function SkinsPage() {
  const { skins, selectedAccount, defaultSkin, refreshSkins, run, setAccountsOpen, toast } = useApp()
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedAccount?.skinId)
  const [editing, setEditing] = useState<Editing>()

  // Deep link #skins/new opens the editor directly (used for screenshots / quick access).
  useEffect(() => {
    if (location.hash === '#skins/new' && defaultSkin && !editing) setEditing({ name: 'Новый скин', model: 'classic', dataUrl: defaultSkin })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSkin])
  const [byNickOpen, setByNickOpen] = useState(false)
  const [walk, setWalk] = useState(false)

  const selected = skins.find((s) => s.id === selectedId) ?? skins.find((s) => s.id === selectedAccount?.skinId) ?? skins[0]

  useEffect(() => {
    if (!selectedId && selectedAccount?.skinId) setSelectedId(selectedAccount.skinId)
  }, [selectedAccount, selectedId])

  const afterImport = async (entry: SkinEntry | null | undefined): Promise<void> => {
    if (!entry) return
    await refreshSkins()
    setSelectedId(entry.id)
  }

  const apply = async (skin: SkinEntry): Promise<void> => {
    if (!selectedAccount) {
      setAccountsOpen(true)
      return
    }
    const res = await run(() => api.skins.applyToAccount(selectedAccount.uuid, skin.id))
    if (res) {
      toast(
        'success',
        `Скин «${skin.name}» надет`,
        res.uploadedToMojang ? 'Загружен в профиль Minecraft — виден и на серверах.' : 'Будет применён в игре при следующем запуске.'
      )
    }
  }

  const save = async (result: { name: string; model: SkinModel; dataUrl: string }): Promise<void> => {
    const entry = await run(() => api.skins.save({ ...result, id: editing?.id }), 'Скин сохранён')
    if (entry) {
      await afterImport(entry)
      setEditing(undefined)
    }
  }

  if (editing) {
    return (
      <div className="page">
        <div className="titlebar-spacer" />
        <div className="page-header">
          <div>
            <h1>Редактор скина</h1>
            <p>«Тело» — рисуйте прямо на 3D-модели, «Текстура» — по развёртке. Слева сверху можно скрыть любую часть тела или оверлей.</p>
          </div>
        </div>
        <SkinEditor
          initial={editing.dataUrl}
          initialName={editing.name}
          initialModel={editing.model}
          onSave={save}
          onCancel={() => setEditing(undefined)}
        />
      </div>
    )
  }

  const isWorn = (s: SkinEntry): boolean => s.id === selectedAccount?.skinId

  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Скины</h1>
          <p>Загружайте, рисуйте и надевайте скины — работает даже без входа в Microsoft.</p>
        </div>
      </div>

      <div className="skins-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="skin-stage">
            <SkinViewer
              skin={selected?.dataUrl ?? defaultSkin}
              model={selected?.model ?? 'classic'}
              width={300}
              height={420}
              animation={walk ? 'walk' : 'idle'}
              nameTag={selectedAccount?.name}
              zoom={0.8}
            />
          </div>
          <div className="row muted" style={{ fontSize: 13 }}>
            <Icon name="play" size={13} /> Анимация ходьбы <span className="spacer" />
            <Toggle on={walk} onChange={setWalk} />
          </div>
          {selected && (
            <>
              <Button variant="primary" icon="check" disabled={isWorn(selected)} onClick={() => void apply(selected)} style={{ height: 46 }}>
                {isWorn(selected) ? 'Уже надет' : selectedAccount ? `Надеть на ${selectedAccount.name}` : 'Надеть'}
              </Button>
              <div className="row">
                <Button icon="pencil" style={{ flex: 1 }} onClick={() => setEditing({ ...selected })}>
                  Изменить
                </Button>
                <Button icon="upload" iconOnly title="Экспорт PNG" onClick={() => void run(() => api.skins.exportFile(selected.id))} />
                <Button
                  variant="danger"
                  icon="trash"
                  iconOnly
                  title="Удалить"
                  onClick={async () => {
                    await run(() => api.skins.remove(selected.id))
                    setSelectedId(undefined)
                    await refreshSkins()
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="shirt" />
            Мои скины
            <span className="spacer" />
            <Button size="sm" icon="folder" onClick={() => void run(() => api.skins.importFile()).then(afterImport)}>
              Из файла
            </Button>
            <Button size="sm" icon="user" onClick={() => setByNickOpen(true)}>
              По нику
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="plus"
              disabled={!defaultSkin}
              onClick={() => setEditing({ name: 'Новый скин', model: 'classic', dataUrl: defaultSkin! })}
            >
              Нарисовать
            </Button>
          </div>

          {skins.length === 0 ? (
            <EmptyState icon="chest" title="Библиотека пуста">
              <span>Загрузите PNG 64×64, скопируйте скин игрока по нику или нарисуйте свой.</span>
            </EmptyState>
          ) : (
            <div className="skin-grid stagger">
              {skins.map((s) => (
                <div key={s.id} className={`skin-tile ${selected?.id === s.id ? 'active' : ''}`} onClick={() => setSelectedId(s.id)}>
                  {isWorn(s) && (
                    <span className="chip green badge" style={{ height: 20, fontSize: 10 }}>
                      надет
                    </span>
                  )}
                  <div className="preview">
                    <SkinFront skin={s.dataUrl} model={s.model} />
                  </div>
                  <div className="name ellipsis">{s.name}</div>
                  <div className="dim" style={{ fontSize: 11 }}>
                    {s.model === 'slim' ? 'Alex · тонкие руки' : 'Steve · классика'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {byNickOpen && <ByNickModal onClose={() => setByNickOpen(false)} onImported={afterImport} />}
    </div>
  )
}

function ByNickModal({ onClose, onImported }: { onClose(): void; onImported(e: SkinEntry | undefined): Promise<void> }) {
  const { run } = useApp()
  const [nick, setNick] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Скин по нику" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Скопирует текущий скин любого лицензионного игрока в вашу библиотеку.
      </p>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const entry = await run(() => api.skins.importByUsername(nick), 'Скин скопирован')
          setBusy(false)
          if (entry) {
            await onImported(entry)
            onClose()
          }
        }}
      >
        <input className="input" autoFocus placeholder="Ник игрока" value={nick} onChange={(e) => setNick(e.target.value)} />
        <Button variant="primary" type="submit" loading={busy} disabled={!nick.trim()}>
          Найти
        </Button>
      </form>
    </Modal>
  )
}
