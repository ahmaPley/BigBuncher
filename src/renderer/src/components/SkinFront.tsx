import { useEffect, useRef } from 'react'
import type { SkinModel } from '../../../shared/types'

/** [srcX, srcY, w, h, dstX, dstY] — front faces of each body part, base layer then overlay. */
const PARTS = (slim: boolean): number[][] => {
  const arm = slim ? 3 : 4
  return [
    [8, 8, 8, 8, 4, 0],
    [20, 20, 8, 12, 4, 8],
    [44, 20, arm, 12, 4 - arm, 8],
    [36, 52, arm, 12, 12, 8],
    [4, 20, 4, 12, 4, 20],
    [20, 52, 4, 12, 8, 20],
    // overlay layer
    [40, 8, 8, 8, 4, 0],
    [20, 36, 8, 12, 4, 8],
    [44, 36, arm, 12, 4 - arm, 8],
    [52, 52, arm, 12, 12, 8],
    [4, 36, 4, 12, 4, 20],
    [4, 52, 4, 12, 8, 20]
  ]
}

/** Flat front view of a skin (cheap thumbnail for skin lists). */
export function SkinFront({ skin, model }: { skin: string; model: SkinModel }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, 16, 32)
      ctx.imageSmoothingEnabled = false
      const legacy = img.height === 32
      for (const [i, [sx, sy, w, h, dx, dy]] of PARTS(model === 'slim').entries()) {
        if (legacy && (sy >= 32 || i >= 7)) {
          // 64x32 skins: mirror the right arm/leg, no overlay except the hat
          continue
        }
        ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h)
      }
      if (legacy) {
        ctx.save()
        ctx.scale(-1, 1)
        ctx.drawImage(img, 44, 20, 4, 12, -16, 8, 4, 12)
        ctx.drawImage(img, 4, 20, 4, 12, -12, 20, 4, 12)
        ctx.restore()
      }
    }
    img.src = skin
  }, [skin, model])

  return <canvas ref={ref} width={16} height={32} />
}
