import { useEffect, useMemo, useRef, useState } from 'react'
import type { DevProfile, DevProjectInfo, ModJarInfo } from '../../../shared/types'
import { Icon } from '../components/Icon'
import { InstancePicker } from '../components/InstancePicker'
import { Button, EmptyState, Segmented, Toggle } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { formatDate } from '../lib/format'

type Level = 'all' | 'warn' | 'error'
const levelOf = (line: string, err?: boolean): 'error' | 'warn' | 'info' =>
  err || /\/ERROR\]|\bERROR\b|Exception|^\s+at |Caused by/.test(line) ? 'error' : /\/WARN\]|\bWARN\b/.test(line) ? 'warn' : 'info'

/** "Режим разработчика модов": build → deploy → launch with debugger, console with filters, mod inspector. */
export function DevPage() {
  const { selectedInstance: inst, run, game, logs, devLogs, clearDevLogs, launch } = useApp()
  const [profile, setProfile] = useState<DevProfile>()
  const [project, setProject] = useState<DevProjectInfo>()
  const [worlds, setWorlds] = useState<string[]>([])
  const [mods, setMods] = useState<ModJarInfo[]>()
  const [busy, setBusy] = useState<string>()
  const [extra, setExtra] = useState('')
  const [server, setServer] = useState('')

  useEffect(() => {
    if (!inst) return
    void api.dev.getProfile(inst.id).then((p) => {
      setProfile(p)
      setExtra(p.extraJvmArgs)
      setServer(p.quickPlayServer)
    })
    void api.dev.listWorlds(inst.id).then(setWorlds)
    setMods(undefined)
  }, [inst?.id])

  const refreshProject = (): void => {
    if (profile?.projectDir) api.dev.inspectProject(profile.projectDir).then(setProject, () => setProject(undefined))
    else setProject(undefined)
  }
  useEffect(refreshProject, [profile?.projectDir, devLogs.length > 0 && devLogs[devLogs.length - 1].source === 'deploy'])

  if (!inst) {
    return (
      <div className="page">
        <div className="titlebar-spacer" />
        <EmptyState icon="crafting" title="Нет сборки">Создай сборку с загрузчиком модов, чтобы тестировать в ней свой мод.</EmptyState>
      </div>
    )
  }

  const save = async (patch: Partial<DevProfile>): Promise<void> => {
    const next = await run(() => api.dev.saveProfile(inst.id, patch))
    if (next) setProfile(next)
  }
  const act = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(name)
    await run(fn)
    setBusy(undefined)
  }
  const runningHere = game.running && game.instanceId === inst.id

  return (
    <div className="page dev-page">
      <div className="titlebar-spacer" />
      <div className="page-header">
        <div>
          <h1>Разработка модов</h1>
          <p>Собирай свой мод, закидывай в сборку и запускай с отладчиком — в один клик.</p>
        </div>
        <div style={{ width: 280 }}>
          <InstancePicker />
        </div>
      </div>

      <div className="dev-grid stagger">
        <div className="card">
          <div className="card-title">
            <Icon name="code" /> Проект мода
          </div>
          {profile?.projectDir ? (
            <>
              <div className="dev-project">
                <div className="ellipsis" title={profile.projectDir} style={{ fontWeight: 600 }}>
                  {project?.modName ?? profile.projectDir.split(/[\\/]/).pop()}
                </div>
                <div className="muted ellipsis" style={{ fontSize: 12 }}>
                  {project?.modId ? `${project.modId} · ${project.platform ?? '?'} · ` : ''}
                  {profile.projectDir}
                </div>
              </div>
              {project && project.jars.length > 0 && (
                <div className="dim" style={{ fontSize: 12, margin: '8px 0' }}>
                  Последний jar: <b>{project.jars[0].fileName}</b> · {formatDate(project.jars[0].modifiedAt)}{' '}
                  {new Date(project.jars[0].modifiedAt).toLocaleTimeString('ru-RU')}
                  {profile.deployedFile && <> · в сборке: {profile.deployedFile}</>}
                </div>
              )}
              {project?.platform && project.platform !== inst.loader && !(project.platform === 'fabric' && inst.loader === 'quilt') && (
                <div className="chip red" style={{ marginBottom: 8 }}>Мод под {project.platform}, а сборка на {inst.loader}</div>
              )}
            </>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>Выбери папку Gradle-проекта (где лежит build.gradle) — лаунчер будет собирать мод и сам класть jar в эту сборку.</p>
          )}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Button size="sm" icon="folder" onClick={() => void run(() => api.dev.pickProject(inst.id)).then((p) => p && setProfile(p))}>
              {profile?.projectDir ? 'Другая папка' : 'Выбрать проект'}
            </Button>
            {profile?.projectDir && (
              <>
                <Button size="sm" icon="hammer" loading={busy === 'build'} disabled={Boolean(busy)} onClick={() => void act('build', () => api.dev.build(inst.id))}>
                  Собрать
                </Button>
                <Button size="sm" icon="copy" disabled={Boolean(busy)} onClick={() => void act('deploy', () => api.dev.deploy(inst.id).then(setProfile))}>
                  В mods
                </Button>
                <Button size="sm" variant="primary" icon="play" loading={busy === 'all'} disabled={Boolean(busy)} onClick={() => void act('all', () => api.dev.buildAndRun(inst.id))}>
                  Собрать и запустить
                </Button>
                {busy === 'build' || busy === 'all' ? (
                  <Button size="sm" variant="danger" icon="stop" onClick={() => void api.dev.cancelBuild()}>
                    Стоп
                  </Button>
                ) : null}
              </>
            )}
          </div>
          <div className="setting-row">
            <div>
              <div className="label">Автокопирование</div>
              <div className="hint">Собрал в IDE — новый jar сам попадёт в mods</div>
            </div>
            <span className="spacer" />
            <Toggle on={Boolean(profile?.autoDeploy)} onChange={(v) => void save({ autoDeploy: v })} />
          </div>
          <div className="field">
            <label>Задача Gradle</label>
            <input className="input" value={profile?.buildTask ?? 'build'} onChange={(e) => profile && setProfile({ ...profile, buildTask: e.target.value })} onBlur={(e) => void save({ buildTask: e.target.value || 'build' })} />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="bug" /> Запуск для отладки
          </div>
          <div className="setting-row">
            <div>
              <div className="label">Отладчик (JDWP)</div>
              <div className="hint">IntelliJ: Run → Attach to Process / Remote JVM Debug, порт {profile?.debugPort}. Работает HotSwap.</div>
            </div>
            <span className="spacer" />
            <Toggle on={Boolean(profile?.debug)} onChange={(v) => void save({ debug: v })} />
          </div>
          {profile?.debug && (
            <div className="row" style={{ gap: 10, marginBottom: 6 }}>
              <input className="input" type="number" style={{ width: 110 }} value={profile.debugPort} onChange={(e) => setProfile({ ...profile, debugPort: Number(e.target.value) })} onBlur={() => void save({ debugPort: profile.debugPort })} />
              <span className="muted" style={{ fontSize: 13 }}>Ждать отладчик при старте</span>
              <Toggle on={profile.suspend} onChange={(v) => void save({ suspend: v })} />
            </div>
          )}
          <div className="setting-row">
            <div>
              <div className="label">Экспорт миксинов</div>
              <div className="hint">Код после применения миксинов → .mixin.out</div>
            </div>
            <span className="spacer" />
            <Toggle on={Boolean(profile?.mixinExport)} onChange={(v) => void save({ mixinExport: v })} />
          </div>
          <div className="setting-row">
            <div>
              <div className="label">Подробный лог миксинов</div>
              <div className="hint">mixin.debug.verbose + счётчик инъекций</div>
            </div>
            <span className="spacer" />
            <Toggle on={Boolean(profile?.mixinVerbose)} onChange={(v) => void save({ mixinVerbose: v })} />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Сразу в мир</label>
              <select className="input" value={profile?.quickPlayWorld ?? ''} onChange={(e) => void save({ quickPlayWorld: e.target.value })}>
                <option value="">— главное меню —</option>
                {worlds.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>или на сервер</label>
              <input className="input" placeholder="localhost:25565" value={server} disabled={Boolean(profile?.quickPlayWorld)} onChange={(e) => setServer(e.target.value)} onBlur={() => void save({ quickPlayServer: server })} />
            </div>
          </div>
          <div className="field">
            <label>Доп. аргументы JVM</label>
            <input className="input" placeholder="-Dfabric.log.level=debug" value={extra} onChange={(e) => setExtra(e.target.value)} onBlur={() => void save({ extraJvmArgs: extra })} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <Button size="sm" variant="primary" icon={runningHere ? 'refresh' : 'play'} onClick={() => void (runningHere ? run(() => api.dev.restart(inst.id)) : launch(inst.id))}>
              {runningHere ? 'Перезапустить' : 'Запустить'}
            </Button>
            {runningHere && (
              <Button size="sm" variant="danger" icon="stop" onClick={() => void run(() => api.game.stop())}>
                Убить процесс
              </Button>
            )}
            {(['mods', 'config', 'logs', 'crash-reports', 'mixin'] as const).map((f) => (
              <Button key={f} size="sm" variant="ghost" icon="folder" onClick={() => void run(() => api.dev.openFolder(inst.id, f))}>
                {f === 'mixin' ? '.mixin.out' : f}
              </Button>
            ))}
          </div>
        </div>

        <DevConsole modId={project?.modId} instanceId={inst.id} logs={logs.filter((l) => l.instanceId === inst.id)} devLogs={devLogs} onClearDev={clearDevLogs} />

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-title">
            <Icon name="puzzle" /> Инспектор модов сборки
            <span className="spacer" />
            <Button size="sm" icon="search" loading={busy === 'mods'} onClick={() => void act('mods', () => api.dev.inspectMods(inst.id).then(setMods))}>
              {mods ? 'Обновить' : 'Проверить моды'}
            </Button>
          </div>
          {!mods ? (
            <p className="muted" style={{ margin: 0 }}>Читает каждый jar: id, версия, загрузчик, зависимости — и находит дубли, моды не под тот загрузчик и недостающие зависимости до запуска игры.</p>
          ) : mods.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>В папке mods пусто.</p>
          ) : (
            <div className="mod-table">
              <div className="mod-row head">
                <span>Мод</span>
                <span>id</span>
                <span>Версия</span>
                <span>Загрузчик</span>
                <span>Зависимости</span>
              </div>
              {[...mods].sort((a, b) => b.issues.length - a.issues.length).map((m) => (
                <div key={m.fileName} className={`mod-row ${m.issues.length ? 'bad' : ''} ${m.enabled ? '' : 'off'}`}>
                  <span className="ellipsis" title={m.fileName}>
                    <b>{m.name}</b>
                    {!m.enabled && <span className="dim"> (выкл.)</span>}
                    {m.issues.map((i) => (
                      <div key={i} className="mod-issue">
                        <Icon name="alert" size={12} /> {i}
                      </div>
                    ))}
                  </span>
                  <span className="mono ellipsis">{m.ids.join(', ')}</span>
                  <span className="mono ellipsis">{m.version}</span>
                  <span>{m.platforms.join(', ') || '—'}</span>
                  <span className="mono ellipsis" title={m.dependencies.map((d) => `${d.id} ${d.range ?? ''}`).join('\n')}>
                    {m.dependencies.map((d) => d.id).filter((d) => !['minecraft', 'java', 'fabricloader', 'forge', 'neoforge'].includes(d)).join(', ') || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DevConsole({
  modId,
  instanceId,
  logs,
  devLogs,
  onClearDev
}: {
  modId?: string
  instanceId: string
  logs: { line: string; stream: 'out' | 'err' }[]
  devLogs: { line: string; level: 'info' | 'warn' | 'error'; source: string }[]
  onClearDev(): void
}) {
  const { run, toast } = useApp()
  const [tab, setTab] = useState<'game' | 'gradle'>('game')
  const [level, setLevel] = useState<Level>('all')
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(false)
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => {
    const src = tab === 'game' ? logs.map((l) => ({ line: l.line, level: levelOf(l.line, l.stream === 'err' && /Exception|Error/.test(l.line)) })) : devLogs
    const q = query.toLowerCase()
    return src.filter(
      (l) =>
        (level === 'all' || (level === 'warn' ? l.level !== 'info' : l.level === 'error')) &&
        (!q || l.line.toLowerCase().includes(q)) &&
        (!mine || !modId || l.line.toLowerCase().includes(modId.toLowerCase()))
    )
  }, [tab, logs, devLogs, level, query, mine, modId])

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, follow])

  const analyze = async (): Promise<void> => {
    const selected = window.getSelection()?.toString().trim()
    // nothing selected: take the last error block (exception line + its stack)
    let text = selected
    if (!text) {
      const all = logs.map((l) => l.line)
      const last = all.map((l, i) => (/Exception|Error|FAILED|Caused by/.test(l) ? i : -1)).filter((i) => i >= 0).pop()
      if (last === undefined) return toast('info', 'Ошибок в логе нет', 'Выдели текст ошибки мышкой и нажми ещё раз')
      let start = last
      while (start > 0 && /^\s+at |^\s*Caused by|^\s*\.\.\. \d+ more|Exception|Error/.test(all[start - 1]) && last - start < 80) start--
      text = all.slice(Math.max(0, start - 3), last + 40).join('\n')
    }
    await run(() => api.doctor.analyzeText(instanceId, text!))
  }

  return (
    <div className="card dev-console" style={{ gridColumn: '1 / -1' }}>
      <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Icon name="terminal" /> Консоль
        <Segmented value={tab} onChange={setTab} options={[{ value: 'game', label: 'Игра' }, { value: 'gradle', label: 'Gradle / деплой' }]} />
        <Segmented value={level} onChange={setLevel} options={[{ value: 'all', label: 'Всё' }, { value: 'warn', label: 'WARN+' }, { value: 'error', label: 'Ошибки' }]} />
        <span className="spacer" />
        <input className="input" style={{ width: 170, height: 32 }} placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {modId && (
          <label className="row muted" style={{ fontSize: 12, gap: 6 }}>
            Только {modId} <Toggle on={mine} onChange={setMine} />
          </label>
        )}
        <label className="row muted" style={{ fontSize: 12, gap: 6 }}>
          Следить <Toggle on={follow} onChange={setFollow} />
        </label>
        <Button size="sm" icon="stethoscope" onClick={() => void analyze()} title="Выдели ошибку мышкой (или ничего — возьму последнюю)">
          Разобрать ошибку
        </Button>
        <Button size="sm" variant="ghost" icon="copy" iconOnly title="Копировать" onClick={() => void navigator.clipboard.writeText(lines.map((l) => l.line).join('\n')).then(() => toast('success', 'Скопировано'))} />
        {tab === 'gradle' && <Button size="sm" variant="ghost" icon="trash" iconOnly title="Очистить" onClick={onClearDev} />}
      </div>
      <div className="log-view dev-log" ref={box}>
        {lines.length === 0 && <div className="dim">{tab === 'game' ? 'Запусти игру — лог появится здесь.' : 'Нажми «Собрать» — вывод Gradle появится здесь.'}</div>}
        {lines.slice(-1500).map((l, i) => (
          <div key={i} className={l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : ''}>
            {l.line}
          </div>
        ))}
      </div>
    </div>
  )
}
