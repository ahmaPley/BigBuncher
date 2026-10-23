import { useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'

/** The big green button: install / play / stop depending on state. */
export function PlayButton() {
  const { selectedInstance, game, tasks, navigate, run, selectedAccount, setAccountsOpen } = useApp()
  const [starting, setStarting] = useState(false)

  const busyTask = tasks.find((t) => t.status === 'running' && selectedInstance && t.instanceId === selectedInstance.id)
  const runningThis = game.running && game.instanceId === selectedInstance?.id

  let label = 'Играть'
  let icon: 'play' | 'stop' | 'download' = 'play'
  let action = async (): Promise<void> => {
    if (!selectedAccount) {
      setAccountsOpen(true)
      return
    }
    setStarting(true)
    await run(() => api.game.launch(selectedInstance!.id))
    setStarting(false)
  }

  if (!selectedInstance) {
    label = 'Установить'
    icon = 'download'
    action = async () => navigate('install')
  } else if (runningThis) {
    label = 'Остановить'
    icon = 'stop'
    action = async () => void (await run(() => api.game.stop()))
  }

  const busy = starting || Boolean(busyTask)
  const progress = busyTask && busyTask.progress >= 0 ? busyTask.progress : undefined

  return (
    <button
      className={`play-button ${runningThis ? 'running' : ''} ${busy ? 'busy' : ''}`}
      onClick={() => void action()}
      disabled={busy || (game.running && !runningThis)}
    >
      {progress !== undefined && <span className="play-progress" style={{ width: `${progress * 100}%` }} />}
      {busy ? <span className="spinner" style={{ width: 22, height: 22 }} /> : <Icon name={icon} size={24} />}
      <span>{busy ? (progress !== undefined ? `${Math.round(progress * 100)}%` : 'Запуск…') : game.running && !runningThis ? 'Игра запущена' : label}</span>
    </button>
  )
}
