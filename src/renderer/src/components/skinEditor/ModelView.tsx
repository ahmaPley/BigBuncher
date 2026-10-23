import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { IdleAnimation, SkinViewer, WalkingAnimation, type PlayerObject } from 'skinview3d'
import { MOUSE, Raycaster, Vector2, type Material, type Mesh, type Object3D } from 'three'
import { SIZE } from './paintTools'
import { PARTS, type Visibility } from './skinLayout'
import type { SkinDocument } from './useSkinDocument'

interface Props {
  doc: SkinDocument
  slim: boolean
  width: number
  height: number
  zoom: number
  walking: boolean
  /** "move" tool: the left button rotates the camera instead of painting. */
  orbitOnLeft: boolean
  picking: boolean
  wheelZoom: boolean
  visibility: Visibility
  overlayTransparent: boolean
  overlayScale: { head: number; other: number }
  background: string
  onPick(x: number, y: number): void
}

export interface ModelViewHandle {
  snapshot(): string
}

const isShown = (o: Object3D | null, root: Object3D): boolean => {
  for (let cur = o; cur && cur !== root; cur = cur.parent) if (!cur.visible) return false
  return true
}

/** 3D editor: paint directly on the player model. Right mouse rotates, wheel zooms. */
export const ModelView = forwardRef<ModelViewHandle, Props>(function ModelView(p, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<SkinViewer | null>(null)
  const props = useRef(p)
  props.current = p

  useImperativeHandle(ref, () => ({ snapshot: () => viewer.current?.canvas.toDataURL('image/png') ?? '' }))

  useEffect(() => {
    const v = new SkinViewer({ canvas: canvas.current!, width: p.width, height: p.height, preserveDrawingBuffer: true })
    v.fov = 38
    v.globalLight.intensity = 3
    v.cameraLight.intensity = 0.5
    v.controls.enablePan = true
    viewer.current = v
    return () => {
      v.dispose()
      viewer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const v = viewer.current

  useEffect(() => viewer.current?.setSize(p.width, p.height), [p.width, p.height])
  useEffect(() => {
    if (viewer.current) viewer.current.zoom = p.zoom
  }, [p.zoom])
  useEffect(() => {
    if (!viewer.current) return
    viewer.current.renderer.setClearColor(p.background)
    viewer.current.background = p.background
  }, [p.background])

  useEffect(() => {
    if (!viewer.current) return
    viewer.current.animation = p.walking ? Object.assign(new WalkingAnimation(), { speed: 0.6 }) : new IdleAnimation()
  }, [p.walking])

  useEffect(() => {
    const c = viewer.current?.controls
    if (!c) return
    c.enableZoom = p.wheelZoom
    c.mouseButtons = { LEFT: p.orbitOnLeft ? MOUSE.ROTATE : (-1 as MOUSE), MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
  }, [p.orbitOnLeft, p.wheelZoom])

  // Texture: re-upload the 64x64 document whenever it changes.
  useEffect(() => {
    viewer.current?.loadSkin(p.doc.canvas, { model: p.slim ? 'slim' : 'default' })
  }, [p.doc.revision, p.doc.canvas, p.slim, v])

  // Layer visibility, overlay scale and transparency.
  useEffect(() => {
    const skin = viewer.current?.playerObject.skin
    if (!skin) return
    for (const part of PARTS) {
      const bp = skin[part.id]
      bp.innerLayer.visible = p.visibility[part.id].inner
      bp.outerLayer.visible = p.visibility[part.id].outer
      bp.outerLayer.scale.setScalar(part.id === 'head' ? p.overlayScale.head : p.overlayScale.other)
      bp.outerLayer.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined
        if (m) {
          m.transparent = true
          m.opacity = p.overlayTransparent ? 0.45 : 1
          m.needsUpdate = true
        }
      })
    }
  }, [p.visibility, p.overlayScale, p.overlayTransparent, v])

  const hitPixel = (e: React.PointerEvent): [number, number] | undefined => {
    const vw = viewer.current
    if (!vw) return undefined
    const rect = canvas.current!.getBoundingClientRect()
    const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    const ray = new Raycaster()
    ray.setFromCamera(ndc, vw.camera)
    const player: PlayerObject = vw.playerObject
    const hit = ray.intersectObject(player.skin, true).find((h) => h.uv && isShown(h.object, player))
    if (!hit?.uv) return undefined
    const clamp = (n: number): number => Math.min(SIZE - 1, Math.max(0, n))
    return [clamp(Math.floor(hit.uv.x * SIZE)), clamp(Math.floor((1 - hit.uv.y) * SIZE))]
  }

  const painting = useRef(false)

  return (
    <canvas
      ref={canvas}
      className="model-view"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 || props.current.orbitOnLeft) return
        const px = hitPixel(e)
        if (!px) return
        if (props.current.picking) return props.current.onPick(...px)
        painting.current = true
        canvas.current!.setPointerCapture(e.pointerId)
        props.current.doc.beginStroke(...px)
      }}
      onPointerMove={(e) => {
        if (!painting.current) return
        const px = hitPixel(e)
        // No line interpolation in 3D: neighbouring screen points can be far apart on the texture.
        if (px) props.current.doc.continueStroke(px[0], px[1], false)
      }}
      onPointerUp={() => {
        painting.current = false
        props.current.doc.endStroke()
      }}
    />
  )
})
