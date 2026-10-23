/** Images prepared by scripts/prepare_assets.py from the concept assets. */
import type { BackgroundId, BlockIcon, LoaderId } from '../../../shared/types'
import banner from '../assets/img/banner.png'
import bgLake from '../assets/img/bg_lake.png'
import bgNight from '../assets/img/bg_night.png'
import bgSnow from '../assets/img/bg_snow.png'
import bgSunset from '../assets/img/bg_sunset.png'
import bgValley from '../assets/img/bg_valley.png'
import chest from '../assets/img/blocks/chest.png'
import crafting from '../assets/img/blocks/crafting.png'
import furnace from '../assets/img/blocks/furnace.png'
import grass from '../assets/img/blocks/grass.png'
import log from '../assets/img/blocks/log.png'
import stone from '../assets/img/blocks/stone.png'
import logo from '../assets/img/logo.png'

export { banner, logo }

export const BLOCK_ICONS: Record<BlockIcon, string> = { grass, stone, log, crafting, furnace, chest }

export const BACKGROUNDS: Record<BackgroundId, { src: string; name: string }> = {
  sunset: { src: bgSunset, name: 'Закат' },
  lake: { src: bgLake, name: 'Озеро' },
  night: { src: bgNight, name: 'Ночь' },
  snow: { src: bgSnow, name: 'Горы' },
  valley: { src: bgValley, name: 'Долина' }
}

export const LOADER_LABELS: Record<LoaderId, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
}

/** Default block icon per loader for new instances. */
export const LOADER_ICONS: Record<LoaderId, BlockIcon> = {
  vanilla: 'grass',
  fabric: 'log',
  forge: 'furnace',
  neoforge: 'crafting',
  quilt: 'chest'
}
