import { useEffect, useRef } from 'react'
import { SIZE } from './paintTools'
import { PARTS, partRects, type Visibility } from './skinLayout'
import type { SkinDocument } from './useSkinDocument'

interface Props {
  doc: SkinDocument
  zoom: number
  grid: boolean
  slim: boolean
  visibility: Visibility
  overlayTransparent: boolean
  background: string
  onPick(x: number, y: number): void
  picking: boolean
}

/** 2D editor: the flat 64x64 texture, scaled by `zoom`. Hidden layers are dimmed and locked. */
export function TextureView({ doc, zoom, grid, slim, visibility, overlayTransparent, background, onPick, picking }: Props) {
  const view = useRef<HTMLCanvasElement>(null)
  const px = zoom
  const size = SIZE * px

  useEffect(() => {
    const c = view.current
    if (!c) return
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, size, size)
    g.drawImage(doc.canvas, 0, 0, size, size)

    for (const part of PARTS) {
      if (overlayTransparent && visibility[part.id].outer) {
        for (const r of partRects(part.id, 'outer', slim)) {
          g.clearRect(r.x * px, r.y * px, r.w * px, r.h * px)
          g.globalAlpha = 0.45
          g.drawImage(doc.canvas, r.x, r.y, r.w, r.h, r.x * px, r.y * px, r.w * px, r.h * px)
          g.globalAlpha = 1
        }
      }
      for (const layer of ['inner', 'outer'] as const) {
        if (visibility[part.id][layer]) continue
        g.fillStyle = 'rgba(8,12,16,.72)'
        for (const r of partRects(part.id, layer, slim)) g.fillRect(r.x * px, r.y * px, r.w * px, r.h * px)
      }
    }

    if (grid && px >= 4) {
      g.strokeStyle = 'rgba(255,255,255,.07)'
      g.lineWidth = 1
      g.beginPath()
      for (let i = 0; i <= SIZE; i++) {
        g.moveTo(i * px + 0.5, 0)
        g.lineTo(i * px + 0.5, size)
        g.moveTo(0, i * px + 0.5)
        g.lineTo(size, i * px + 0.5)
      }
      g.stroke()
      g.strokeStyle = 'rgba(111,214,92,.5)'
      for (const part of PARTS)
        for (const layer of ['inner', 'outer'] as const)
          for (const r of partRects(part.id, layer, slim)) g.strokeRect(r.x * px + 0.5, r.y * px + 0.5, r.w * px - 1, r.h * px - 1)
    }
  }, [doc.revision, doc.canvas, size, px, grid, slim, visibility, overlayTransparent])

  const toPixel = (e: React.PointerEvent): [number, number] => {
    const rect = view.current!.getBoundingClientRect()
    return [Math.floor(((e.clientX - rect.left) / rect.width) * SIZE), Math.floor(((e.clientY - rect.top) / rect.height) * SIZE)]
  }

  return (
    <canvas
      ref={view}
      width={size}
      height={size}
      className="texture-view"
      style={{ width: size, height: size, background, cursor: picking ? 'copy' : 'crosshair' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const [x, y] = toPixel(e)
        if (picking) return onPick(x, y)
        view.current!.setPointerCapture(e.pointerId)
        doc.beginStroke(x, y)
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) doc.continueStroke(...toPixel(e))
      }}
      onPointerUp={() => doc.endStroke()}
      onPointerCancel={() => doc.endStroke()}
    />
  )
}
