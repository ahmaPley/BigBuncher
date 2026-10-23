import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'

export function TitleBar() {
  const { navigate } = useApp()
  return (
    <div className="titlebar">
      <button title="Настройки" onClick={() => navigate('settings')}>
        <Icon name="settings" size={17} />
      </button>
      <span className="divider" />
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
