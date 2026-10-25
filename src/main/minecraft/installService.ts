import { MinecraftFolder, Version } from '@xmcl/core'
import { installDependenciesTask, installVersionTask } from '@xmcl/installer'
import type { Instance } from '../../shared/types'
import { downloadOptions, withRetries } from '../core/downloadAgent'
import { gameDir } from '../core/paths'
import type { TaskReporter } from '../core/tasks'
import { getLoader } from '../loaders'
import { runXmclTask } from '../loaders/taskProgress'
import { isCorruptArchiveError, removeCorruptJars } from './jarIntegrity'
import { ensureJava, javaRequirementOf } from './javaService'
import { findMinecraftVersion } from './versionService'

export interface InstallResult {
  versionId: string
  javaPath: string
}

const ATTEMPTS = 3

/**
 * Full install of an instance's version: vanilla json+jar -> Java -> mod loader -> libraries/assets.
 * Safe to re-run: every step verifies existing files and only downloads what is missing or broken.
 */
export async function installInstanceVersion(instance: Instance, report: TaskReporter): Promise<InstallResult> {
  const folder = MinecraftFolder.from(gameDir())

  report.update(-1, `Minecraft ${instance.mcVersion}`)
  const meta = await findMinecraftVersion(instance.mcVersion)
  await withRetries(ATTEMPTS, () =>
    runXmclTask(installVersionTask(meta, folder, downloadOptions), report, `Minecraft ${instance.mcVersion}`)
  )

  const javaPath = await ensureJava(await javaRequirementOf(instance.mcVersion), report)

  // Broken jars from an interrupted earlier download (e.g. the Forge installer) are cleaned up
  // before every retry, so the next attempt downloads them again instead of failing the same way.
  let lastError: unknown
  const cleanBeforeRetry = async (attempt: number): Promise<void> => {
    if (attempt === 1 || !isCorruptArchiveError(lastError)) return
    report.update(-1, 'Проверка скачанных файлов')
    await removeCorruptJars([folder.libraries, folder.versions], Date.now() - 7 * 24 * 3600_000)
  }
  const remember = async <T,>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (err) {
      lastError = err
      throw err
    }
  }

  let versionId = instance.mcVersion
  if (instance.loader !== 'vanilla') {
    if (!instance.loaderVersion) throw new Error('Не выбрана версия загрузчика')
    const loader = getLoader(instance.loader)
    versionId = await withRetries(ATTEMPTS, async (attempt) => {
      await cleanBeforeRetry(attempt)
      return remember(() =>
        loader.install({
          folder,
          mcVersion: instance.mcVersion,
          loaderVersion: instance.loaderVersion!,
          javaPath,
          report
        })
      )
    })
  }

  const resolved = await Version.parse(folder, versionId)
  await withRetries(ATTEMPTS, async (attempt) => {
    await cleanBeforeRetry(attempt)
    return remember(() =>
      runXmclTask(
      installDependenciesTask(resolved, downloadOptions),
      report,
      attempt === 1 ? 'Библиотеки и ресурсы' : `Докачка файлов (попытка ${attempt})`
      )
    )
  })
  return { versionId, javaPath }
}
