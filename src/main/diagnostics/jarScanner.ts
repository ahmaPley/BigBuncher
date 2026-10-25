import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yauzl from 'yauzl'
import type { LoaderId, ModJarInfo, ModPlatform } from '../../shared/types'

/**
 * Reads mod metadata straight from the jars in a mods folder (fabric.mod.json, quilt.mod.json,
 * mods.toml, neoforge.mods.toml) plus the Java packages each jar contains, so a stack trace
 * frame can be traced back to the jar it came from.
 */

export interface ScannedJar extends ModJarInfo {
  /** Ids this jar provides besides its own (Fabric "provides", nested jars). */
  provides: string[]
  /** Java package prefixes (a.b.c) of the classes in the jar. */
  packages: string[]
  corrupt: boolean
}

const META_FILES = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'META-INF/jarjar/metadata.json']

/** Mod ids that are part of the game or the loader itself, never missing. */
export const BUILTIN_IDS = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'fml', 'javafml', 'mixinextras', 'mixin'
])

/** Packages that belong to the game, the loader or common libraries — never a mod's fault on their own. */
const FOREIGN_PACKAGES = /^(java|javax|jdk|sun|com\.sun|net\.minecraft|com\.mojang|net\.fabricmc|org\.quiltmc|net\.minecraftforge|net\.neoforged|cpw\.mods|org\.spongepowered|org\.lwjgl|io\.netty|com\.google|org\.apache|it\.unimi|org\.objectweb|kotlin|kotlinx|org\.slf4j|com\.electronwill|org\.jetbrains|com\.llamalad7|joptsimple|oshi|com\.ibm|org\.openjdk)\b/

const cache = new Map<string, { stamp: string; jar: ScannedJar }>()

function readZip(file: string): Promise<{ names: string[]; files: Record<string, Buffer> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip'))
      const names: string[] = []
      const files: Record<string, Buffer> = {}
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName)
        if (!META_FILES.includes(entry.fileName)) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return zip.readEntry()
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks)
            zip.readEntry()
          })
          stream.on('error', () => zip.readEntry())
        })
      })
      zip.on('end', () => resolve({ names, files }))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

const text = (b?: Buffer): string => (b ? b.toString('utf8').replace(/^﻿/, '') : '')

