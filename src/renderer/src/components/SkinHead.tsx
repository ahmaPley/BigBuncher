import { useEffect, useRef } from 'react'

/** Flat 2D face (with hat layer) cut out of a skin texture. */
export function SkinHead({ skin, size = 36 }: { skin?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, 8, 8)
    if (!skin) return
    const img = new Image()
    img.onload = () => {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8)
      if (img.height === 64 || img.height === 32) ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8)
    }
    img.src = skin
  }, [skin])

  return <canvas ref={ref} width={8} height={8} className="avatar" style={{ width: size, height: size }} />
}
