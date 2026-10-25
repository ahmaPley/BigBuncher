import { useEffect, useState } from 'react'
import type { FixAction, FixResult, GraphicsInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'
import { Button, Modal, Progress } from './ui'

const CONFIDENCE = { high: 'Точно', medium: 'Скорее всего', low: 'Не уверен' } as const

/** "Доктор крашей": explains a crash / failed server join and fixes it on one click. */
export function DoctorModal() {
  const { diagnosis: d, setDiagnosis, setAccountsOpen, instances, launch, run } = useApp()
  // chosen fix per problem (index into problem.fixes, -1 = leave as is)
  const [choice, setChoice] = useState<number[]>([])
  const [busy, setBusy] = useState<'fix' | 'fixRun' | null>(null)
  const [result, setResult] = useState<FixResult>()
  const [openEvidence, setOpenEvidence] = useState<number>()

  useEffect(() => {
    setChoice(d?.problems.map((p) => (p.fixes.length ? 0 : -1)) ?? [])
    setResult(undefined)
  }, [d])

  if (!d) return null
  const close = (): void => setDiagnosis(undefined)
  const instance = instances.find((i) => i.id === d.instanceId)
  const actions: FixAction[] = d.problems.flatMap((p, i) => (choice[i] >= 0 && p.fixes[choice[i]] ? [p.fixes[choice[i]].action] : []))
  const serverSide = actions.filter((a) => a.kind !== 'openAccounts')
  const relaunchable = !actions.some((a) => a.kind === 'bisect' || a.kind === 'openUrl')

  const apply = async (relaunch: boolean): Promise<void> => {
    if (actions.some((a) => a.kind === 'openAccounts')) setAccountsOpen(true)
    setBusy(relaunch ? 'fixRun' : 'fix')
    const res = await run(() => api.doctor.applyFixes(d.id, serverSide, relaunch && relaunchable))
    setBusy(null)
    if (res) setResult(res)
  }

  return (
    <Modal title="Доктор крашей" onClose={close} width={720}>
      <div className="doctor">
        <div className={`doctor-head ${d.phase}`}>
          <div className="doctor-icon">
            <Icon name={d.phase === 'disconnect' ? 'globe' : d.phase === 'preflight' ? 'alert' : 'stethoscope'} size={26} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="doctor-headline">{d.headline}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {instance?.name ?? 'Сборка'} · {d.problems.length === 1 ? 'найдена 1 причина' : `найдено причин: ${d.problems.length}`}
            </div>
          </div>
        </div>

        <div className="doctor-problems">
          {d.problems.map((p, i) => (
            <div key={i} className="doctor-problem">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="doctor-title">{p.title}</div>
                  <div className="doctor-text">{p.explanation}</div>
                </div>
                <span className={`chip conf-${p.confidence}`}>{CONFIDENCE[p.confidence]}</span>
              </div>
              {p.evidence && (
                <div className="doctor-evidence">
                  <button className="link-btn" onClick={() => setOpenEvidence(openEvidence === i ? undefined : i)}>
                    <Icon name="terminal" size={13} /> {openEvidence === i ? 'Скрыть строку из лога' : 'Почему я так решил'}
                  </button>
                  {openEvidence === i && <pre>{p.evidence}</pre>}
                </div>
              )}
              {p.fixes.length > 0 && !result && (
                <div className="doctor-fixes">
                  {p.fixes.map((f, j) => (
                    <label key={j} className={`doctor-fix ${choice[i] === j ? 'active' : ''}`}>
                      <input type="radio" name={`fix-${i}`} checked={choice[i] === j} onChange={() => setChoice(choice.map((c, k) => (k === i ? j : c)))} />
                      <Icon name={fixIcon(f.action)} size={15} />
                      {f.label}
                      {j === 0 && <span className="doctor-rec">рекомендую</span>}
                    </label>
                  ))}
                  <label className={`doctor-fix ${choice[i] === -1 ? 'active' : ''}`}>
                    <input type="radio" name={`fix-${i}`} checked={choice[i] === -1} onChange={() => setChoice(choice.map((c, k) => (k === i ? -1 : c)))} />
                    <span className="dim">Ничего не делать</span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        {result && (
          <div className="doctor-result">
            {result.done.map((t, i) => (
              <div key={i} className="row ok">
                <Icon name="check" size={15} /> {t}
              </div>
            ))}
            {result.failed.map((t, i) => (
              <div key={i} className="row bad">
                <Icon name="alert" size={15} /> {t}
              </div>
            ))}
            {result.relaunched && <div className="muted">Игра запускается заново…</div>}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {result ? (
            <Button variant="primary" icon="check" onClick={close}>
              Готово
            </Button>
          ) : (
            <>
              {d.phase === 'preflight' && (
                <Button variant="ghost" onClick={() => (close(), void launch(d.instanceId, { skipPreflight: true }))}>
                  Запустить всё равно
                </Button>
              )}
              <Button variant="ghost" onClick={close}>
                Закрыть
              </Button>
              {actions.length > 0 && (
                <Button icon="wrench" loading={busy === 'fix'} disabled={busy !== null} onClick={() => void apply(false)}>
                  Только исправить
                </Button>
              )}
              {actions.length > 0 && relaunchable && (
                <Button variant="primary" icon="play" loading={busy === 'fixRun'} disabled={busy !== null} onClick={() => void apply(true)}>
                  Исправить и запустить
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function fixIcon(a: FixAction): Parameters<typeof Icon>[0]['name'] {
  switch (a.kind) {
    case 'installMod':
      return 'download'
    case 'disableMod':
      return 'x'
    case 'updateMod':
      return 'refresh'
    case 'setRam':
      return 'memory'
    case 'autoJava':
      return 'coffee'
    case 'setGraphics':
      return 'gpu'
    case 'trashFile':
      return 'trash'
    case 'openUrl':
      return 'external'
    case 'openAccounts':
      return 'user'
    case 'bisect':
      return 'search'
    case 'createInstance':
      return 'plus'
    default:
      return 'wrench'
  }
}

/** Progress of the automatic culprit search (bottom-right). */
export function BisectBanner() {
  const { bisect } = useApp()
  const [hidden, setHidden] = useState(false)
  useEffect(() => setHidden(false), [bisect?.running])
  if (!bisect || hidden) return null
  return (
    <div className={`bisect-banner ${bisect.error ? 'error' : bisect.running ? '' : 'done'}`}>
      <div className="row">
        <Icon name="search" />
        <b>Автопоиск сломанного мода</b>
        <span className="spacer" />
        {bisect.running ? (
          <Button size="sm" variant="ghost" onClick={() => void api.doctor.cancelBisect()}>
            Отменить
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon="x" iconOnly onClick={() => setHidden(true)} />
        )}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{bisect.detail}</div>
      {bisect.running && <Progress value={-1} />}
      {bisect.running && <div className="dim" style={{ fontSize: 11 }}>Игра будет сама запускаться и закрываться — ничего не трогай. Моды потом вернутся как были.</div>}
    </div>
  )
}

/** "Что тянет твой компьютер?" — asked once before the first launch of a Vulkan-capable version. */
export function GraphicsModal() {
  const { graphicsAsk, setGraphicsAsk, run, launch } = useApp()
  const [info, setInfo] = useState<GraphicsInfo>()
  useEffect(() => {
    if (graphicsAsk) api.graphics.detect().then(setInfo, () => undefined)
  }, [graphicsAsk])
  if (!graphicsAsk) return null

  const choose = async (api_: 'vulkan' | 'opengl' | 'auto'): Promise<void> => {
    const target = graphicsAsk
    setGraphicsAsk(undefined)
    await run(() => api.settings.update({ graphicsApi: api_ }))
    await launch(target.instanceId, { skipPreflight: target.skipPreflight })
  }

  return (
    <Modal title="Что тянет твой компьютер?" onClose={() => setGraphicsAsk(undefined)} width={640}>
      <p className="muted" style={{ marginTop: 0 }}>
        Новые версии Minecraft умеют рисовать через <b>Vulkan</b> (быстрее) или <b>OpenGL</b> (работает почти везде). Если видеокарта не тянет Vulkan,
        игра вылетает или показывает чёрный экран. Выбор запомнится — поменять можно в Настройках.
      </p>
      <div className="gfx-choices">
        <button className="gfx-choice" onClick={() => void choose('vulkan')}>
          <Icon name="zap" size={28} />
          <b>Vulkan</b>
          <span>Современные видеокарты (GTX 900+, RX 400+, новые Intel)</span>
        </button>
        <button className="gfx-choice" onClick={() => void choose('opengl')}>
          <Icon name="layers" size={28} />
          <b>OpenGL</b>
          <span>Старые или слабые видеокарты, ноутбуки, если Vulkan вылетает</span>
        </button>
        <button className="gfx-choice auto" onClick={() => void choose('auto')}>
          <Icon name="search" size={28} />
          <b>Не знаю — определи сам</b>
          <span>{info ? `${info.gpu}. ${info.reason}` : 'Проверяю видеокарту…'}</span>
        </button>
      </div>
    </Modal>
  )
}
