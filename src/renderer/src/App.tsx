import type { ComponentType } from 'react'
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
  settings: SettingsPage
}

export function App() {
  const { page, accountsOpen, settings } = useApp()
  const Page = PAGES[page]

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TitleBar />
        {settings ? <Page key={page} /> : <div className="page" />}
      </main>
      {accountsOpen && <AccountsModal />}
      <DoctorModal />
      <GraphicsModal />
      <BisectBanner />
      <Toasts />
    </div>
  )
}
