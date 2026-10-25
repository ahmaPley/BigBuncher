import { useState } from 'react'
import type { Instance, MultiPack } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { AddStateModal } from '../components/AddStateModal'
import { BlockIcon, Button, EmptyState, Modal } from '../components/ui'
import { api } from '../lib/api'
import { LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { formatDate } from '../lib/format'

type Dialog =
  | { kind: 'rename'; instance: Instance }
  | { kind: 'remove'; instance: Instance }
  | { kind: 'makeMulti'; instance: Instance }
  | { kind: 'addState'; pack: MultiPack }
  | { kind: 'renamePack'; pack: MultiPack }
  | { kind: 'dissolve'; pack: MultiPack }

export function InstancesPage() {
  const { instances, multiPacks, navigate } = useApp()
  const [dialog, setDialog] = useState<Dialog>()
  const singles = instances.filter((i) => !i.multiPackId)
  const close = (): void => setDialog(undefined)

  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Версии</h1>
          <p>Сборки и мультисборки: у каждой свои моды, миры и настройки.</p>
        </div>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => navigate('install')}>
          Новая сборка
        </Button>
      </div>

      {instances.length === 0 ? (
        <EmptyState icon="chest" title="Пока пусто">
          <span>Установите первую версию Minecraft — это займёт пару минут.</span>
          <Button variant="primary" icon="download" onClick={() => navigate('install')}>
            Установить
          </Button>
        </EmptyState>
      ) : (
        <div className="instance-grid stagger">
          {multiPacks.map((p) => (
            <MultiPackCard key={p.id} pack={p} states={instances.filter((i) => i.multiPackId === p.id)} onDialog={setDialog} />
          ))}
          {singles.map((i) => (
            <InstanceCard key={i.id} instance={i} onDialog={setDialog} />
          ))}
        </div>
      )}

      {dialog?.kind === 'rename' && (
        <NameModal
          title={dialog.instance.multiPackId ? 'Переименовать состояние' : 'Переименовать'}
          initial={dialog.instance.stateName ?? dialog.instance.name}
          onClose={close}
          onSave={(name) =>
            dialog.instance.multiPackId ? api.multipacks.renameState(dialog.instance.id, name) : api.instances.rename(dialog.instance.id, name)
          }
        />
      )}
      {dialog?.kind === 'renamePack' && (
        <NameModal title="Переименовать мультисборку" initial={dialog.pack.name} onClose={close} onSave={(name) => api.multipacks.rename(dialog.pack.id, name)} />
      )}
      {dialog?.kind === 'makeMulti' && (
        <NameModal
          title="Сделать мультисборкой"
          hint="Сборка станет первым состоянием. Потом можно добавить другие: копию с другими модами или вообще другую версию — и переключаться одной кнопкой."
          initial={dialog.instance.name}
          action="Создать"
          onClose={close}
          onSave={(name) => api.multipacks.create(dialog.instance.id, name)}
        />
      )}
      {dialog?.kind === 'addState' && <AddStateModal pack={dialog.pack} onClose={close} />}
      {dialog?.kind === 'remove' && <RemoveModal instance={dialog.instance} onClose={close} />}
      {dialog?.kind === 'dissolve' && <DissolveModal pack={dialog.pack} onClose={close} />}
    </div>
  )
}

function useInstanceStatus(i: Instance | undefined) {
  const { tasks, game } = useApp()
  const task = tasks.find((t) => t.status === 'running' && t.instanceId === i?.id)
  const isRunning = game.running && game.instanceId === i?.id
  const chip = task ? (
    <span className="chip yellow">
      <span className="dot" />
      {task.progress >= 0 ? `${Math.round(task.progress * 100)}%` : 'Установка'}
    </span>
  ) : isRunning ? (
    <span className="chip green">
      <span className="dot" />
      Запущена
    </span>
  ) : i?.installed ? (
    <span className="chip green">
      <span className="dot" />
      Готово
    </span>
  ) : (
    <span className="chip red">
      <span className="dot" />
      Не установлена
    </span>
  )
  return { task, chip, busy: Boolean(task) || game.running }
}

const loaderChip = (i: Instance) => (
  <span className="chip blue">
    {LOADER_LABELS[i.loader]}
    {i.loaderVersion ? ` ${i.loaderVersion}` : ''}
  </span>
)

/** Buttons shared by single instances and the active state of a multi-pack. */
function InstanceActions({ instance, onDialog, extra }: { instance: Instance; onDialog(d: Dialog): void; extra?: React.ReactNode }) {
  const { run, navigate, launch, toast } = useApp()
  const { task, busy } = useInstanceStatus(instance)
  return (
    <div className="row" style={{ gap: 6 }}>
      <Button
        variant="primary"
        size="sm"
        icon="play"
        disabled={busy}
        onClick={() => {
          void run(() => api.instances.select(instance.id))
          void launch(instance.id)
        }}
      >
        Играть
      </Button>
      <span className="spacer" />
      {extra}
      <Button size="sm" icon="puzzle" iconOnly title="Моды" onClick={() => void api.instances.select(instance.id).then(() => navigate('mods'))} />
      <Button size="sm" icon="folder" iconOnly title="Открыть папку" onClick={() => void run(() => api.instances.openFolder(instance.id))} />
      <Button
        size="sm"
        icon="stethoscope"
        iconOnly
        title="Доктор крашей: проверить моды и последний запуск"
        onClick={async () => {
          const d = (await run(() => api.doctor.analyzeLastRun(instance.id))) ?? (await run(() => api.doctor.preflight(instance.id)))
          if (d === null) toast('success', 'Проблем не нашёл', 'Моды в порядке, последний запуск без краша')
        }}
      />
      <Button size="sm" icon="pencil" iconOnly title="Переименовать" onClick={() => onDialog({ kind: 'rename', instance })} />
      <Button
        size="sm"
        icon="wrench"
        iconOnly
        title="Проверить и восстановить файлы"
        disabled={Boolean(task)}
        onClick={() => void run(() => api.instances.repair(instance.id), 'Файлы проверены')}
      />
      <Button size="sm" variant="danger" icon="trash" iconOnly title="Удалить" disabled={Boolean(task)} onClick={() => onDialog({ kind: 'remove', instance })} />
    </div>
  )
}

