import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Account, BisectState, DevLogLine, Diagnosis, GameLogLine, GameState, Instance, LoaderId, MultiPack, Settings, SkinEntry, TaskState, UpdateInfo } from '../../../shared/types'
import { api } from './api'
import { errorText } from './format'
import { applyLanguage } from './i18nDom'

export type PageId = 'home' | 'install' | 'instances' | 'mods' | 'packs' | 'skins' | 'dev' | 'settings'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  title: string
  text?: string
}

interface AppState {
  page: PageId
  navigate(page: PageId, opts?: { loader?: LoaderId }): void
  /** Loader preselected when navigating from the "quick launch" tiles. */
  pendingLoader?: LoaderId
  consumePendingLoader(): LoaderId | undefined

  settings?: Settings
  accounts: Account[]
  instances: Instance[]
  multiPacks: MultiPack[]
  update?: UpdateInfo
  skins: SkinEntry[]
  defaultSkin?: string
  game: GameState
  tasks: TaskState[]
  logs: GameLogLine[]
  accountsOpen: boolean
  setAccountsOpen(open: boolean): void

  selectedAccount?: Account
  selectedInstance?: Instance
  skinOf(account?: Account): { dataUrl?: string; model: 'classic' | 'slim' }
  refreshSkins(): Promise<void>

  toast(kind: Toast['kind'], title: string, text?: string): void
  toasts: Toast[]
  dismissToast(id: number): void
  /** Runs an API call, showing a toast on failure. Returns undefined when it failed. */
  run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined>

