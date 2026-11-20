import { useEffect, useState } from 'react'
import { MINECRAFT_LAUNCHER_ID, type DownloadedFile } from '../../../shared/types'
import { api } from '../lib/api'
import { useApp } from '../lib/appState'
import { Icon } from './Icon'
import { Button } from './ui'

/**
 * A mod was downloaded in some browser (main/downloads/downloadWatcher.ts). Minecraft: offer to put the .jar into
 * the selected instance (or open a .bbpack). Other launchers get the file through their bridge and decide themselves.
 */
export function DownloadPrompt() {
  const { activeLauncher, selectedInstance, run, toast } = useApp()
  const [file, setFile] = useState<DownloadedFile>()
  const minecraft = activeLauncher.id === MINECRAFT_LAUNCHER_ID

  useEffect(
    () =>
      api.on('downloadedMod', (f) => {
        if (minecraft && (f.ext === '.jar' || f.ext === '.bbpack')) setFile(f)
      }),
    [minecraft]
  )

  if (!file || !minecraft) return null
  const close = (): void => setFile(undefined)
  const canInstall = file.ext === '.jar' && selectedInstance && selectedInstance.loader !== 'vanilla'

  const install = async (): Promise<void> => {
    if (file.ext === '.bbpack') {
      const res = await run(() => api.share.importFile(file.path))
      if (res) toast('success', `Сборка «${res.instance.name}» добавлена`)
    } else if (selectedInstance) {
      const ok = await run(() => api.mods.installDownloaded(selectedInstance.id, file.path, file.site, file.url))
      if (ok) toast('success', `Мод установлен в «${selectedInstance.name}»`, file.site ? `Взят с ${file.site}` : undefined)
    }
    close()
  }

  return (
    <div className="download-prompt">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="download" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="title">{file.ext === '.bbpack' ? 'Скачана сборка' : 'Скачан мод'}</div>
          <div className="ellipsis" data-no-i18n>
            {file.fileName}
          </div>
          {file.site && <div className="dim">Откуда: {file.site}</div>}
        </div>
        <Button variant="ghost" size="sm" icon="x" iconOnly onClick={close} />
      </div>
      {file.ext === '.jar' && !canInstall && <div className="dim" style={{ marginTop: 8 }}>Выбери сборку с модлоадером, чтобы поставить мод.</div>}
      <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" onClick={close}>
          Не надо
        </Button>
        <Button size="sm" variant="primary" icon="plus" disabled={file.ext === '.jar' && !canInstall} onClick={() => void install()}>
          {file.ext === '.bbpack' ? 'Добавить сборку' : `В «${selectedInstance?.name ?? '…'}»`}
        </Button>
      </div>
    </div>
  )
}
