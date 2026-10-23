import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyAt, getPixel, line, SIZE, STROKE_TOOLS, type PaintSettings, type RGBA, type ToolId } from './paintTools'
import { mirrorPixel, pixelInfo, type Visibility } from './skinLayout'

export interface SkinDocument {
  /** The 64x64 source-of-truth canvas. */
  canvas: HTMLCanvasElement
  /** Increments on every change — views re-render from `canvas` when it changes. */
  revision: number
  beginStroke(x: number, y: number): void
  /** connect=false skips line interpolation (3D view: screen-adjacent points can be far apart on the texture). */
  continueStroke(x: number, y: number, connect?: boolean): void
  endStroke(): void
  pick(x: number, y: number): RGBA | undefined
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
  clear(): void
  loadImage(src: string): Promise<void>
  toDataUrl(): string
}

interface Options {
  tool: ToolId
  settings: PaintSettings
  slim: boolean
  symmetry: boolean
  visibility: Visibility
}

const HISTORY_LIMIT = 150

/** Holds the skin pixels, undo history and applies tools with layer locks + symmetry. */
export function useSkinDocument(initial: string, opts: Options): SkinDocument {
  const canvas = useMemo(() => Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE }), [])
  const ctx2d = useMemo(() => canvas.getContext('2d', { willReadFrequently: true })!, [canvas])
  const [revision, setRevision] = useState(0)
  const history = useRef<ImageData[]>([])
  const future = useRef<ImageData[]>([])
  const stroke = useRef<{ img: ImageData; last?: [number, number] } | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const bump = useCallback(() => setRevision((r) => r + 1), [])

  const loadImage = useCallback(
    (src: string) =>
      new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          ctx2d.clearRect(0, 0, SIZE, SIZE)
          ctx2d.drawImage(img, 0, 0, SIZE, img.height === 32 ? 32 : SIZE)
          if (img.height === 32) {
            // Legacy 64x32 skin: the left limbs reuse the right ones.
            ctx2d.drawImage(canvas, 0, 16, 16, 16, 16, 48, 16, 16)
            ctx2d.drawImage(canvas, 40, 16, 16, 16, 32, 48, 16, 16)
          }
          bump()
          resolve()
        }
        img.onerror = () => reject(new Error('Не удалось открыть изображение'))
        img.src = src
      }),
    [canvas, ctx2d, bump]
  )

  useEffect(() => {
    history.current = []
    future.current = []
    void loadImage(initial)
  }, [initial, loadImage])

  const paintContext = (img: ImageData) => {
    const { slim, symmetry, visibility } = optsRef.current
    return {
      img,
      canPaint: (x: number, y: number) => {
        const info = pixelInfo(x, y, slim)
        return Boolean(info && visibility[info.part][info.layer])
      },
      mirrors: (x: number, y: number): [number, number][] => {
        if (!symmetry) return []
        const m = mirrorPixel(x, y, slim)
        return m && (m[0] !== x || m[1] !== y) ? [m] : []
      },
      regionOf: (x: number, y: number) => {
        const info = pixelInfo(x, y, slim)
        return info && `${info.part}:${info.layer}`
      }
    }
  }

  const pushHistory = (): void => {
    history.current.push(ctx2d.getImageData(0, 0, SIZE, SIZE))
    if (history.current.length > HISTORY_LIMIT) history.current.shift()
    future.current = []
  }

  const commit = (img: ImageData): void => {
    ctx2d.putImageData(img, 0, 0)
    bump()
  }

  const beginStroke = (x: number, y: number): void => {
    const { tool, settings } = optsRef.current
    if (tool === 'picker' || tool === 'move') return
    pushHistory()
    const img = ctx2d.getImageData(0, 0, SIZE, SIZE)
    applyAt(tool, x, y, paintContext(img), settings)
    commit(img)
    stroke.current = STROKE_TOOLS.includes(tool) ? { img, last: [x, y] } : null
  }

  const continueStroke = (x: number, y: number, connect = true): void => {
    const s = stroke.current
    if (!s) return
    const { tool, settings } = optsRef.current
    const ctx = paintContext(s.img)
    const pts = s.last && connect ? line(s.last[0], s.last[1], x, y).slice(1) : [[x, y] as [number, number]]
    for (const [px, py] of pts) applyAt(tool, px, py, ctx, settings)
    s.last = [x, y]
    commit(s.img)
  }

  const endStroke = (): void => {
    stroke.current = null
  }

  const swap = (from: ImageData[], to: ImageData[]): void => {
    const snapshot = from.pop()
    if (!snapshot) return
    to.push(ctx2d.getImageData(0, 0, SIZE, SIZE))
    commit(snapshot)
  }

  return {
    canvas,
    revision,
    beginStroke,
    continueStroke,
    endStroke,
    pick: (x, y) => {
      const c = getPixel(ctx2d.getImageData(0, 0, SIZE, SIZE), x, y)
      return c[3] > 0 ? c : undefined
    },
    undo: () => swap(history.current, future.current),
    redo: () => swap(future.current, history.current),
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
    clear: () => {
      pushHistory()
      const img = ctx2d.getImageData(0, 0, SIZE, SIZE)
      const pc = paintContext(img)
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (pc.canPaint(x, y)) img.data.fill(0, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)
      commit(img)
    },
    loadImage: async (src) => {
      pushHistory()
      await loadImage(src)
    },
    toDataUrl: () => canvas.toDataURL('image/png')
  }
}
