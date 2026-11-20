import { MINECRAFT_LAUNCHER_ID, type BlockIcon, type LauncherInfo, type Settings } from '../../../shared/types'
import { BLOCK_ICONS, logo } from './assets'

const BLOCK_NAMES: Record<BlockIcon, string> = {
  grass: 'Трава',
  stone: 'Камень',
  log: 'Бревно',
  crafting: 'Верстак',
  furnace: 'Печь',
  chest: 'Сундук'
}

/** The built-in Minecraft launcher; its icons are the ones BigBuncher already has. */
export const MINECRAFT: LauncherInfo = {
  id: MINECRAFT_LAUNCHER_ID,
  name: 'Minecraft',
  version: '',
  author: 'TambiStudio',
  description: 'Minecraft Java Edition: сборки, моды, скины.',
  entryUrl: '',
  accent: '#4cba4a',
  icons: [
    { key: 'logo', name: 'BigBuncher', url: logo },
    ...(Object.keys(BLOCK_ICONS) as BlockIcon[]).map((key) => ({ key, name: BLOCK_NAMES[key], url: BLOCK_ICONS[key] }))
  ]
}

/** URL of the icon the user picked for a launcher (or its default). */
export function iconOf(launcher: LauncherInfo, settings?: Settings): string {
  const key = settings?.launcherIcons[launcher.id]
  return (launcher.icons.find((i) => i.key === key) ?? launcher.icons[0]).url
}

/** Pixel-art icons (Minecraft blocks) stay sharp when scaled up. */
export const isPixelIcon = (url: string): boolean => Object.values(BLOCK_ICONS).includes(url)