function InstanceCard({ instance: i, onDialog }: { instance: Instance; onDialog(d: Dialog): void }) {
  const { selectedInstance } = useApp()
  const { chip } = useInstanceStatus(i)
  return (
    <div className={`card instance-card ${selectedInstance?.id === i.id ? 'selected' : ''}`}>
      <div className="row">
        <BlockIcon icon={i.icon} size={44} />
        <div style={{ minWidth: 0 }}>
          <h3 className="ellipsis">{i.name}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            Minecraft {i.mcVersion}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {loaderChip(i)}
        {chip}
      </div>
      <div className="dim" style={{ fontSize: 12 }}>
        {i.lastPlayedAt ? `Последний запуск: ${formatDate(i.lastPlayedAt)}` : `Создана: ${formatDate(i.createdAt)}`}
      </div>
      <InstanceActions
        instance={i}
        onDialog={onDialog}
        extra={<Button size="sm" icon="layers" iconOnly title="Сделать мультисборкой" onClick={() => onDialog({ kind: 'makeMulti', instance: i })} />}
      />
    </div>
  )
}

function MultiPackCard({ pack, states, onDialog }: { pack: MultiPack; states: Instance[]; onDialog(d: Dialog): void }) {
  const { selectedInstance, run } = useApp()
  const active = states.find((s) => s.id === pack.activeStateId) ?? states[0]
  const { chip } = useInstanceStatus(active)
  if (!active) return null
  const ordered = [...states].sort((a, b) => a.createdAt - b.createdAt)

  return (
    <div className={`card instance-card multipack-card ${states.some((s) => s.id === selectedInstance?.id) ? 'selected' : ''}`}>
      <div className="row">
        <BlockIcon icon={pack.icon} size={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="ellipsis">{pack.name}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            Мультисборка · {states.length} {states.length === 1 ? 'состояние' : states.length < 5 ? 'состояния' : 'состояний'}
          </div>
        </div>
        <Button size="sm" variant="ghost" icon="pencil" iconOnly title="Переименовать мультисборку" onClick={() => onDialog({ kind: 'renamePack', pack })} />
        <Button size="sm" variant="ghost" icon="layers" iconOnly title="Разделить на обычные сборки" onClick={() => onDialog({ kind: 'dissolve', pack })} />
      </div>

      <div className="state-switch">
        {ordered.map((s) => (
          <button
            key={s.id}
            className={`state-pill ${s.id === active.id ? 'active' : ''}`}
            title={`Minecraft ${s.mcVersion} · ${LOADER_LABELS[s.loader]}`}
            onClick={() => void run(() => api.multipacks.switchState(pack.id, s.id))}
          >
            {s.stateName ?? s.name}
            <span className="sub">{s.mcVersion}</span>
          </button>
        ))}
        <button className="state-pill" title="Добавить состояние" onClick={() => onDialog({ kind: 'addState', pack })}>
          <Icon name="plus" size={13} /> Состояние
        </button>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="chip">Minecraft {active.mcVersion}</span>
        {loaderChip(active)}
        {chip}
      </div>
      <InstanceActions instance={active} onDialog={onDialog} />
    </div>
  )
}

function NameModal({
  title,
  hint,
  initial,
  action = 'Сохранить',
  onSave,
  onClose
}: {
  title: string
  hint?: string
  initial: string
  action?: string
  onSave(name: string): Promise<unknown>
  onClose(): void
}) {
  const { run } = useApp()
  const [name, setName] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}>
      {hint && (
        <p className="muted" style={{ marginTop: 0 }}>
          {hint}
        </p>
      )}
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await run(() => onSave(name))) onClose()
        }}
      >
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" type="submit">
          {action}
        </Button>
      </form>
    </Modal>
  )
}

function RemoveModal({ instance, onClose }: { instance: Instance; onClose(): void }) {
  const { run } = useApp()
  const isState = Boolean(instance.multiPackId)
  return (
    <Modal title={isState ? 'Удалить состояние?' : 'Удалить сборку?'} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        «{instance.stateName ?? instance.name}» пропадёт из списка, а её папка с модами и мирами уйдёт в Корзину Windows — оттуда её можно
        вернуть. Общие файлы игры останутся.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button
          variant="danger"
          icon="trash"
          onClick={() => {
            void run(() => (isState ? api.multipacks.removeState(instance.id) : api.instances.remove(instance.id)), 'Удалено в Корзину')
            onClose()
          }}
        >
          Удалить
        </Button>
      </div>
    </Modal>
  )
}

function DissolveModal({ pack, onClose }: { pack: MultiPack; onClose(): void }) {
  const { run } = useApp()
  return (
    <Modal title="Разделить мультисборку?" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        «{pack.name}» распадётся на обычные сборки — по одной на каждое состояние. Ничего не удаляется.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            void run(() => api.multipacks.dissolve(pack.id))
            onClose()
          }}
        >
          Разделить
        </Button>
      </div>
    </Modal>
  )
}
