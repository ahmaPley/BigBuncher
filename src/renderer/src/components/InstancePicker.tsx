import type { BlockIcon as BlockIconId, Instance } from '../../../shared/types'
import { api } from '../lib/api'
import { LOADER_LABELS } from '../lib/assets'
import { useApp } from '../lib/appState'
import { BlockIcon, Dropdown } from './ui'

/** One picker row: an ordinary instance, or a multi-pack represented by its active state. */
interface Entry {
  key: string
  title: string
  subtitle: string
  icon: BlockIconId
  instanceId: string
}

const describe = (i: Instance): string =>
  `${i.mcVersion}${i.loader === 'vanilla' ? '' : ` · ${LOADER_LABELS[i.loader]} ${i.loaderVersion ?? ''}`}`

export function InstancePicker({ up }: { up?: boolean }) {
  const { instances, multiPacks, selectedInstance, run } = useApp()

  const entries: Entry[] = [
    ...multiPacks.flatMap((p) => {
      const active = instances.find((i) => i.id === p.activeStateId)
      return active
        ? [{ key: p.id, title: p.name, subtitle: `${active.stateName ?? ''} · ${describe(active)}`, icon: p.icon, instanceId: active.id }]
        : []
    }),
    ...instances
      .filter((i) => !i.multiPackId)
      .map((i) => ({ key: i.id, title: i.name, subtitle: describe(i), icon: i.icon, instanceId: i.id }))
  ]

  const selected = entries.find((e) =>
    selectedInstance?.multiPackId ? e.key === selectedInstance.multiPackId : e.instanceId === selectedInstance?.id
  )

  const row = (e?: Entry) => (
    <>
      <BlockIcon icon={e?.icon ?? 'grass'} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }} className="ellipsis">
          {e?.title ?? 'Нет версий'}
        </div>
        <div className="muted ellipsis" style={{ fontSize: 12 }}>
          {e?.subtitle ?? 'Установите первую'}
        </div>
      </div>
    </>
  )

  return (
    <Dropdown
      up={up}
      items={entries}
      selected={selected}
      keyOf={(e) => e.key}
      renderTrigger={row}
      renderItem={row}
      onSelect={(e) => void run(() => api.instances.select(e.instanceId))}
      empty="Установленных версий нет"
    />
  )
}
