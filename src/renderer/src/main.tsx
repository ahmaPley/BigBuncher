import '@fontsource-variable/inter'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppStateProvider } from './lib/appState'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
