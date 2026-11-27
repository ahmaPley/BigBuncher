import type { RecommendedServer } from './types'

/** «Рекомендуемые серверы» on the home page. kind 'pack' = needs a modded instance. */
export const RECOMMENDED_SERVERS: RecommendedServer[] = [
  {
    id: 'hypixel',
    name: 'Hypixel',
    address: 'mc.hypixel.net',
    versions: '1.8–1.21',
    kind: 'vanilla',
    description: 'Самый большой сервер: BedWars, SkyBlock, SkyWars и куча мини-игр.'
  },
  {
    id: 'cubecraft',
    name: 'CubeCraft',
    address: 'play.cubecraft.net',
    versions: '1.19+',
    kind: 'vanilla',
    description: 'Мини-игры: EggWars, SkyWars, паркур.'
  },
  {
    id: 'wynncraft',
    name: 'Wynncraft',
    address: 'play.wynncraft.com',
    versions: '1.20+',
    kind: 'vanilla',
    description: 'MMORPG прямо в Minecraft: квесты, классы, данжи.'
  },
  {
    id: 'absolute-pvp',
    name: 'Absolute PVP',
    versions: '1.21.1',
    kind: 'pack',
    pack: { url: 'https://github.com/ahmaPley/BigBuncher/releases/download/packs/absolute-pvp.bbpack', size: '101 МБ + моды' },
    packNote: 'Сборка Tambi Studios: NeoForge 1.21.1, карта с режимами, зомби, техникой и мини-играми. Играть с другом — через e4mc.',
    description: 'Наша PvP-карта: дедматч, зомби, дроны, гонки, 4 башни, мини-игры. Скачивается прямо из лаунчера.'
  }
]

/** Donate link of the heart button; empty = not set yet (the button explains that). */
export const DONATE_URL = ''
