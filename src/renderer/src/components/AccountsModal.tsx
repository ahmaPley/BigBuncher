import { useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon, MicrosoftLogo } from './Icon'
import { SkinHead } from './SkinHead'
import { Button, Modal } from './ui'

export function AccountsModal() {
  const { accounts, selectedAccount, skinOf, setAccountsOpen, run } = useApp()
  const [nick, setNick] = useState('')
  const [busy, setBusy] = useState<'ms' | 'offline' | null>(null)

  const addOffline = async (): Promise<void> => {
    setBusy('offline')
    const added = await run(() => api.accounts.addOffline(nick), 'Офлайн-аккаунт добавлен')
    if (added) setNick('')
    setBusy(null)
  }

  const loginMs = async (): Promise<void> => {
    setBusy('ms')
    await run(() => api.accounts.loginMicrosoft(), 'Вход через Microsoft выполнен')
    setBusy(null)
  }

  return (
    <Modal title="Аккаунты" onClose={() => setAccountsOpen(false)}>
      <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {accounts.length === 0 && <div className="muted">Пока нет аккаунтов. Добавьте ник или войдите через Microsoft.</div>}
        {accounts.map((acc) => {
          const active = acc.uuid === selectedAccount?.uuid
          return (
            <div
              key={acc.uuid}
              className="account-card"
              style={{ marginTop: 0, borderColor: active ? 'rgba(111,214,92,.45)' : undefined }}
              onClick={() => void run(() => api.accounts.select(acc.uuid))}
            >
              <SkinHead skin={skinOf(acc).dataUrl} />
              <div style={{ minWidth: 0 }}>
                <div className="name">{acc.name}</div>
                <div className="type">{acc.type === 'microsoft' ? 'Microsoft · лицензия' : 'Офлайн-режим'}</div>
              </div>
              <span className="spacer" />
              {active && <span className="chip green"><span className="dot" />Активен</span>}
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                iconOnly
                title="Удалить"
                onClick={(e) => {
                  e.stopPropagation()
                  void run(() => api.accounts.remove(acc.uuid))
                }}
              />
            </div>
          )
        })}
      </div>

      <Button style={{ width: '100%', height: 46 }} onClick={loginMs} loading={busy === 'ms'}>
        <MicrosoftLogo /> Войти через Microsoft
      </Button>

      <div className="row" style={{ margin: '18px 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
        ИЛИ ОФЛАЙН
        <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void addOffline()
        }}
      >
        <div className="input-with-icon" style={{ flex: 1 }}>
          <Icon name="user" />
          <input className="input" placeholder="Ник (3–16 символов)" value={nick} maxLength={16} onChange={(e) => setNick(e.target.value)} />
        </div>
        <Button variant="primary" type="submit" disabled={nick.trim().length < 3} loading={busy === 'offline'}>
          Добавить
        </Button>
      </form>
      <p className="dim" style={{ fontSize: 12, marginBottom: 0 }}>
        Скин офлайн-аккаунта применяется в игре через встроенный сервер скинов BigBuncher.
      </p>
    </Modal>
  )
}
