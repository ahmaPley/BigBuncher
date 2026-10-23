/** Editor palette, remembered per viewer in localStorage. */
export const DEFAULT_PALETTE = ['#000000', '#fff21a', '#3fd400', '#6bfa2a', '#f3b0e2', '#955f3f', '#a52a8c', '#8c237a', '#b33a9c']

const KEY = 'bigbuncher.skinPalette'

export function loadPalette(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(saved) && saved.every((c) => /^#[0-9a-f]{6}$/i.test(c))) return saved
  } catch {
    /* storage unavailable — fall back to defaults */
  }
  return [...DEFAULT_PALETTE]
}

export function savePalette(colors: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(colors))
  } catch {
    /* non-critical */
  }
}
