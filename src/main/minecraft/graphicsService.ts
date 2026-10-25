import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import yauzl from 'yauzl'
import type { GraphicsInfo } from '../../shared/types'
import { gameDir } from '../core/paths'
import { getSettings } from '../settings/settingsService'

/**
 * Minecraft 26.2+ renders through Vulkan or OpenGL ("preferredGraphicsBackend" in options.txt,
 * forced with the --graphicsBackend launch argument). Weak or old GPUs often have no working
 * Vulkan, so the launcher asks the player once, or checks the PC itself ("Не знаю").
 */

const supportCache = new Map<string, boolean>()

/** True when this Minecraft version has the Vulkan/OpenGL switch (the client jar has PreferredGraphicsApi). */
export function versionHasGraphicsChoice(mcVersion: string): Promise<boolean> {
  const cached = supportCache.get(mcVersion)
  if (cached !== undefined) return Promise.resolve(cached)
  const jar = join(gameDir(), 'versions', mcVersion, `${mcVersion}.jar`)
  if (!existsSync(jar)) return Promise.resolve(false)
  return new Promise((resolve) => {
    yauzl.open(jar, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return resolve(false)
      let found = false
      zip.on('entry', (e: yauzl.Entry) => {
        if (e.fileName === 'net/minecraft/client/PreferredGraphicsApi.class') {
          found = true
          zip.close()
          return done()
        }
        zip.readEntry()
      })
      const done = (): void => {
        supportCache.set(mcVersion, found)
        resolve(found)
      }
      zip.on('end', done)
      zip.on('error', () => resolve(false))
      zip.readEntry()
    })
  })
}

function reg(args: string[]): Promise<string> {
  return new Promise((resolve) => execFile('reg', ['query', ...args], { windowsHide: true }, (_e, out) => resolve(out ?? '')))
}

let detected: GraphicsInfo | undefined

/** Looks for a registered Vulkan driver and the GPU model. */
export async function detectGraphics(): Promise<GraphicsInfo> {
  if (detected) return detected
  const sys32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  const loader = existsSync(join(sys32, 'vulkan-1.dll'))
  // Modern drivers register their Vulkan ICD on the display adapter key; older ones under Khronos\Vulkan\Drivers.
  const [adapters, khronos] = await Promise.all([
    reg(['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s', '/v', 'VulkanDriverName']),
    reg(['HKLM\\SOFTWARE\\Khronos\\Vulkan\\Drivers'])
  ])
  const icd = /VulkanDriverName/i.test(adapters) || /\.json/i.test(khronos)

  let gpu = ''
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: { active?: boolean; vendorId?: number; deviceString?: string; driverVendor?: string }[] }
    const dev = info.gpuDevice?.find((d) => d.active) ?? info.gpuDevice?.[0]
    gpu = dev?.deviceString || dev?.driverVendor || ''
  } catch {
    /* no GPU info */
  }
  // Old integrated GPUs report a Vulkan driver but lack Vulkan 1.2 features Minecraft needs.
  const oldGpu = /HD Graphics (2|3|4|5)\d{2}\b|HD Graphics$|GeForce (GT|GTX) [1-7]\d{2}\b|Radeon HD|Radeon R[579] /i.test(gpu)
  const vulkan = loader && icd
  const recommended = vulkan && !oldGpu ? 'vulkan' : 'opengl'
  detected = {
    vulkan,
    gpu: gpu || 'видеокарта не определена',
    recommended,
    reason: !vulkan
      ? 'Драйвер Vulkan не найден — игра пойдёт на OpenGL.'
      : oldGpu
        ? 'Vulkan есть, но видеокарта старая — надёжнее OpenGL.'
        : 'Vulkan поддерживается — будет Vulkan.'
  }
  return detected
}

/** Launch arguments for the chosen renderer ([] = let the game decide). */
export async function graphicsArgs(mcVersion: string): Promise<string[]> {
  const choice = getSettings().graphicsApi
  if (!(await versionHasGraphicsChoice(mcVersion))) return []
  const api = choice === 'vulkan' || choice === 'opengl' ? choice : (await detectGraphics()).recommended
  return ['--graphicsBackend', api]
}
