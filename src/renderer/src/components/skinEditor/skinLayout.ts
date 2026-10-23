/**
 * Geometry of the 64x64 Minecraft skin texture: which pixel belongs to which body part,
 * face and layer, plus left/right mirroring used by the symmetry option.
 */
export type PartId = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg'
export type LayerId = 'inner' | 'outer'

export const PARTS: { id: PartId; label: string }[] = [
  { id: 'head', label: 'Голова' },
  { id: 'body', label: 'Туловище' },
  { id: 'rightArm', label: 'Правая рука' },
  { id: 'leftArm', label: 'Левая рука' },
  { id: 'rightLeg', label: 'Правая нога' },
  { id: 'leftLeg', label: 'Левая нога' }
]

interface Box {
  part: PartId
  layer: LayerId
  u: number
  v: number
  w: number
  h: number
  d: number
}

/** Texture boxes; arm width depends on the model (4px Steve, 3px Alex). */
export function boxes(slim: boolean): Box[] {
  const a = slim ? 3 : 4
  return [
    { part: 'head', layer: 'inner', u: 0, v: 0, w: 8, h: 8, d: 8 },
    { part: 'head', layer: 'outer', u: 32, v: 0, w: 8, h: 8, d: 8 },
    { part: 'body', layer: 'inner', u: 16, v: 16, w: 8, h: 12, d: 4 },
    { part: 'body', layer: 'outer', u: 16, v: 32, w: 8, h: 12, d: 4 },
    { part: 'rightArm', layer: 'inner', u: 40, v: 16, w: a, h: 12, d: 4 },
    { part: 'rightArm', layer: 'outer', u: 40, v: 32, w: a, h: 12, d: 4 },
    { part: 'leftArm', layer: 'inner', u: 32, v: 48, w: a, h: 12, d: 4 },
    { part: 'leftArm', layer: 'outer', u: 48, v: 48, w: a, h: 12, d: 4 },
    { part: 'rightLeg', layer: 'inner', u: 0, v: 16, w: 4, h: 12, d: 4 },
    { part: 'rightLeg', layer: 'outer', u: 0, v: 32, w: 4, h: 12, d: 4 },
    { part: 'leftLeg', layer: 'inner', u: 16, v: 48, w: 4, h: 12, d: 4 },
    { part: 'leftLeg', layer: 'outer', u: 0, v: 48, w: 4, h: 12, d: 4 }
  ]
}

type FaceId = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back'

interface Face {
  id: FaceId
  x: number
  y: number
  w: number
  h: number
}

function faces(b: Box): Face[] {
  const { u, v, w, h, d } = b
  return [
    { id: 'top', x: u + d, y: v, w, h: d },
    { id: 'bottom', x: u + d + w, y: v, w, h: d },
    { id: 'right', x: u, y: v + d, w: d, h },
    { id: 'front', x: u + d, y: v + d, w, h },
    { id: 'left', x: u + d + w, y: v + d, w: d, h },
    { id: 'back', x: u + 2 * d + w, y: v + d, w, h }
  ]
}

export interface PixelInfo {
  part: PartId
  layer: LayerId
}

/** Which part/layer a texture pixel belongs to (undefined for unused texture areas). */
export function pixelInfo(x: number, y: number, slim: boolean): PixelInfo | undefined {
  for (const b of boxes(slim)) {
    for (const f of faces(b)) {
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return { part: b.part, layer: b.layer }
    }
  }
  return undefined
}

const MIRROR_PART: Record<PartId, PartId> = {
  head: 'head',
  body: 'body',
  rightArm: 'leftArm',
  leftArm: 'rightArm',
  rightLeg: 'leftLeg',
  leftLeg: 'rightLeg'
}
const MIRROR_FACE: Record<FaceId, FaceId> = {
  top: 'top',
  bottom: 'bottom',
  front: 'front',
  back: 'back',
  right: 'left',
  left: 'right'
}

/** Pixel on the opposite side of the body (left<->right), for symmetric painting. */
export function mirrorPixel(x: number, y: number, slim: boolean): [number, number] | undefined {
  const all = boxes(slim)
  for (const b of all) {
    for (const f of faces(b)) {
      if (!(x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h)) continue
      const target = all.find((t) => t.part === MIRROR_PART[b.part] && t.layer === b.layer)!
      const tf = faces(target).find((t) => t.id === MIRROR_FACE[f.id])!
      const lx = x - f.x
      return [tf.x + tf.w - 1 - Math.min(lx, tf.w - 1), tf.y + (y - f.y)]
    }
  }
  return undefined
}

/** All texture rectangles of one part/layer (used to dim hidden layers in 2D mode). */
export function partRects(part: PartId, layer: LayerId, slim: boolean): Face[] {
  return boxes(slim)
    .filter((b) => b.part === part && b.layer === layer)
    .flatMap(faces)
}

export type Visibility = Record<PartId, Record<LayerId, boolean>>

export const allVisible = (): Visibility =>
  Object.fromEntries(PARTS.map((p) => [p.id, { inner: true, outer: true }])) as Visibility
