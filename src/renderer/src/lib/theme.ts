/** Accent colour of the Minecraft launcher: the green tokens of tokens.css are recomputed from one colour. */
export const ACCENT_PRESETS = ['#4cba4a', '#4c9be8', '#9b6cf2', '#e8457d', '#f39c3d', '#f5c542', '#2ec4b6', '#e5484d']

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (c: [number, number, number], to: number, k: number): string =>
  '#' + c.map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join('')

export function applyAccent(hex: string | undefined): void {
  const root = document.documentElement.style
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    for (const v of ['--green', '--green-bright', '--green-dark', '--green-glow', '--green-soft']) root.removeProperty(v)
    return
  }
  const rgb = hexToRgb(hex)
  root.setProperty('--green', hex)
  root.setProperty('--green-bright', mix(rgb, 255, 0.22))
  root.setProperty('--green-dark', mix(rgb, 0, 0.3))
  root.setProperty('--green-glow', `rgba(${rgb.join(', ')}, 0.35)`)
  root.setProperty('--green-soft', `rgba(${rgb.join(', ')}, 0.12)`)
}
