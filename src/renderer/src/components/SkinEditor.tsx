import { useEffect, useRef, useState } from 'react'
import type { SkinModel } from '../../../shared/types'
import { Icon, type IconName } from './Icon'
import { ModelView, type ModelViewHandle } from './skinEditor/ModelView'
import { PartToggles } from './skinEditor/PartToggles'
import { DEFAULT_PALETTE, loadPalette, savePalette } from './skinEditor/palette'
import { hexToRgba, rgbaToHex, type FillMode, type ShadeMode, type ToolId } from './skinEditor/paintTools'
import { allVisible, type Visibility } from './skinEditor/skinLayout'
import { TextureView } from './skinEditor/TextureView'
import { useSkinDocument } from './skinEditor/useSkinDocument'
import { SkinViewer } from './SkinViewer'
import { Button, Segmented } from './ui'

type Mode = 'texture' | 'model'

const TOOLS: { id: ToolId; icon: IconName; title: string; key: string }[] = [
  { id: 'brush', icon: 'brush', title: 'Кисть (B)', key: 'b' },
  { id: 'picker', icon: 'pipette', title: 'Пипетка (I)', key: 'i' },
  { id: 'spray', icon: 'spray', title: 'Спрей (S)', key: 's' },
  { id: 'fill', icon: 'bucket', title: 'Заливка (G)', key: 'g' },
  { id: 'dither', icon: 'checker', title: 'Шахматная кисть — дизеринг (D)', key: 'd' },
  { id: 'replace', icon: 'circle', title: 'Замена цвета везде (R)', key: 'r' },
  { id: 'shade', icon: 'halfCircle', title: 'Затемнение / осветление (H)', key: 'h' },
  { id: 'eraser', icon: 'eraser', title: 'Ластик (E)', key: 'e' },
  { id: 'move', icon: 'move', title: 'Перемещение / поворот вида (M)', key: 'm' }
]

const SHADE_MODES: { value: ShadeMode; label: string }[] = [
  { value: 'darken', label: 'Затемнение' },
  { value: 'lighten', label: 'Осветление' },
  { value: 'invert', label: 'Инверсия' },
  { value: 'grayscale', label: 'Оттенки серого' }
]

interface Props {
  initial: string
  initialName: string
  initialModel: SkinModel
  onSave(result: { name: string; model: SkinModel; dataUrl: string }): Promise<void>
  onCancel(): void
}

