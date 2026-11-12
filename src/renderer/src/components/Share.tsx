import { useEffect, useState } from 'react'
import type { Instance, ServerStatus, SharePreview, ShareResult } from '../../../shared/types'
import { api } from '../lib/api'
import { LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'
import { Button, Modal } from './ui'

const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

/** "Поделиться": code for a whole instance (or one mod) + saving the instance as a .bbpack file. */
export function ShareModal({ instance, mod, onClose }: { instance: Instance; mod?: { fileName: string; title: string }; onClose(): void }) {
  const { run, toast } = useApp()
  const [result, setResult] = useState<ShareResult>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.share.createCode(instance.id, mod?.fileName).then(setResult, (err) => setError(errorText(err)))
  }, [instance.id, mod?.fileName])

  const copy = async (): Promise<void> => {
    if (!result) return
    await navigator.clipboard.writeText(result.code)
    toast('success', 'Код скопирован', 'Отправь его другу: он вставит его в «Добавить по коду»')
  }

  return (
    <Modal title={mod ? `Поделиться модом «${mod.title}»` : `Поделиться сборкой «${instance.name}»`} onClose={onClose} width={620}>
      {!result && !error && (
        <div className="row muted">
          <span className="spinner" /> Ищу моды на Modrinth и собираю код…
        </div>
      )}
      {error && <p className="share-warn">{error}</p>}
      {result && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {mod
              ? 'Друг вставит код в BigBuncher («Версии» → «Добавить по коду») и выберет сборку: мод скачается с Modrinth вместе с зависимостями.'
              : `Друг вставит код в BigBuncher («Версии» → «Добавить по коду»), и у него появится такая же сборка: Minecraft ${instance.mcVersion}, ${LOADER_LABELS[instance.loader]}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''} и ${result.shared} мод(ов) тех же версий.`}
          </p>
          <textarea className="input share-code" readOnly value={result.code} onFocus={(e) => e.currentTarget.select()} rows={4} />
          {result.missing.length > 0 && (
            <p className="share-warn">
              <Icon name="alert" size={15} />{' '}
              {`Кодом не передать мод(ов): ${result.missing.length} — их нет на Modrinth: ${result.missing.join(', ')}. Чтобы друг получил всё (и конфиги, квесты, скрипты), сохрани сборку файлом.`}
            </p>
          )}
          {!mod && result.missing.length === 0 && (
            <p className="dim" style={{ fontSize: 12 }}>
              В код входят только моды. Конфиги, квесты и скрипты KubeJS передаёт файл сборки.
            </p>
          )}
        </>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        {!mod && (
          <Button
            icon="save"
            loading={saving}
            onClick={async () => {
              setSaving(true)
              const path = await run(() => api.share.saveFile(instance.id))
              setSaving(false)
              if (path) toast('success', 'Сборка сохранена', `${path} — отправь этот файл другу`)
            }}
          >
            Сохранить файлом (.bbpack)
          </Button>
        )}
        <Button variant="primary" icon="copy" disabled={!result} onClick={() => void copy()}>
          Скопировать код
        </Button>
      </div>
    </Modal>
  )
}