  /** Starts the game; asks "Vulkan или OpenGL?" first when that was never answered. */
  launch(instanceId: string, opts?: { skipPreflight?: boolean }): Promise<void>
  graphicsAsk?: { instanceId: string; skipPreflight?: boolean }
  setGraphicsAsk(v?: { instanceId: string; skipPreflight?: boolean }): void
  /** Diagnosis shown in the Доктор крашей window. */
  diagnosis?: Diagnosis
  setDiagnosis(d?: Diagnosis): void
  bisect?: BisectState
  devLogs: DevLogLine[]
  clearDevLogs(): void
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageId>(() => (location.hash.slice(1).split('/')[0] as PageId) || 'home')
  const [pendingLoader, setPendingLoader] = useState<LoaderId>()
  const [settings, setSettings] = useState<Settings>()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [instances, setInstances] = useState<Instance[]>([])
  const [multiPacks, setMultiPacks] = useState<MultiPack[]>([])
  const [update, setUpdate] = useState<UpdateInfo>()
  const [skins, setSkins] = useState<SkinEntry[]>([])
  const [defaultSkin, setDefaultSkin] = useState<string>()
  const [game, setGame] = useState<GameState>({ running: false })
  const [tasks, setTasks] = useState<TaskState[]>([])
  const [logs, setLogs] = useState<GameLogLine[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [graphicsAsk, setGraphicsAsk] = useState<{ instanceId: string; skipPreflight?: boolean }>()
  const [diagnosis, setDiagnosis] = useState<Diagnosis>()
  const [bisect, setBisect] = useState<BisectState>()
  const [devLogs, setDevLogs] = useState<DevLogLine[]>([])
  const toastId = useRef(0)
  const settingsRef = useRef<Settings | undefined>(undefined)
  settingsRef.current = settings

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const toast = useCallback(
    (kind: Toast['kind'], title: string, text?: string) => {
      const id = ++toastId.current
      setToasts((t) => [...t.slice(-3), { id, kind, title, text }])
      setTimeout(() => dismissToast(id), kind === 'error' ? 9000 : 4500)
    },
    [dismissToast]
  )

  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await action()
        if (success) toast('success', success)
        return result
      } catch (err) {
        toast('error', 'Ошибка', errorText(err))
        return undefined
      }
    },
    [toast]
  )

  const refreshSkins = useCallback(async () => setSkins(await api.skins.list()), [])

  useEffect(() => {
    if (settings && applyLanguage(settings.language)) location.reload()
  }, [settings?.language])

  // Hook for the trailer recorder (src/main/devtools/trailer.ts) to drive the UI.
  useEffect(() => {
    ;(window as unknown as { __bb: unknown }).__bb = { navigate: setPage, setGraphicsAsk, setDiagnosis }
  }, [])

  const launch = useCallback(
    async (instanceId: string, opts?: { skipPreflight?: boolean }) => {
      try {
        if (settingsRef.current?.graphicsApi === 'ask' && (await api.graphics.hasChoice(instanceId))) {
          setGraphicsAsk({ instanceId, ...opts })
          return
        }
        await api.game.launch(instanceId, opts)
      } catch (err) {
        toast('error', 'Ошибка', errorText(err))
      }
    },
    [toast]
  )

  useEffect(() => {
    void Promise.all([api.settings.get(), api.accounts.list(), api.instances.list(), api.game.state(), api.tasks.list(), api.multipacks.list(), api.updates.info()]).then(
      ([s, a, i, g, t, mp, u]) => {
        setMultiPacks(mp)
        setUpdate(u)
        setSettings(s)
        setAccounts(a)
        setInstances(i)
        setGame(g)
        setTasks(t)
      }
    )
    void refreshSkins()
    api.skins.defaultSkin().then(setDefaultSkin, () => undefined)

    const offs = [
      api.on('settingsChanged', setSettings),
      api.on('accountsChanged', setAccounts),
      api.on('instancesChanged', setInstances),
      api.on('multiPacksChanged', setMultiPacks),
      api.on('update', setUpdate),
      api.on('game', setGame),
      api.on('gameLog', (line) => setLogs((l) => [...l.slice(-2000), line])),
      api.on('diagnosis', setDiagnosis),
      api.on('bisect', setBisect),
      api.on('devLog', (line) => setDevLogs((l) => [...l.slice(-1500), line])),
      api.on('task', (task) => {
        setTasks((list) => [...list.filter((t) => t.id !== task.id), task])
        if (task.status === 'error') toast('error', task.title, task.error)
        if (task.status !== 'running') setTimeout(() => setTasks((l) => l.filter((t) => t.id !== task.id)), 2500)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [refreshSkins, toast])

  const value = useMemo<AppState>(() => {
    const selectedAccount = accounts.find((a) => a.uuid === settings?.selectedAccountId) ?? accounts[0]
    const selectedInstance = instances.find((i) => i.id === settings?.selectedInstanceId) ?? instances[0]
    return {
      page,
      navigate(next, opts) {
        setPendingLoader(opts?.loader)
        setPage(next)
      },
      pendingLoader,
      consumePendingLoader() {
        const l = pendingLoader
        setPendingLoader(undefined)
        return l
      },
      settings,
      accounts,
      instances,
      multiPacks,
      update,
      skins,
      defaultSkin,
      game,
      tasks,
      logs,
      accountsOpen,
      setAccountsOpen,
      selectedAccount,
      selectedInstance,
      skinOf(account) {
        const skin = skins.find((s) => s.id === account?.skinId)
        return skin ? { dataUrl: skin.dataUrl, model: skin.model } : { dataUrl: defaultSkin, model: 'classic' }
      },
      refreshSkins,
      toast,
      toasts,
      dismissToast,
      run,
      launch,
      graphicsAsk,
      setGraphicsAsk,
      diagnosis,
      setDiagnosis,
      bisect,
      devLogs,
      clearDevLogs: () => setDevLogs([])
    }
  }, [page, pendingLoader, settings, accounts, instances, multiPacks, update, skins, defaultSkin, game, tasks, logs, accountsOpen, refreshSkins, toast, toasts, dismissToast, run, launch, graphicsAsk, diagnosis, bisect, devLogs])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppStateProvider')
  return ctx
}
