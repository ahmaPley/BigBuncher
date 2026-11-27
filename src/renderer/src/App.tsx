import { useEffect, type ComponentType } from 'react'
import { applyAccent } from './lib/theme'
import { MINECRAFT_LAUNCHER_ID } from '../../shared/types'
import { useWindowIcon } from './components/Launchers'
import { PluginHost } from './components/PluginHost'
import { DownloadPrompt } from './components/DownloadPrompt'
import { AccountsModal } from './components/AccountsModal'
import { BisectBanner, DoctorModal, GraphicsModal } from './components/Doctor'
import { DevPage } from './pages/DevPage'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { useApp, type PageId } from './lib/appState'
import { HomePage } from './pages/HomePage'
import { InstallPage } from './pages/InstallPage'
import { InstancesPage } from './pages/InstancesPage'
import { ModsPage } from './pages/ModsPage'
import { ResourcePacksPage } from './pages/ResourcePacksPage'
import { SettingsPage } from './pages/SettingsPage'
import { AddonsPage } from './pages/AddonsPage'
import { SkinsPage } from './pages/SkinsPage'

/** Page registry: add a page here and a nav item in components/Sidebar.tsx. */
const PAGES: Record<PageId, ComponentType> = {
  home: HomePage,
  install: InstallPage,
  instances: InstancesPage,
  mods: ModsPage,
  packs: ResourcePacksPage,
  skins: SkinsPage,
  dev: DevPage,
  settings: SettingsPage,
  addons: AddonsPage
}

export function App() {
  const { page, accountsOpen, settings, activeLauncher } = useApp()
  const Page = PAGES[page]
  useWindowIcon()
  const accent = settings?.launcherAccents[MINECRAFT_LAUNCHER_ID]
  useEffect(() => applyAccent(activeLauncher.id === MINECRAFT_LAUNCHER_ID ? accent : undefined), [accent, activeLauncher.id])

  if (settings && activeLauncher.id !== MINECRAFT_LAUNCHER_ID) {
    return (
      <div className="app plugin-mode">
        <PluginHost key={activeLauncher.id} launcher={activeLauncher} />
        <Toasts />
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TitleBar />
        {settings ? <Page key={page} /> : <div className="page" />}
      </main>
      {accountsOpen && <AccountsModal />}
      <DownloadPrompt />
      <DoctorModal />
      <GraphicsModal />
      <BisectBanner />
      <Toasts />
    </div>
  )
}