/** "Добавить по коду": paste a friend's code (or open a .bbpack) → preview → install. */
export function ImportModal({ onClose }: { onClose(): void }) {
  const { instances, selectedInstance, run, toast, navigate } = useApp()
  const [code, setCode] = useState('')
  const [file, setFile] = useState<string>()
  const [preview, setPreview] = useState<SharePreview>()
  const [error, setError] = useState<string>()
  const [target, setTarget] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (file) return
    setPreview(undefined)
    setError(undefined)
    if (!code.trim()) return
    const t = setTimeout(() => api.share.preview(code).then(setPreview, (err) => setError(errorText(err))), 250)
    return () => clearTimeout(t)
  }, [code, file])

  const moddable = instances.filter((i) => i.loader !== 'vanilla')
  const fitting = preview ? moddable.filter((i) => i.mcVersion === preview.mcVersion && i.loader === preview.loader) : []
  useEffect(() => {
    if (preview?.kind !== 'mod') return
    const pick = fitting.find((i) => i.id === selectedInstance?.id) ?? fitting[0] ?? moddable.find((i) => i.id === selectedInstance?.id) ?? moddable[0]
    setTarget(pick?.id)
  }, [preview])

  const install = async (): Promise<void> => {
    if (!preview) return
    setBusy(true)
    const res = await run(() => (file ? api.share.importFile(file) : api.share.importCode(code, preview.kind === 'mod' ? target : undefined)))
    setBusy(false)
    if (!res) return
    if (res.failed.length) toast('error', 'Не всё скачалось', `Не получилось: ${res.failed.join(', ')}`)
    else toast('success', preview.kind === 'mod' ? 'Мод установлен' : 'Сборка готова', res.instance.name)
    onClose()
    if (preview.kind === 'mod') navigate('mods')
  }

  return (
    <Modal title="Добавить по коду" onClose={onClose} width={620}>
      {!file && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Вставь код сборки или мода, который прислал друг (начинается с BB1-).
          </p>
          <textarea className="input share-code" autoFocus rows={4} placeholder="BB1-…" value={code} onChange={(e) => setCode(e.target.value)} />
        </>
      )}
      {error && <p className="share-warn">{error}</p>}
      {preview && (
        <div className="card share-preview">
          <div className="row">
            <Icon name={preview.kind === 'mod' ? 'puzzle' : 'cube'} size={22} />
            <div style={{ minWidth: 0 }}>
              <h3 className="ellipsis" style={{ margin: 0 }}>
                {preview.name}
              </h3>
              <div className="muted" style={{ fontSize: 12 }}>
                {preview.kind === 'mod' ? 'Мод' : 'Сборка'}
                {` · Minecraft ${preview.mcVersion} · ${LOADER_LABELS[preview.loader]}${preview.loaderVersion ? ` ${preview.loaderVersion}` : ''}`}
                {preview.kind === 'pack' ? ` · модов: ${preview.mods}` : ''}
                {preview.hasFiles ? ' · с конфигами' : ''}
              </div>
            </div>
          </div>
          {preview.missing.length > 0 && (
            <p className="share-warn" style={{ marginBottom: 0 }}>
              {`Не придут (их нет на Modrinth): ${preview.missing.join(', ')}. Попроси у друга файл сборки или эти .jar.`}
            </p>
          )}
          {preview.kind === 'mod' && (
            <label className="row" style={{ marginTop: 10 }}>
              <span className="muted">В сборку:</span>
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                {moddable.map((i) => (
                  <option key={i.id} value={i.id}>
                    {`${i.name} (${i.mcVersion} ${LOADER_LABELS[i.loader]})${fitting.includes(i) ? '' : ' — подберу другую версию мода'}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        <Button
          variant="ghost"
          icon="folder"
          onClick={async () => {
            const picked = await run(() => api.share.openFile())
            if (!picked) return
            setFile(picked.path)
            setError(undefined)
            setPreview(picked.preview)
          }}
        >
          Открыть файл .bbpack
        </Button>
        <Button
          variant="primary"
          icon="download"
          loading={busy}
          disabled={!preview || (preview.kind === 'mod' && !target)}
          onClick={() => void install()}
        >
          {preview?.kind === 'mod' ? 'Установить мод' : 'Создать сборку'}
        </Button>
      </div>
    </Modal>
  )
}

const LAST_SERVER = 'bb.lastServer'

/** "Проверить сервер": version + mods compared before joining. */
export function ServerModal({ instance, onClose }: { instance: Instance; onClose(): void }) {
  const { run } = useApp()
  const [address, setAddress] = useState(() => {
    try {
      return localStorage.getItem(LAST_SERVER) ?? ''
    } catch {
      return ''
    }
  })
  const [status, setStatus] = useState<ServerStatus>()
  const [busy, setBusy] = useState(false)

  const check = async (): Promise<void> => {
    try {
      localStorage.setItem(LAST_SERVER, address.trim())
    } catch {
      /* not important */
    }
    setBusy(true)
    setStatus(undefined)
    const res = await run(() => api.server.check(instance.id, address))
    setBusy(false)
    if (!res) return
    // A mismatch opens the Doctor with the fix buttons — step aside for it.
    if (res.online && !res.ok) return onClose()
    setStatus(res)
  }

  const loaderText = status?.loader === 'forge' ? 'Forge' : status?.loader === 'neoforge' ? 'NeoForge' : status?.loader === 'vanilla' ? 'без модов (или Fabric)' : ''

  return (
    <Modal title={`Проверить сервер для «${instance.name}»`} onClose={onClose} width={560}>
      <p className="muted" style={{ marginTop: 0 }}>
        Лаунчер спросит у сервера версию и моды и сравнит со сборкой ещё до входа в игру.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void check()
        }}
      >
        <input className="input" autoFocus placeholder="play.example.com или 1.2.3.4:25565" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Button variant="primary" type="submit" icon="globe" loading={busy} disabled={!address.trim()}>
          Проверить
        </Button>
      </form>
      {status && (
        <div className="card share-preview">
          {!status.online ? (
            <p className="share-warn" style={{ margin: 0 }}>
              {`Сервер не отвечает: ${status.error}`}
            </p>
          ) : (
            <>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className={`chip ${status.ok ? 'green' : 'red'}`}>
                  <span className="dot" />
                  {status.ok ? 'Сборка подходит' : 'Сборка не подходит'}
                </span>
                {status.version && <span className="chip">{status.version}</span>}
                {loaderText && <span className="chip blue">{loaderText}</span>}
                {status.players && (
                  <span className="chip">
                    {`Игроки: ${status.players.online}/${status.players.max}`}
                  </span>
                )}
              </div>
              {status.motd && <p className="dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{status.motd}</p>}
              {status.mods && (
                <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                  {`Модов на сервере: ${status.mods.length}. `}
                  {status.missing.length ? `Не хватает: ${status.missing.join(', ')} — Доктор предложит поставить.` : 'Все есть в сборке.'}
                </p>
              )}
              {!status.mods && status.loader !== 'vanilla' && (
                <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                  Этот сервер не показывает список модов заранее (так делают NeoForge и Fabric). Если при входе не пустит, Доктор крашей скажет, каких
                  модов не хватает. Проще всего попросить у админа код сборки.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