/** Skin editor with two modes: flat texture and painting directly on the 3D body. */
export function SkinEditor({ initial, initialName, initialModel, onSave, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('model')
  const [tool, setTool] = useState<ToolId>('brush')
  const [palette, setPalette] = useState(loadPalette)
  const [colorIndex, setColorIndex] = useState(0)
  const [brushSize, setBrushSize] = useState(1)
  const [model, setModel] = useState<SkinModel>(initialModel)
  const [grid, setGrid] = useState(true)
  const [symmetry, setSymmetry] = useState(false)
  const [shadeMode, setShadeMode] = useState<ShadeMode>('darken')
  const [walking, setWalking] = useState(false)
  const [visibility, setVisibility] = useState<Visibility>(allVisible)
  const [texZoom, setTexZoom] = useState(5)
  const [modelZoom, setModelZoom] = useState(0.62)
  const [advanced, setAdvanced] = useState(false)
  const [dblClickEdit, setDblClickEdit] = useState(true)
  const [wheelZoom, setWheelZoom] = useState(true)
  const [overlayTransparent, setOverlayTransparent] = useState(false)
  const [sprayDensity, setSprayDensity] = useState(3)
  const [fillMode, setFillMode] = useState<FillMode>('contiguous')
  const [shadeStep, setShadeStep] = useState(3)
  const [background, setBackground] = useState('#1a222b')
  const [overlayScale, setOverlayScale] = useState({ head: 1, other: 1 })
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [viewport, setViewport] = useState({ w: 600, h: 520 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<ModelViewHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const colorInput = useRef<HTMLInputElement>(null)
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)

  const color = palette[colorIndex] ?? '#000000'
  const doc = useSkinDocument(initial, {
    tool,
    slim: model === 'slim',
    symmetry,
    visibility,
    settings: { color: hexToRgba(color), brushSize, sprayDensity, shadeStep, shadeMode, fillMode }
  })

  useEffect(() => savePalette(palette), [palette])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setViewport({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      // e.code = physical key, so shortcuts also work on the Russian layout (Ctrl+Я = Ctrl+Z).
      const k = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key
      if (e.ctrlKey && k === 'z') {
        e.preventDefault()
        return e.shiftKey ? doc.redo() : doc.undo()
      }
      if (e.ctrlKey && k === 'y') {
        e.preventDefault()
        return doc.redo()
      }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') return zoom(1)
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') return zoom(-1)
      const t = TOOLS.find((x) => x.key === k)
      if (t && !e.ctrlKey) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const zoom = (dir: 1 | -1): void => {
    if (mode === 'texture') setTexZoom((z) => Math.min(20, Math.max(2, z + dir)))
    else setModelZoom((z) => Math.min(3, Math.max(0.3, +(z + dir * 0.15).toFixed(2))))
  }

  const pick = (x: number, y: number): void => {
    const c = doc.pick(x, y)
    if (c) setPalette((p) => p.map((v, i) => (i === colorIndex ? rgbaToHex(c) : v)))
    setTool('brush')
  }

  const editSwatch = (i: number): void => {
    setColorIndex(i)
    setTimeout(() => colorInput.current?.click())
  }

  const download = (dataUrl: string, file: string): void => {
    const a = Object.assign(document.createElement('a'), { href: dataUrl, download: file })
    a.click()
  }

  const importImage = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => void doc.loadImage(String(reader.result))
    reader.readAsDataURL(file)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    await onSave({ name, model, dataUrl: doc.toDataUrl() })
    setSaving(false)
  }

  const exportPalette = (): void =>
    download(`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(palette))}`, 'palette.json')

  const importPalette = (file: File): void => {
    void file.text().then((t) => {
      const colors = JSON.parse(t)
      if (Array.isArray(colors) && colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))) setPalette(colors.slice(0, 32))
    })
  }

  const paletteFile = useRef<HTMLInputElement>(null)

  return (
    <div className="skin-editor">
      <div className="se-toolbar">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'model', label: <><Icon name="person" size={15} /> Тело</> },
            { value: 'texture', label: <><Icon name="grid" size={15} /> Текстура</> }
          ]}
        />
        <span className="se-sep" />
        {TOOLS.map((t) => (
          <button key={t.id} className={`se-tool ${tool === t.id ? 'active' : ''}`} title={t.title} onClick={() => setTool(t.id)}>
            <Icon name={t.icon} size={19} />
          </button>
        ))}
        <span className="se-sep" />
        <button className="se-tool" title="Отдалить (-)" onClick={() => zoom(-1)}>
          <Icon name="zoomOut" size={19} />
        </button>
        <button className="se-tool" title="Приблизить (+)" onClick={() => zoom(1)}>
          <Icon name="zoomIn" size={19} />
        </button>
        <button className={`se-tool ${walking ? 'active' : ''}`} title="Анимация ходьбы" onClick={() => setWalking(!walking)}>
          <Icon name="run" size={19} />
        </button>
        <span className="se-sep" />
        <button className="se-tool" title="Отменить (Ctrl+Z)" disabled={!doc.canUndo} onClick={doc.undo}>
          <Icon name="undo" size={19} />
        </button>
        <button className="se-tool" title="Повторить (Ctrl+Y)" disabled={!doc.canRedo} onClick={doc.redo}>
          <Icon name="redo" size={19} />
        </button>
      </div>

      <div className="se-palette">
        {palette.map((c, i) => (
          <button
            key={i}
            className={`se-swatch ${i === colorIndex ? 'active' : ''}`}
            style={{ background: c }}
            title={dblClickEdit ? 'Двойной клик — изменить цвет' : 'Правый клик — изменить цвет'}
            onClick={() => setColorIndex(i)}
            onDoubleClick={() => dblClickEdit && editSwatch(i)}
            onContextMenu={(e) => {
              e.preventDefault()
              editSwatch(i)
            }}
          />
        ))}
        <input
          ref={colorInput}
          type="color"
          className="se-hidden-color"
          value={color}
          onChange={(e) => setPalette((p) => p.map((v, i) => (i === colorIndex ? e.target.value : v)))}
        />
      </div>

      <div className="se-options">
        <label className="se-chip">
          Кисть:
          <select value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}px
              </option>
            ))}
          </select>
        </label>
        <button className="se-chip icon" title="Загрузить картинку скина" onClick={() => fileInput.current?.click()}>
          <Icon name="image" size={18} />
        </button>
        <button
          className="se-chip icon"
          title="Снимок (PNG)"
          onClick={() => download(mode === 'model' ? modelRef.current!.snapshot() : doc.toDataUrl(), `${name || 'skin'}${mode === 'model' ? '-render' : ''}.png`)}
        >
          <Icon name="camera" size={18} />
        </button>
        <button className="se-chip icon" title="Очистить видимые слои" onClick={doc.clear}>
          <Icon name="trash" size={18} />
        </button>
        <label className="se-chip">
          Модель:
          <select value={model} onChange={(e) => setModel(e.target.value as SkinModel)}>
            <option value="classic">Стив</option>
            <option value="slim">Алекс</option>
          </select>
        </label>
        <label className="se-chip">
          Сетка: <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
        </label>
        <label className="se-chip">
          Симметрия: <input type="checkbox" checked={symmetry} onChange={(e) => setSymmetry(e.target.checked)} />
        </label>
        <label className="se-chip">
          <Icon name="halfCircle" size={14} />
          <select value={shadeMode} onChange={(e) => setShadeMode(e.target.value as ShadeMode)}>
            {SHADE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button className="se-advanced-toggle" onClick={() => setAdvanced(!advanced)}>
        Расширенные настройки <Icon name="chevronDown" size={14} className={advanced ? 'flip' : ''} />
      </button>
      {advanced && (
        <div className="se-options advanced">
          <label className="se-chip">
            Двойной клик по цвету: <input type="checkbox" checked={dblClickEdit} onChange={(e) => setDblClickEdit(e.target.checked)} />
          </label>
          <label className="se-chip">
            Масштаб колёсиком: <input type="checkbox" checked={wheelZoom} onChange={(e) => setWheelZoom(e.target.checked)} />
          </label>
          <label className="se-chip">
            Прозрачный оверлей: <input type="checkbox" checked={overlayTransparent} onChange={(e) => setOverlayTransparent(e.target.checked)} />
          </label>
          <label className="se-chip">
            Шаг спрея: <input type="number" min={1} max={20} value={sprayDensity} onChange={(e) => setSprayDensity(Number(e.target.value) || 1)} />
          </label>
          <label className="se-chip">
            Фон: <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
          </label>
          <label className="se-chip">
            Тип заливки:
            <select value={fillMode} onChange={(e) => setFillMode(e.target.value as FillMode)}>
              <option value="contiguous">Смежная (внутри части)</option>
              <option value="global">Полная (весь цвет)</option>
            </select>
          </label>
          <label className="se-chip">
            Шаг затемнения и осветления:{' '}
            <input type="number" min={1} max={16} value={shadeStep} onChange={(e) => setShadeStep(Number(e.target.value) || 1)} />
          </label>
          <span className="se-chip">
            Палитра:
            <button onClick={() => setPalette((p) => (p.length > 1 ? p.slice(0, -1) : p))}>−</button>
            <b>{palette.length}</b>
            <button onClick={() => setPalette((p) => (p.length < 32 ? [...p, color] : p))}>+</button>
            <button className="link" onClick={() => paletteFile.current?.click()}>Импорт</button>
            <button className="link" onClick={exportPalette}>Экспорт</button>
            <button className="link" onClick={() => setPalette([...DEFAULT_PALETTE])}>Сбросить</button>
          </span>
          <span className="se-chip">
            Масштаб оверлея: голова
            <input
              type="number"
              step={0.05}
              min={0.8}
              max={1.5}
              value={overlayScale.head}
              onChange={(e) => setOverlayScale({ ...overlayScale, head: Number(e.target.value) || 1 })}
            />
            остальное
            <input
              type="number"
              step={0.05}
              min={0.8}
              max={1.5}
              value={overlayScale.other}
              onChange={(e) => setOverlayScale({ ...overlayScale, other: Number(e.target.value) || 1 })}
            />
          </span>
        </div>
      )}

      <div className="se-main">
        <div ref={viewportRef} className={`se-viewport ${mode}`} style={{ background }}>
          <div
            ref={scrollRef}
            className="se-scroll"
            onWheel={(e) => {
              if (!wheelZoom || mode !== 'texture') return
              zoom(e.deltaY < 0 ? 1 : -1)
            }}
            onPointerDown={(e) => {
              if (mode === 'texture' && tool === 'move') {
                const el = scrollRef.current!
                pan.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
              }
            }}
            onPointerMove={(e) => {
              if (!pan.current) return
              const el = scrollRef.current!
              el.scrollLeft = pan.current.sl - (e.clientX - pan.current.x)
              el.scrollTop = pan.current.st - (e.clientY - pan.current.y)
            }}
            onPointerUp={() => (pan.current = null)}
          >
          {mode === 'texture' ? (
            <div className="se-texture-wrap" style={{ pointerEvents: tool === 'move' ? 'none' : undefined }}>
              <TextureView
                doc={doc}
                zoom={texZoom}
                grid={grid}
                slim={model === 'slim'}
                visibility={visibility}
                overlayTransparent={overlayTransparent}
                background={background}
                picking={tool === 'picker'}
                onPick={pick}
              />
            </div>
          ) : (
            <ModelView
              ref={modelRef}
              doc={doc}
              slim={model === 'slim'}
              width={viewport.w}
              height={viewport.h}
              zoom={modelZoom}
              walking={walking}
              orbitOnLeft={tool === 'move'}
              picking={tool === 'picker'}
              wheelZoom={wheelZoom}
              visibility={visibility}
              overlayTransparent={overlayTransparent}
              overlayScale={overlayScale}
              background={background}
              onPick={pick}
            />
          )}
          </div>
          <PartToggles value={visibility} onChange={setVisibility} />
          <div className="se-hint">
            {mode === 'model' ? 'ЛКМ — рисовать · ПКМ — вращать · колесо — масштаб' : 'ЛКМ — рисовать · колесо — масштаб'}
          </div>
        </div>

        <div className="se-side">
          {mode === 'texture' && (
            <div className="skin-stage" style={{ height: 230 }}>
              <SkinViewer skin={doc.toDataUrl()} model={model} width={200} height={220} zoom={0.9} autoRotate animation="walk" />
            </div>
          )}
          <div className="field">
            <label>Название</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название скина" />
          </div>
          <div className="se-current-color" style={{ background: color }} onClick={() => editSwatch(colorIndex)} title="Текущий цвет" />
          <Button variant="primary" icon="check" loading={saving} onClick={() => void save()} style={{ height: 46 }}>
            Сохранить скин
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importImage(f)
          e.target.value = ''
        }}
      />
      <input
        ref={paletteFile}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importPalette(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
