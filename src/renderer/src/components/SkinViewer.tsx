import { useEffect, useRef, useState } from 'react'
import { IdleAnimation, SkinViewer as Viewer3D, WalkingAnimation } from 'skinview3d'
import type { SkinModel } from '../../../shared/types'

interface Props {
  skin?: string
  model: SkinModel
  width: number
  height: number
  animation?: 'idle' | 'walk'
  autoRotate?: boolean
  zoom?: number
  nameTag?: string
  className?: string
}

/** Interactive 3D player model (skinview3d / three.js). Drag to rotate. */
export function SkinViewer({ skin, model, width, height, animation = 'idle', autoRotate, zoom = 0.85, nameTag, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<Viewer3D>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const v = new Viewer3D({ canvas: canvas.current!, width, height, pixelRatio: 'match-device' })
    v.fov = 40
    v.controls.enablePan = false
    v.controls.enableZoom = false
    v.playerObject.rotation.y = -0.45
    v.globalLight.intensity = 3
    v.cameraLight.intensity = 0.6
    viewer.current = v
    return () => {
      v.dispose()
      viewer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => viewer.current?.setSize(width, height), [width, height])
  useEffect(() => {
    if (viewer.current) viewer.current.zoom = zoom
  }, [zoom])

  useEffect(() => {
    const v = viewer.current
    if (!v) return
    v.autoRotate = Boolean(autoRotate)
    v.autoRotateSpeed = 0.8
    const anim = animation === 'walk' ? new WalkingAnimation() : new IdleAnimation()
    anim.speed = animation === 'walk' ? 0.6 : 1
    v.animation = anim
  }, [animation, autoRotate])

  useEffect(() => {
    if (viewer.current) viewer.current.nameTag = nameTag ?? null
  }, [nameTag])

  useEffect(() => {
    const v = viewer.current
    if (!v || !skin) return
    setReady(false)
    void Promise.resolve(v.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' })).then(() => setReady(true))
  }, [skin, model])

  return (
    <canvas
      ref={canvas}
      className={className}
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.5s ease', cursor: 'grab' }}
    />
  )
}
