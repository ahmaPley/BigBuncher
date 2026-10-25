import '@fontsource-variable/inter'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppStateProvider } from './lib/appState'
import { applyLanguage, getLanguage } from './lib/i18nDom'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'

// language remembered from the last run, so the first paint is already in the right language
applyLanguage(getLanguage())

createRoot(document.getElementById('root')!).render(
  <AppStateProvider>
    <App />
  </AppStateProvider>
)
