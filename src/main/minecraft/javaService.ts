import { Version } from '@xmcl/core'
import {
  fetchJavaRuntimeManifest,
  getPotentialJavaLocations,
  installJavaRuntimeTask,
  resolveJava,
  scanLocalJava
} from '@xmcl/installer'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { downloadOptions } from '../core/downloadAgent'
import { gameDir, javaRuntimeDir } from '../core/paths'
import type { TaskReporter } from '../core/tasks'
import { runXmclTask } from '../loaders/taskProgress'
import { getSettings } from '../settings/settingsService'

/** Mojang runtime component used when a version json has no javaVersion (very old versions). */
const LEGACY_COMPONENT = 'jre-legacy'

export interface JavaRequirement {
  component: string
  majorVersion: number
}

export async function javaRequirementOf(versionId: string): Promise<JavaRequirement> {
  const resolved = await Version.parse(gameDir(), versionId)
  return resolved.javaVersion ?? { component: LEGACY_COMPONENT, majorVersion: 8 }
}

/** Requirement for a vanilla version json that may not be installed yet. */
export function javaRequirementOfJson(json: { javaVersion?: JavaRequirement }): JavaRequirement {
  return json.javaVersion ?? { component: LEGACY_COMPONENT, majorVersion: 8 }
}

const runtimeExecutable = (component: string): string => join(javaRuntimeDir(), component, 'bin', 'java.exe')

/**
 * Returns a Java executable for the requirement:
 *  1. the user's custom Java from settings, if set;
 *  2. a Mojang runtime previously downloaded into <gameDir>/runtime;
 *  3. otherwise downloads the official Mojang runtime for this component.
 */
export async function ensureJava(req: JavaRequirement, report: TaskReporter): Promise<string> {
  const custom = getSettings().javaPath.trim()
  if (custom) {
    if (!existsSync(custom)) throw new Error(`Java не найдена по пути: ${custom}`)
    return custom
  }

  const exe = runtimeExecutable(req.component)
  if (existsSync(exe)) return exe

  report.update(-1, `Скачивание Java ${req.majorVersion}`)
  const manifest = await fetchJavaRuntimeManifest({ target: req.component })
  const task = installJavaRuntimeTask({ manifest, destination: join(javaRuntimeDir(), req.component), lzma: false, ...downloadOptions })
  await runXmclTask(task, report, `Java ${req.majorVersion}`)
  if (!existsSync(exe)) throw new Error('Java установлена, но java.exe не найден')
  return exe
}

export async function detectInstalledJava(): Promise<{ path: string; version: string }[]> {
  const found = await scanLocalJava(await getPotentialJavaLocations())
  const bundled = await Promise.all(
    ['java-runtime-delta', 'java-runtime-gamma', 'java-runtime-epsilon', LEGACY_COMPONENT]
      .map(runtimeExecutable)
      .filter(existsSync)
      .map((p) => resolveJava(p))
  )
  const all = [...found, ...bundled.filter((j) => j !== undefined)]
  const unique = new Map(all.map((j) => [j.path.toLowerCase(), { path: j.path, version: j.version }]))
  return [...unique.values()]
}