/** Minimal mods.toml reader: [[mods]] blocks and [[dependencies.<id>]] blocks. */
export function parseModsToml(src: string): { mods: { id: string; name?: string; version?: string }[]; deps: { id: string; range?: string; mandatory: boolean }[] } {
  const mods: { id: string; name?: string; version?: string }[] = []
  const deps: { id: string; range?: string; mandatory: boolean }[] = []
  let block: Record<string, string> | undefined
  let kind: 'mod' | 'dep' | 'other' = 'other'
  const flush = (): void => {
    if (!block) return
    if (kind === 'mod' && block.modId) mods.push({ id: block.modId, name: block.displayName, version: block.version })
    if (kind === 'dep' && block.modId) {
      const mandatory = block.type ? block.type.toLowerCase() === 'required' : block.mandatory !== 'false'
      deps.push({ id: block.modId, range: block.versionRange, mandatory })
    }
  }
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const header = /^\[\[\s*([\w.-]+)\s*\]\]$/.exec(line)
    if (header) {
      flush()
      block = {}
      kind = header[1] === 'mods' ? 'mod' : header[1].startsWith('dependencies') ? 'dep' : 'other'
      continue
    }
    if (/^\[/.test(line)) {
      flush()
      block = undefined
      kind = 'other'
      continue
    }
    const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(line)
    if (kv && block) block[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  flush()
  return { mods, deps }
}

function packagesOf(names: string[]): string[] {
  const set = new Set<string>()
  for (const n of names) {
    if (!n.endsWith('.class') || n.startsWith('META-INF/')) continue
    const parts = n.split('/').slice(0, -1)
    if (parts.length < 2) continue
    const pkg = parts.slice(0, Math.min(3, parts.length)).join('.')
    if (!FOREIGN_PACKAGES.test(pkg)) set.add(pkg)
  }
  return [...set]
}

export async function scanJar(dir: string, file: string): Promise<ScannedJar> {
  const path = join(dir, file)
  const st = statSync(path)
  const stamp = `${st.size}:${st.mtimeMs}`
  const fileName = file.replace(/\.disabled$/, '')
  const cached = cache.get(path)
  // fresh issues array: scanMods() appends to it, and those findings must not stick in the cache
  if (cached?.stamp === stamp) return { ...cached.jar, issues: cached.jar.issues.filter((i) => i.startsWith('Файл повреждён')), enabled: !file.endsWith('.disabled') }

  const jar: ScannedJar = {
    fileName,
    enabled: !file.endsWith('.disabled'),
    ids: [],
    name: fileName.replace(/\.jar$/, ''),
    version: '',
    platforms: [],
    dependencies: [],
    issues: [],
    provides: [],
    packages: [],
    corrupt: false
  }
  try {
    const { names, files } = await readZip(path)
    jar.packages = packagesOf(names)
    // Nested jars (jar-in-jar): their file names usually carry the bundled mod id.
    for (const n of names) {
      const m = /^META-INF\/(?:jars|jarjar)\/([^/]+)\.jar$/.exec(n)
      if (m) jar.provides.push(m[1].replace(/[-_]\d.*$/, '').toLowerCase())
    }
    const fabric = files['fabric.mod.json'] ?? files['quilt.mod.json']
    if (files['fabric.mod.json']) jar.platforms.push('fabric')
    if (files['quilt.mod.json']) jar.platforms.push('quilt')
    if (fabric) {
      try {
        const j = JSON.parse(text(fabric).replace(/[\u0000-\u001f]/g, ' '))
        const q = j.quilt_loader
        const id = q?.id ?? j.id
        if (id) jar.ids.push(id)
        jar.name = q?.metadata?.name ?? j.name ?? jar.name
        jar.version = q?.version ?? j.version ?? ''
        for (const p of j.provides ?? q?.provides ?? []) jar.provides.push(typeof p === 'string' ? p : p.id)
        const depends = j.depends ?? {}
        for (const [depId, range] of Object.entries(depends)) jar.dependencies.push({ id: depId, range: String(range) })
        for (const d of q?.depends ?? []) {
          if (typeof d === 'string') jar.dependencies.push({ id: d })
          else if (d?.id && !d.optional) jar.dependencies.push({ id: d.id, range: d.versions ? String(d.versions) : undefined })
        }
      } catch {
        /* broken json: keep the file name */
      }
    }
    for (const [metaFile, platform] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']] as const) {
      const toml = files[metaFile]
      if (!toml) continue
      jar.platforms.push(platform)
      const parsed = parseModsToml(text(toml))
      for (const m of parsed.mods) {
        jar.ids.push(m.id)
        if (jar.name === fileName.replace(/\.jar$/, '') && m.name) jar.name = m.name
        if (!jar.version && m.version && !m.version.includes('${')) jar.version = m.version
      }
      for (const d of parsed.deps) if (d.mandatory) jar.dependencies.push({ id: d.id, range: d.range })
    }
    const jarjar = files['META-INF/jarjar/metadata.json']
    if (jarjar) {
      try {
        for (const j of JSON.parse(text(jarjar)).jars ?? []) if (j.identifier?.artifact) jar.provides.push(String(j.identifier.artifact).toLowerCase())
      } catch {
        /* ignore */
      }
    }
  } catch {
    jar.corrupt = true
    jar.issues.push('Файл повреждён (не открывается как архив)')
  }
  // multi-loader jars declare the same id in fabric.mod.json and mods.toml — not a duplicate
  jar.ids = [...new Set(jar.ids)]
  jar.dependencies = jar.dependencies.filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i)
  cache.set(path, { stamp, jar })
  return { ...jar, issues: [...jar.issues] }
}

const norm = (id: string): string => id.toLowerCase().replace(/_/g, '-')

/** Can this loader run a jar made for these platforms? */
export function platformFits(loader: LoaderId, mcVersion: string, platforms: ModPlatform[]): boolean {
  if (!platforms.length) return true // library jar without metadata
  if (loader === 'fabric') return platforms.includes('fabric')
  if (loader === 'quilt') return platforms.includes('quilt') || platforms.includes('fabric')
  if (loader === 'forge') return platforms.includes('forge')
  if (loader === 'neoforge') {
    // NeoForge for 1.20.1 is a Forge fork and loads mods.toml; newer NeoForge only neoforge.mods.toml.
    return platforms.includes('neoforge') || (platforms.includes('forge') && /^1\.20(\.1)?$/.test(mcVersion))
  }
  return true
}

/** Scans every jar of a mods folder and fills `issues` (wrong loader, duplicate ids, missing dependencies). */
export async function scanMods(modsDir: string, loader: LoaderId, mcVersion: string): Promise<ScannedJar[]> {
  if (!existsSync(modsDir)) return []
  const files = readdirSync(modsDir).filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
  const jars: ScannedJar[] = []
  for (const f of files) jars.push(await scanJar(modsDir, f))

  const enabled = jars.filter((j) => j.enabled && !j.corrupt)
  const hasConnector = enabled.some((j) => j.ids.includes('connector'))
  const available = new Set<string>()
  for (const j of enabled) for (const id of [...j.ids, ...j.provides]) available.add(norm(id))
  const hasFabricApi = available.has('fabric-api') || available.has('fabric')

  const byId = new Map<string, ScannedJar[]>()
  for (const j of enabled) for (const id of new Set(j.ids)) byId.set(id, [...(byId.get(id) ?? []), j])

  for (const j of enabled) {
    if (!platformFits(loader, mcVersion, j.platforms) && !(hasConnector && j.platforms.includes('fabric'))) {
      j.issues.push(`Мод для ${j.platforms.map(platformLabel).join('/')}, а сборка на ${platformLabel(loader)}`)
      continue
    }
    for (const id of j.ids) {
      const same = byId.get(id) ?? []
      if (same.length > 1) j.issues.push(`Дубликат: мод «${id}» лежит ещё в ${same.filter((x) => x !== j).map((x) => x.fileName).join(', ')}`)
    }
    for (const dep of j.dependencies) {
      const id = norm(dep.id)
      if (BUILTIN_IDS.has(dep.id) || BUILTIN_IDS.has(id) || available.has(id)) continue
      if (hasFabricApi && /^fabric(-|$)/.test(id)) continue // Fabric API modules are bundled inside fabric-api
      if ([...available].some((a) => a.startsWith(id) || id.startsWith(a + '-'))) continue
      j.issues.push(`Не хватает мода «${dep.id}»${dep.range && dep.range !== '*' ? ` (${dep.range})` : ''}`)
    }
  }
  return jars
}

export function platformLabel(p: string): string {
  return ({ fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'ванилле' } as Record<string, string>)[p] ?? p
}

/** Finds the jar a fully-qualified class name (a.b.c.Foo) comes from. */
export function jarOfClass(jars: ScannedJar[], className: string): ScannedJar | undefined {
  const parts = className.split('.')
  for (let len = Math.min(3, parts.length - 1); len >= 2; len--) {
    const pkg = parts.slice(0, len).join('.')
    if (FOREIGN_PACKAGES.test(pkg)) return undefined
    const hit = jars.find((j) => j.packages.some((p) => p === pkg || p.startsWith(pkg + '.')))
    if (hit) return hit
  }
  return undefined
}

export function jarOfModId(jars: ScannedJar[], id: string): ScannedJar | undefined {
  const n = norm(id)
  return jars.find((j) => j.ids.some((x) => norm(x) === n)) ?? jars.find((j) => j.provides.some((x) => norm(x) === n))
}
