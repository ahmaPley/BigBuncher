import { useCallback, useEffect, useRef, useState } from 'react'
import { MINECRAFT_LAUNCHER_ID, type AddonFile, type AddonTemplate, type AvailableAddon, type LauncherInfo } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { LauncherIcon } from '../components/Launchers'
import { PluginFrame } from '../components/PluginHost'
import { Button, Dropdown, Modal } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { errorText, formatPlaytime } from '../lib/format'

/**
 * «Дополнения» — plugins for BigBuncher (launchers of other games and your own).
 * Left: create from a template, other plugins found on this PC. Right: share, installed, editor.
 */
export function AddonsPage() {
  const [editing, setEditing] = useState<string>()
  return editing ? <AddonEditor id={editing} onOpen={setEditing} onClose={() => setEditing(undefined)} /> : <AddonsOverview onEdit={setEditing} />
}

function AddonsOverview({ onEdit }: { onEdit(id: string): void }) {
  const { launchers } = useApp()
  const plugins = launchers.filter((l) => l.id !== MINECRAFT_LAUNCHER_ID)
  return (
    <div className="page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Дополнения</h1>
          <p>Плагины для BigBuncher: лаунчеры других игр и твои собственные.</p>
        </div>
      </div>
      <div className="addons-grid">
        <div className="addons-col">
          <CreateCard plugins={plugins} onCreated={onEdit} />
          <OthersCard />
        </div>
        <div className="addons-col">
          <ShareCard plugins={plugins} />
          <InstalledCard plugins={plugins} onEdit={onEdit} />
        </div>
      </div>
    </div>
  )
}

/* ---------- Создать ---------- */

type TemplateItem = AddonTemplate & { copyOf?: LauncherInfo }

function CreateCard({ plugins, onCreated }: { plugins: LauncherInfo[]; onCreated(id: string): void }) {
  const { run, toast } = useApp()
  const [templates, setTemplates] = useState<AddonTemplate[]>([])
  const [selected, setSelected] = useState<TemplateItem>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [howTo, setHowTo] = useState(false)

  useEffect(() => {
    api.addons.templates().then(setTemplates, () => undefined)
  }, [])

  const items: TemplateItem[] = [
    ...templates,
    ...plugins.map((p) => ({ id: `copy:${p.id}`, name: `На основе «${p.name}»`, description: 'Копия установленного плагина — меняй под себя', copyOf: p }))
  ]
  const current = selected ?? items[0]

  const create = async (): Promise<void> => {
    if (!current) return
    setBusy(true)
    const info = await run(() => api.addons.create(current.id, name))
    setBusy(false)
    if (info) {
      toast('success', `Плагин «${info.name}» создан`, 'Меняй файлы — предпросмотр обновляется сразу')
      setName('')
      onCreated(info.id)
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <Icon name="plus" />
        Создать
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon="info" onClick={() => setHowTo(true)}>
          Как создать
        </Button>
      </div>
      <div className="field">
        <label>Заготовка</label>
        <Dropdown
          items={items}
          selected={current}
          keyOf={(t) => t.id}
          onSelect={setSelected}
          renderTrigger={(t) => <span>{t?.name ?? 'Выберите'}</span>}
          renderItem={(t) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {t.copyOf ? <LauncherIcon launcher={t.copyOf} size={22} /> : <Icon name="code" />}
              <div style={{ minWidth: 0 }}>
                <div>{t.name}</div>
                <div className="dim ellipsis" style={{ fontSize: 11 }}>
                  {t.description}
                </div>
              </div>
            </div>
          )}
        />
      </div>
      <div className="row">
        <input className="input" style={{ flex: 1 }} placeholder="Название плагина" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
        <Button variant="primary" icon="plus" loading={busy} onClick={() => void create()}>
          Создать
        </Button>
      </div>
      {howTo && <HowToModal onClose={() => setHowTo(false)} />}
    </div>
  )
}

