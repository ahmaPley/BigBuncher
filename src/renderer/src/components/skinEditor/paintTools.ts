/**
 * Pixel operations on the 64x64 skin ImageData. Pure functions: the editor decides
 * which pixels may be touched (visibility locks, symmetry) through `PaintContext`.
 */
export const SIZE = 64

export type ToolId = 'brush' | 'picker' | 'spray' | 'fill' | 'dither' | 'replace' | 'shade' | 'eraser' | 'move'

export type ShadeMode = 'darken' | 'lighten' | 'invert' | 'grayscale'
export type FillMode = 'contiguous' | 'global'

export type RGBA = [number, number, number, number]

export interface PaintSettings {
  color: RGBA
  brushSize: number
  sprayDensity: number
  shadeStep: number
  shadeMode: ShadeMode
  fillMode: FillMode
}

export interface PaintContext {
  img: ImageData
  /** False for pixels that must not change (hidden layers, unused texture area). */
  canPaint(x: number, y: number): boolean
  /** Extra pixels to apply the same change to (symmetry), may be empty. */
  mirrors(x: number, y: number): [number, number][]
  /** Region key (part + layer) — contiguous fill never leaves the region it started in. */
  regionOf(x: number, y: number): string | undefined
}

export const hexToRgba = (hex: string): RGBA => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255) as RGBA
export const rgbaToHex = ([r, g, b]: RGBA): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

const idx = (x: number, y: number): number => (y * SIZE + x) * 4

export function getPixel(img: ImageData, x: number, y: number): RGBA {
  const i = idx(x, y)
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

function setPixel(ctx: PaintContext, x: number, y: number, c: RGBA): void {
  for (const [px, py] of [[x, y] as [number, number], ...ctx.mirrors(x, y)]) {
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE || !ctx.canPaint(px, py)) continue
    ctx.img.data.set(c, idx(px, py))
  }
}

const sameColor = (a: RGBA, b: RGBA): boolean =>
  (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3])

/** Square footprint of the brush around (x, y). */
function footprint(x: number, y: number, size: number): [number, number][] {
  const out: [number, number][] = []
  const start = -Math.floor((size - 1) / 2)
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push([x + start + dx, y + start + dy])
  return out
}

function shade(c: RGBA, mode: ShadeMode, step: number): RGBA {
  if (c[3] === 0) return c
  const k = step * 8
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  switch (mode) {
    case 'darken':
      return [clamp(c[0] - k), clamp(c[1] - k), clamp(c[2] - k), c[3]]
    case 'lighten':
      return [clamp(c[0] + k), clamp(c[1] + k), clamp(c[2] + k), c[3]]
    case 'invert':
      return [255 - c[0], 255 - c[1], 255 - c[2], c[3]]
    case 'grayscale': {
      const g = clamp(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
      return [g, g, g, c[3]]
    }
  }
}

/** Applies a tool at one texture pixel. */
export function applyAt(tool: ToolId, x: number, y: number, ctx: PaintContext, s: PaintSettings): void {
  switch (tool) {
    case 'brush':
      return footprint(x, y, s.brushSize).forEach(([px, py]) => setPixel(ctx, px, py, s.color))
    case 'eraser':
      return footprint(x, y, s.brushSize).forEach(([px, py]) => setPixel(ctx, px, py, [0, 0, 0, 0]))
    case 'dither':
      return footprint(x, y, Math.max(2, s.brushSize)).forEach(([px, py]) => {
        if ((px + py) % 2 === 0) setPixel(ctx, px, py, s.color)
      })
    case 'spray': {
      const radius = Math.max(1, s.brushSize + 1)
      const drops = Math.max(1, s.sprayDensity)
      for (let i = 0; i < drops; i++) {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * radius
        setPixel(ctx, Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), s.color)
      }
      return
    }
    case 'shade':
      return footprint(x, y, s.brushSize).forEach(([px, py]) => {
        if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) return
        setPixel(ctx, px, py, shade(getPixel(ctx.img, px, py), s.shadeMode, s.shadeStep))
      })
    case 'fill':
      return fill(x, y, ctx, s)
    case 'replace': {
      const target = getPixel(ctx.img, x, y)
      for (let py = 0; py < SIZE; py++)
        for (let px = 0; px < SIZE; px++) if (sameColor(getPixel(ctx.img, px, py), target)) setPixel(ctx, px, py, s.color)
      return
    }
    default:
      return
  }
}

function fill(x: number, y: number, ctx: PaintContext, s: PaintSettings): void {
  const target = getPixel(ctx.img, x, y)
  if (sameColor(target, s.color)) return
  if (s.fillMode === 'global') {
    for (let py = 0; py < SIZE; py++)
      for (let px = 0; px < SIZE; px++) if (ctx.canPaint(px, py) && sameColor(getPixel(ctx.img, px, py), target)) setPixel(ctx, px, py, s.color)
    return
  }
  // Contiguous fill stays inside the clicked part's texture faces (no bleeding into neighbours).
  const region = ctx.regionOf(x, y)
  const seen = new Uint8Array(SIZE * SIZE)
  const stack: [number, number][] = [[x, y]]
  while (stack.length) {
    const [px, py] = stack.pop()!
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE || seen[py * SIZE + px]) continue
    seen[py * SIZE + px] = 1
    if (!ctx.canPaint(px, py) || ctx.regionOf(px, py) !== region || !sameColor(getPixel(ctx.img, px, py), target)) continue
    setPixel(ctx, px, py, s.color)
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
  }
}

/** Bresenham line between two points, so fast strokes leave no gaps. */
export function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    pts.push([x0, y0])
    if (x0 === x1 && y0 === y1) return pts
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

/** Tools that paint continuously while dragging (others act once per click). */
export const STROKE_TOOLS: ToolId[] = ['brush', 'eraser', 'spray', 'dither', 'shade']
