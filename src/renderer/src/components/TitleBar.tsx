import { MINECRAFT_LAUNCHER_ID } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'
import { LauncherSwitcher } from './Launchers'

export function TitleBar() {
  const { navigate, activeLauncher } = useApp()
  // Other launchers have their own settings inside their interface.
  const minecraft = activeLauncher.id === MINECRAFT_LAUNCHER_ID
  return (
    <div className="titlebar">
      <LauncherSwitcher />
      {minecraft && (
        <>
          <button title="Настройки" onClick={() => navigate('settings')}>
            <Icon name="settings" size={17} />
          </button>
          <span className="divider" />
        </>
      )}
      <button title="Свернуть" onClick={() => void api.window.minimize()}>
        <Icon name="minus" size={17} />
      </button>
      <button title="Развернуть" onClick={() => void api.window.toggleMaximize()}>
        <Icon name="square" size={14} />
      </button>
      <button className="close" title="Закрыть" onClick={() => void api.window.close()}>
        <Icon name="x" size={17} />
      </button>
    </div>
  )
}
