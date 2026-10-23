import { PARTS, type LayerId, type PartId, type Visibility } from './skinLayout'

/** Top-left overlay panel: show/hide (and lock) the base layer and the overlay of each body part. */
export function PartToggles({ value, onChange }: { value: Visibility; onChange(v: Visibility): void }) {
  const toggle = (part: PartId, layer: LayerId): void =>
    onChange({ ...value, [part]: { ...value[part], [layer]: !value[part][layer] } })

  const setAll = (layer: LayerId, on: boolean): void =>
    onChange(Object.fromEntries(PARTS.map((p) => [p.id, { ...value[p.id], [layer]: on }])) as Visibility)

  const allOn = (layer: LayerId): boolean => PARTS.every((p) => value[p.id][layer])

  return (
    <div className="part-toggles">
      <div className="part-row head-row">
        <span />
        <button title="Всё тело" onClick={() => setAll('inner', !allOn('inner'))}>Тело</button>
        <button title="Все оверлеи" onClick={() => setAll('outer', !allOn('outer'))}>Оверлей</button>
      </div>
      {PARTS.map((p) => (
        <div key={p.id} className="part-row">
          <span>{p.label}</span>
          <input type="checkbox" checked={value[p.id].inner} onChange={() => toggle(p.id, 'inner')} />
          <input type="checkbox" checked={value[p.id].outer} onChange={() => toggle(p.id, 'outer')} />
        </div>
      ))}
    </div>
  )
}
