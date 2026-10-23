import type { LoaderId } from '../../shared/types'
import { fabricLoader } from './fabricLoader'
import { forgeLoader } from './forgeLoader'
import { neoforgeLoader } from './neoforgeLoader'
import { quiltLoader } from './quiltLoader'
import type { ModLoader } from './types'

/** Registry of supported mod loaders. Add a new loader by implementing ModLoader and listing it here. */
const LOADERS: ModLoader[] = [fabricLoader, forgeLoader, neoforgeLoader, quiltLoader]

export function getLoader(id: LoaderId): ModLoader {
  const loader = LOADERS.find((l) => l.id === id)
  if (!loader) throw new Error(`Неизвестный загрузчик: ${id}`)
  return loader
}

export type { ModLoader } from './types'