function HowToModal({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Как создать плагин" onClose={onClose} width={620}>
      <ol className="howto">
        <li>
          Выбери заготовку, впиши название и нажми <b>Создать</b> — откроется редактор.
        </li>
        <li>
          <b>Сделай сам:</b> слева файлы плагина, меняй их прямо в редакторе — справа сразу видно, как выглядит интерфейс.
        </li>
        <li>
          <b>Или попроси ИИ:</b> в редакторе нажми «Инструкция для ИИ» — отдай этот файл Claude или ChatGPT вместе со словами «сделай плагин для BigBuncher, который…». Готовые файлы закинь в папку плагина («Открыть папку»).
        </li>
        <li>
          Готово — <b>Поделиться</b> сохранит zip, друг ставит его через «Установить из ZIP».
        </li>
      </ol>
      <div className="dim" style={{ fontSize: 12 }}>
        Правила: изменения видны сразу; плагин работает только через мост BigBuncher (без доступа к файлам ПК); без плагина всё работает как раньше; никаких паролей и токенов в файлах.
      </div>
    </Modal>
  )
}

/* ---------- Другие (найдены на ПК) ---------- */

function OthersCard() {
  const { run, toast, launchers } = useApp()
  const [list, setList] = useState<AvailableAddon[]>()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.addons.available().then(setList, () => setList([]))
  }, [])
  // installed versions change after installing/removing
  useEffect(load, [load, launchers.length])

  const toggle = (file: string): void =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(file)) n.delete(file)
      else n.add(file)
      return n
    })

  const installChecked = async (): Promise<void> => {
    setBusy(true)
    const done = await run(() => api.addons.installFiles([...checked]))
    setBusy(false)
    if (done) {
      toast('success', done.length === 1 ? `Установлен «${done[0].name}»` : `Установлено плагинов: ${done.length}`)
      setChecked(new Set())
      load()
    }
  }

  const installZip = async (): Promise<void> => {
    const info = await run(() => api.launchers.installZip())
    if (info) toast('success', `Установлен «${info.name}»`)
  }

  return (
    <div className="card">
      <div className="card-title">
        <Icon name="download" />
        Другие
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon="refresh" iconOnly title="Поискать ещё раз" onClick={load} />
      </div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        Плагины в «Загрузках» и в папке «Лаунчеры» рядом с BigBuncher.
      </div>
      <div className="addon-list">
        {!list && <div className="skeleton" style={{ height: 44 }} />}
        {list?.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Ничего не нашлось. Скачай zip плагина или поставь его из файла.</div>}
        {list?.map((a) => {
          const same = a.installedVersion === a.version
          return (
            <label key={a.file} className={`addon-row ${same ? 'disabled' : ''}`} title={a.file}>
              <input type="checkbox" disabled={same} checked={checked.has(a.file)} onChange={() => toggle(a.file)} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="title ellipsis">
                  {a.name} <span className="dim">v{a.version}</span>
                </div>
                <div className="dim ellipsis" style={{ fontSize: 12 }}>
                  {same ? 'Уже установлен' : a.installedVersion ? `Обновление: у тебя v${a.installedVersion}` : a.description || a.author}
                </div>
              </div>
            </label>
          )
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button icon="upload" onClick={() => void installZip()}>
          Из ZIP…
        </Button>
        <span className="spacer" />
        <Button variant="primary" icon="download" disabled={checked.size === 0} loading={busy} onClick={() => void installChecked()}>
          Установить{checked.size ? ` (${checked.size})` : ''}
        </Button>
      </div>
    </div>
  )
}

/* ---------- Поделиться ---------- */

function ShareCard({ plugins }: { plugins: LauncherInfo[] }) {
  const { run, toast } = useApp()
  const [selected, setSelected] = useState<LauncherInfo>()
  const current = plugins.find((p) => p.id === selected?.id)
  const share = async (): Promise<void> => {
    if (!current) return
    const file = await run(() => api.addons.exportZip(current.id))
    if (file) toast('success', 'Zip сохранён', 'Отправь его другу — он поставит через «Из ZIP…»')
  }
  return (
    <div className="card">
      <div className="card-title">
        <Icon name="share" />
        Поделиться
      </div>
      <div className="row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Dropdown
            items={plugins}
            selected={current}
            keyOf={(p) => p.id}
            onSelect={setSelected}
            empty="Нет установленных плагинов"
            renderTrigger={(p) =>
              p ? (
                <span className="row" style={{ gap: 8 }}>
                  <LauncherIcon launcher={p} size={20} />
                  {p.name}
                </span>
              ) : (
                <span className="dim">Выберите</span>
              )
            }
            renderItem={(p) => (
              <span className="row" style={{ gap: 8 }}>
                <LauncherIcon launcher={p} size={22} />
                {p.name}
              </span>
            )}
          />
        </div>
        <Button variant="primary" icon="save" disabled={!current} onClick={() => void share()}>
          Сохранить zip
        </Button>
      </div>
    </div>
  )
}

/* ---------- Установленные ---------- */

function InstalledCard({ plugins, onEdit }: { plugins: LauncherInfo[]; onEdit(id: string): void }) {
  const { run, toast, activeLauncher, playtime } = useApp()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)

  const toggle = (id: string): void => {
    setConfirm(false)
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const ids = [...checked].filter((id) => plugins.some((p) => p.id === id))

  const removeChecked = async (): Promise<void> => {
    if (!confirm) return setConfirm(true)
    setConfirm(false)
    for (const id of ids) await run(() => api.launchers.remove(id))
    setChecked(new Set())
    toast('success', 'Удалено в Корзину')
  }

  return (
    <div className="card">
      <div className="card-title">
        <Icon name="grid" />
        Установленные
        <span className="spacer" />
        <Button size="sm" icon="code" disabled={plugins.length === 0} onClick={() => onEdit(ids[0] ?? plugins[0].id)}>
          Редактор
        </Button>
      </div>
      <div className="addon-list">
        {plugins.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Пока ни одного — поставь из «Другие» или создай свой.</div>}
        {plugins.map((p) => (
          <label key={p.id} className={`addon-row ${p.id === activeLauncher.id ? 'active' : ''}`} style={{ ['--accent' as string]: p.accent }}>
            <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
            <LauncherIcon launcher={p} size={34} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="title ellipsis">
                {p.name} <span className="dim">v{p.version}</span>
              </div>
              <div className="dim ellipsis" style={{ fontSize: 12 }}>
                {(playtime[p.id] ?? 0) > 0 ? (
                  <>
                    <Icon name="clock" size={12} /> {formatPlaytime(playtime[p.id])}
                  </>
                ) : (
                  p.description || p.author
                )}
              </div>
            </div>
            <Button size="sm" variant="ghost" icon="code" iconOnly title="Редактор" onClick={(e) => (e.preventDefault(), onEdit(p.id))} />
            <Button size="sm" variant="primary" icon="play" onClick={(e) => (e.preventDefault(), void run(() => api.launchers.activate(p.id)))}>
              Открыть
            </Button>
          </label>
        ))}
      </div>
      {ids.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            Выбрано: {ids.length}
          </span>
          <span className="spacer" />
          <Button variant={confirm ? 'danger' : 'default'} icon="trash" onClick={() => void removeChecked()}>
            {confirm ? 'Точно удалить?' : 'Удалить'}
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------- Редактор ---------- */

function AddonEditor({ id, onOpen, onClose }: { id: string; onOpen(id: string): void; onClose(): void }) {
  const { launchers, run, toast } = useApp()
  const plugins = launchers.filter((l) => l.id !== MINECRAFT_LAUNCHER_ID)
  const plugin = plugins.find((p) => p.id === id)
  const [files, setFiles] = useState<AddonFile[]>([])
  const [file, setFile] = useState<string>()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<{ kind: 'saved' | 'dirty' | 'error'; text?: string }>({ kind: 'saved' })
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<{ file: string; text: string }>(undefined)

  const loadFiles = useCallback(() => {
    api.addons.listFiles(id).then((list) => {
      setFiles(list)
      setFile((f) => (f && list.some((x) => x.path === f) ? f : (list.find((x) => x.path === 'index.html') ?? list.find((x) => x.editable))?.path))
    }, () => setFiles([]))
  }, [id])
  useEffect(loadFiles, [loadFiles])

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    const p = pending.current
    if (!p) return
    pending.current = undefined
    try {
      await api.addons.writeFile(id, p.file, p.text)
      setStatus({ kind: 'saved' })
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) })
    }
  }, [id])

  useEffect(() => {
    if (!file) return
    let alive = true
    api.addons.readFile(id, file).then(
      (t) => alive && (setText(t), setStatus({ kind: 'saved' })),
      (err) => alive && (setText(''), setStatus({ kind: 'error', text: errorText(err) }))
    )
    return () => {
      alive = false
    }
  }, [id, file])

  // a file changed outside (AI, VS Code): show the new text unless the player is typing in it
  useEffect(
    () =>
      api.on('addonChanged', (e) => {
        if (e.id !== id) return
        loadFiles()
        if (e.file === file && !pending.current) api.addons.readFile(id, file).then(setText, () => undefined)
      }),
    [id, file, loadFiles]
  )

  // save what was typed before switching file/plugin or leaving
  useEffect(() => () => void flush(), [flush, file])

  const edit = (next: string): void => {
    setText(next)
    setStatus({ kind: 'dirty' })
    pending.current = { file: file!, text: next }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), 700)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void flush()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: a, selectionEnd: b } = el
      edit(text.slice(0, a) + '  ' + text.slice(b))
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
    }
  }

  const editable = files.find((f) => f.path === file)?.editable

  return (
    <div className="page addon-editor-page">
      <div className="titlebar-spacer" />
      <div className="page-header" style={{ marginBottom: 14 }}>
        <Button variant="ghost" icon="chevronLeft" onClick={onClose}>
          Дополнения
        </Button>
        <h1 style={{ fontSize: 20 }}>Редактор</h1>
        <span className="spacer" />
        {plugin && (
          <>
            <Button size="sm" icon="folder" onClick={() => void run(() => api.addons.openFolder(id))}>
              Открыть папку
            </Button>
            <Button size="sm" icon="info" onClick={async () => (await run(() => api.addons.guide(id))) && (toast('success', 'Инструкция для ИИ сохранена', 'Файл ИНСТРУКЦИЯ-ДЛЯ-ИИ.md в папке плагина'), loadFiles())}>
              Инструкция для ИИ
            </Button>
            <Button size="sm" icon="share" onClick={() => void run(() => api.addons.exportZip(id))}>
              Поделиться
            </Button>
          </>
        )}
      </div>

      <div className="addon-editor">
        <div className="addon-side">
          <div className="addon-side-title">Плагины</div>
          {plugins.map((p) => (
            <button key={p.id} className={`addon-side-item ${p.id === id ? 'active' : ''}`} onClick={() => p.id !== id && (void flush(), onOpen(p.id))}>
              <LauncherIcon launcher={p} size={18} />
              <span className="ellipsis">{p.name}</span>
            </button>
          ))}
          <div className="addon-side-title" style={{ marginTop: 12 }}>
            Файлы
          </div>
          {files.map((f) => (
            <button key={f.path} className={`addon-side-item file ${f.path === file ? 'active' : ''} ${f.editable ? '' : 'disabled'}`} disabled={!f.editable} title={f.editable ? f.path : 'Не текстовый — меняй через «Открыть папку»'} onClick={() => setFile(f.path)}>
              <span className="ellipsis">{f.path}</span>
            </button>
          ))}
        </div>

        <div className="addon-code">
          <div className="addon-code-bar">
            <span className="ellipsis" style={{ fontWeight: 600 }}>{file ?? '—'}</span>
            <span className="spacer" />
            <span className={`addon-status ${status.kind}`} title={status.text}>
              {status.kind === 'saved' ? 'Сохранено' : status.kind === 'dirty' ? 'Сохраняю…' : status.text}
            </span>
          </div>
          <textarea spellCheck={false} value={text} disabled={!editable} onChange={(e) => edit(e.target.value)} onKeyDown={onKeyDown} data-no-i18n />
        </div>

        <div className="addon-preview">
          <div className="addon-code-bar">
            <Icon name="eye" size={15} />
            <span style={{ fontWeight: 600 }}>Предпросмотр</span>
            <span className="spacer" />
            <span className="dim" style={{ fontSize: 11 }}>
              обновляется сам
            </span>
          </div>
          {plugin ? <PluginFrame key={plugin.id} launcher={plugin} /> : <div className="muted" style={{ padding: 16 }}>Плагин удалён</div>}
        </div>
      </div>
    </div>
  )
}
