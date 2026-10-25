import type { Fix, Instance, Problem } from '../../shared/types'
import { BUILTIN_IDS, jarOfClass, jarOfModId, platformLabel, type ScannedJar } from './jarScanner'

/**
 * Rule-based crash analysis. Input = what the game left behind (log, crash report, JVM error file)
 * plus a scan of the mods folder; output = problems explained in plain Russian, each with
 * fixes the launcher can apply on its own.
 *
 * Adding a rule: write a function (ctx) => Problem[] and put it into RULES.
 */

export interface AnalyzeContext {
  instance: Instance
  log: string
  crashReport?: string
  hsErr?: string
  jars: ScannedJar[]
  exitCode?: number
  maxRamMb: number
  totalRamMb: number
  customJava: boolean
  jvmArgs: string
}

type Rule = (ctx: AnalyzeContext) => Problem[]

const all = (ctx: AnalyzeContext): string => `${ctx.log}\n${ctx.crashReport ?? ''}`
const line = (text: string, index: number): string => {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 400)
}
const modName = (jar: ScannedJar): string => (jar.name && jar.name !== jar.fileName.replace(/\.jar$/, '') ? `«${jar.name}»` : `«${jar.fileName}»`)

const disable = (jar: ScannedJar): Fix => ({ label: `Выключить ${modName(jar)}`, action: { kind: 'disableMod', fileName: jar.fileName } })
const update = (jar: ScannedJar): Fix => ({ label: `Обновить ${modName(jar)} до подходящей версии`, action: { kind: 'updateMod', fileName: jar.fileName } })
const install = (id: string): Fix => ({ label: `Установить «${prettyId(id)}» с Modrinth`, action: { kind: 'installMod', modId: id } })

const PRETTY: Record<string, string> = {
  'fabric-api': 'Fabric API', fabric: 'Fabric API', 'fabric-language-kotlin': 'Fabric Language Kotlin', geckolib: 'GeckoLib',
  architectury: 'Architectury API', 'cloth-config': 'Cloth Config', cloth_config: 'Cloth Config', kotlinforforge: 'Kotlin for Forge',
  forgeconfigapiport: 'Forge Config API Port', curios: 'Curios API', balm: 'Balm', jei: 'JEI', patchouli: 'Patchouli', owo: 'oωo-lib',
  yet_another_config_lib_v3: 'YetAnotherConfigLib', yacl: 'YetAnotherConfigLib', puzzleslib: 'Puzzles Lib', citadel: 'Citadel',
  resourcefullib: 'Resourceful Lib', playeranimator: 'playerAnimator', terrablender: 'TerraBlender', moonlight: 'Moonlight Lib', collective: 'Collective'
}
export const prettyId = (id: string): string => PRETTY[id] ?? id

/* ---------------- loader-reported dependency problems ---------------- */

/** Fabric/Quilt: "Mod 'X' (x) 1.0 requires any version of fabric-api, which is missing!" and friends. */
const fabricResolution: Rule = (ctx) => {
  const text = all(ctx)
  const out: Problem[] = []
  const seen = new Set<string>()
  const missing = /Mod '([^']+)' \(([\w.-]+)\)[^\n]*? requires (?:any version|version ([^\n]+?)) of (?:mod )?(?:'([^']+)' \(([\w.-]+)\)|([\w.-]+)), which is missing/g
  for (const m of text.matchAll(missing)) {
    const depId = m[5] ?? m[6]
    if (BUILTIN_IDS.has(depId) || seen.has(depId)) continue
    seen.add(depId)
    out.push({
      title: `Не хватает мода «${m[4] ?? prettyId(depId)}»`,
      explanation: `Мод «${m[1]}» не работает без «${m[4] ?? prettyId(depId)}»${m[3] ? ` (нужна версия ${m[3]})` : ''}, а его нет в сборке. Поэтому игра не запустилась.`,
      confidence: 'high',
      evidence: line(text, m.index!),
      fixes: [install(depId), ...disableById(ctx, m[2])]
    })
  }
  const wrong = /Mod '([^']+)' \(([\w.-]+)\)[^\n]*? requires (?:any version|version ([^\n]+?)) of (?:mod )?'([^']+)' \(([\w.-]+)\), but only the wrong version is present: ([^\n!]+)/g
  for (const m of text.matchAll(wrong)) {
    const [, name, id, need, depName, depId, have] = m
    if (seen.has(`${id}>${depId}`)) continue
    seen.add(`${id}>${depId}`)
    const jar = jarOfModId(ctx.jars, id)
    if (depId === 'minecraft') {
      out.push({
        title: `«${name}» сделан для другой версии Minecraft`,
        explanation: `Мод «${name}» рассчитан на Minecraft ${need}, а в сборке ${have}. Лаунчер может скачать версию мода именно для ${ctx.instance.mcVersion} или выключить его.`,
        confidence: 'high',
        evidence: line(text, m.index!),
        fixes: jar ? [update(jar), disable(jar)] : []
      })
    } else if (depId === 'java') {
      out.push(javaTooOld(`«${name}» требует Java ${need}, а запущена ${have}.`, ctx))
    } else {
      const dep = jarOfModId(ctx.jars, depId)
      out.push({
        title: `«${name}» нужна другая версия «${depName}»`,
        explanation: `Мод «${name}» требует «${depName}» версии ${need}, а установлена ${have}. Обычно помогает обновить «${depName}».`,
        confidence: 'high',
        evidence: line(text, m.index!),
        fixes: [...(dep ? [update(dep)] : []), ...(depId === 'fabricloader' ? [repair()] : []), ...(jar ? [disable(jar)] : [])]
      })
    }
  }
  const incompatible = /Mod '([^']+)' \(([\w.-]+)\)[^\n]*? is incompatible with (?:any version|version [^\n]+?) of (?:mod )?'([^']+)' \(([\w.-]+)\)/g
  for (const m of text.matchAll(incompatible)) {
    if (seen.has(`x${m[2]}${m[4]}`)) continue
    seen.add(`x${m[2]}${m[4]}`)
    const a = jarOfModId(ctx.jars, m[2])
    const b = jarOfModId(ctx.jars, m[4])
    out.push({
      title: `«${m[1]}» несовместим с «${m[3]}»`,
      explanation: `Эти два мода не могут работать вместе — их авторы прямо это указали. Нужно оставить только один из них.`,
      confidence: 'high',
      evidence: line(text, m.index!),
      fixes: [...(b ? [disable(b)] : []), ...(a ? [disable(a)] : [])]
    })
  }
  return out
}

/** Forge/NeoForge: "Mod ID: 'geckolib', Requested by: 'x', Expected range: '[4.4,)', Actual version: '[MISSING]'". */
const forgeDependencies: Rule = (ctx) => {
  const text = all(ctx)
  const out: Problem[] = []
  const seen = new Set<string>()
  const re = /Mod ID: '([\w.-]+)', Requested by: '([\w.-]+)', Expected range: '([^']*)', Actual version: '([^']*)'/g
  for (const m of text.matchAll(re)) {
    const [, depId, by, range, actual] = m
    if (seen.has(depId + by)) continue
    seen.add(depId + by)
    const requester = jarOfModId(ctx.jars, by)
    const byName = requester ? modName(requester) : `«${by}»`
    if (depId === 'minecraft' || depId === 'forge' || depId === 'neoforge') {
      out.push({
        title: `${byName} сделан для другой версии ${depId === 'minecraft' ? 'Minecraft' : platformLabel(depId)}`,
        explanation: `${byName} ждёт ${depId} ${range}, а в сборке ${actual}. Скачаю версию мода под эту сборку или выключу его.`,
        confidence: 'high',
        evidence: line(text, m.index!),
        fixes: [...(requester ? [update(requester), disable(requester)] : []), ...(depId !== 'minecraft' ? [repair()] : [])]
      })
    } else if (/MISSING/i.test(actual)) {
      out.push({
        title: `Не хватает мода «${prettyId(depId)}»`,
        explanation: `${byName} не работает без «${prettyId(depId)}» (${range || 'любая версия'}), а его нет в сборке.`,
        confidence: 'high',
        evidence: line(text, m.index!),
        fixes: [install(depId), ...(requester ? [disable(requester)] : [])]
      })
    } else {
      const dep = jarOfModId(ctx.jars, depId)
      out.push({
        title: `${byName} нужна другая версия «${prettyId(depId)}»`,
        explanation: `${byName} требует «${prettyId(depId)}» ${range}, а установлена ${actual}.`,
        confidence: 'high',
        evidence: line(text, m.index!),
        fixes: [...(dep ? [update(dep)] : [install(depId)]), ...(requester ? [disable(requester)] : [])]
      })
    }
  }
  // NeoForge 1.21 wording: "Mod x requires geckolib 4.5 or above" / "...which is not installed"
  for (const m of text.matchAll(/Mod ([\w.-]+) requires ([\w.-]+) ([^\n]*?)(?:or above|which is not installed|is not installed)/g)) {
    if (seen.has(m[2] + m[1]) || BUILTIN_IDS.has(m[2])) continue
    seen.add(m[2] + m[1])
    out.push({
      title: `Не хватает мода «${prettyId(m[2])}»`,
      explanation: `Мод «${m[1]}» не работает без «${prettyId(m[2])}» ${m[3].trim()}.`,
      confidence: 'medium',
      evidence: line(text, m.index!),
      fixes: [install(m[2]), ...disableById(ctx, m[1])]
    })
  }
  return out
}

/** Static check of the jars: wrong loader, duplicates, missing dependencies (used before launch and after a crash). */
export const jarIssues: Rule = (ctx) => {
  const out: Problem[] = []
  for (const jar of ctx.jars.filter((j) => j.enabled)) {
    for (const issue of jar.issues) {
      if (issue.startsWith('Мод для')) {
        out.push({
          title: `${modName(jar)} — не для этого загрузчика`,
          explanation: `${issue}. Такие моды не запускаются и часто роняют игру. Лаунчер найдёт версию под ${platformLabel(ctx.instance.loader)} или выключит мод.`,
          confidence: 'high',
          fixes: [update(jar), disable(jar)]
        })
      } else if (issue.startsWith('Дубликат')) {
        const dupId = /«([^»]+)»/.exec(issue)?.[1]
        const twins = ctx.jars.filter((j) => j.enabled && dupId && j.ids.includes(dupId))
        // Keep the newest file (by version string), disable the others once.
        if (twins[0] !== jar) continue
        const sorted = [...twins].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
        out.push({
          title: `Мод «${dupId}» установлен дважды`,
          explanation: `В папке mods несколько копий одного мода: ${twins.map((t) => t.fileName).join(', ')}. Загрузчик падает на дубликатах — нужна одна.`,
          confidence: 'high',
          fixes: sorted.slice(1).map((t) => ({ label: `Оставить ${sorted[0].fileName}, выключить ${t.fileName}`, action: { kind: 'disableMod', fileName: t.fileName } }))
        })
      } else if (issue.startsWith('Не хватает')) {
        const depId = /«([^»]+)»/.exec(issue)?.[1]
        if (!depId) continue
        out.push({
          title: `Не хватает мода «${prettyId(depId)}»`,
          explanation: `${modName(jar)} требует «${prettyId(depId)}», а его нет в сборке.`,
          confidence: 'medium',
          fixes: [install(depId), disable(jar)]
        })
      } else if (issue.startsWith('Файл повреждён')) {
        out.push({
          title: `${modName(jar)} повреждён`,
          explanation: 'Файл мода скачался не до конца или испорчен — Java не может его открыть. Перекачаю его или выключу.',
          confidence: 'high',
          fixes: [update(jar), disable(jar)]
        })
      }
    }
  }
  // the same missing dependency can be required by several mods — one problem per dependency
  return out.filter((p, i) => out.findIndex((q) => q.title === p.title) === i)
}

/* ---------------- Java / memory / JVM ---------------- */

function javaTooOld(text: string, ctx: AnalyzeContext): Problem {
  return {
    title: 'Не та версия Java',
    explanation: ctx.customJava
      ? `${text} В настройках указана своя Java — лаунчер умеет сам скачивать нужную.`
      : `${text} Обычно это значит, что мод сделан для более новой версии Minecraft.`,
    confidence: 'high',
    fixes: ctx.customJava ? [{ label: 'Выбирать Java автоматически', action: { kind: 'autoJava' } }] : []
  }
}

const javaVersion: Rule = (ctx) => {
  const text = all(ctx)
  const m = /UnsupportedClassVersionError: ([\w/$.]+) has been compiled by a more recent version of the Java Runtime \(class file version ([\d.]+)\), this version of the Java Runtime only recognizes class file versions up to ([\d.]+)/.exec(text)
  if (!m) return []
  const need = Math.round(Number(m[2])) - 44
  const have = Math.round(Number(m[3])) - 44
  const p = javaTooOld(`Код требует Java ${need}, а запущена Java ${have}.`, ctx)
  p.evidence = line(text, m.index)
  const jar = jarOfClass(ctx.jars, m[1].replace(/\//g, '.'))
  if (jar && !ctx.customJava) {
    p.title = `${modName(jar)} сделан для более новой версии`
    p.explanation = `${modName(jar)} собран под Java ${need} — это мод для более новой версии Minecraft, чем ${ctx.instance.mcVersion}.`
    p.fixes.push(update(jar), disable(jar))
  }
  return [p]
}

const memory: Rule = (ctx) => {
  const text = `${all(ctx)}\n${ctx.hsErr ?? ''}`
  const out: Problem[] = []
  const oom = /java\.lang\.OutOfMemoryError: (Java heap space|GC overhead limit exceeded|Metaspace)/.exec(text)
  const fixes: Fix[] = []
  const target = Math.min(Math.floor((ctx.totalRamMb * 0.65) / 512) * 512, ctx.maxRamMb + 4096)
  if (target > ctx.maxRamMb) fixes.push({ label: `Выделить ${(target / 1024).toFixed(1).replace('.0', '')} ГБ вместо ${(ctx.maxRamMb / 1024).toFixed(1).replace('.0', '')} ГБ`, action: { kind: 'setRam', maxRamMb: target } })
  if (oom) {
    out.push({
      title: 'Игре не хватило памяти',
      explanation: `Minecraft упёрся в лимит оперативной памяти (${(ctx.maxRamMb / 1024).toFixed(1)} ГБ). С модами нужно больше.${fixes.length ? '' : ' Больше выделить уже нельзя — попробуй убрать тяжёлые моды или шейдеры.'}`,
      confidence: 'high',
      evidence: line(text, oom.index),
      fixes
    })
  }
  const reserve = /Could not reserve enough space for (\d+)KB object heap|Invalid maximum heap size|There is insufficient memory for the Java Runtime Environment/.exec(text)
  if (reserve) {
    const safe = Math.max(2048, Math.floor((ctx.totalRamMb * 0.45) / 512) * 512)
    out.push({
      title: 'Java не смогла выделить столько памяти',
      explanation: 'Выставлено больше памяти, чем Windows может отдать игре прямо сейчас. Уменьшу выделение до безопасного значения.',
      confidence: 'high',
      evidence: line(text, reserve.index),
      fixes: [{ label: `Выделить ${(safe / 1024).toFixed(1).replace('.0', '')} ГБ`, action: { kind: 'setRam', maxRamMb: safe } }]
    })
  }
  return out
}

const jvmArgs: Rule = (ctx) => {
  const text = all(ctx)
  const m = /Unrecognized VM option '([^']+)'|Error: Could not create the Java Virtual Machine|Unrecognized option: (\S+)/.exec(text)
  if (!m || !ctx.jvmArgs.trim()) return []
  return [{
    title: 'Неверные аргументы JVM',
    explanation: `Java не поняла аргумент${m[1] || m[2] ? ` «${m[1] ?? m[2]}»` : ''} из настроек и даже не запустилась.`,
    confidence: 'high',
    evidence: line(text, m.index),
    fixes: [{ label: 'Очистить аргументы JVM', action: { kind: 'clearJvmArgs' } }]
  }]
}

/* ---------------- mod code failures ---------------- */

const mixins: Rule = (ctx) => {
  const text = all(ctx)
  const out: Problem[] = []
  const seen = new Set<string>()
  const patterns = [/Mixin apply for mod ([\w.-]+) failed/g, /from mod ([\w.-]+)\] from phase \[\w+\] in config \[[^\]]+\] FAILED/g, /Mixin \[[^\]]*?from mod ([\w.-]+)\][^\n]*?(?:FAILED|failed)/g, /Critical injection failure:[^\n]*?from mod ([\w.-]+)/g]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const id = m[1]
      if (seen.has(id) || BUILTIN_IDS.has(id)) continue
      seen.add(id)
      const jar = jarOfModId(ctx.jars, id)
      out.push({
        title: `Мод ${jar ? modName(jar) : `«${id}»`} сломал загрузку (ошибка миксина)`,
        explanation: `Этот мод пытается изменить код игры, но не смог — обычно из-за несовместимой версии или конфликта с другим модом.`,
        confidence: 'high',
        evidence: line(text, m.index!),
        fixes: jar ? [update(jar), disable(jar)] : []
      })
    }
  }
  return out
}

/** Crash report sections that name the mod: "Suspected Mod(s)", "-- MOD x --", "Mod File: …jar". */
const suspectedMods: Rule = (ctx) => {
  const report = ctx.crashReport ?? ''
  const out: Problem[] = []
  const ids = new Set<string>()
  const block = /Suspected Mods?:\s*\n?([\s\S]*?)(?:\n\s*\n|\nStacktrace|\n--)/.exec(report)
  if (block) for (const m of block[1].matchAll(/\(([\w.-]+)\), Version/g)) ids.add(m[1])
  const single = /Suspected Mod: [^\n]*?\(([\w.-]+)\)/.exec(report)
  if (single) ids.add(single[1])
  for (const m of report.matchAll(/-- MOD ([\w.-]+) --/g)) ids.add(m[1])
  for (const id of ids) {
    if (BUILTIN_IDS.has(id)) continue
    const jar = jarOfModId(ctx.jars, id)
    if (!jar) continue
    const reason = /Failure message: ([^\n]+)/.exec(report)?.[1]
    out.push({
      title: `Краш вызвал мод ${modName(jar)}`,
      explanation: `В отчёте о краше Minecraft прямо указывает на этот мод${reason ? `: ${reason.trim().slice(0, 200)}` : ''}. Попробую обновить его, а если не поможет — выключить.`,
      confidence: 'high',
      evidence: `${report.split('\n').find((l) => l.includes(id))?.trim() ?? ''}`,
      fixes: [update(jar), disable(jar)]
    })
  }
  return out
}

/** Traces the first stack frames back to a mod jar (or a mixin handler name that carries the mod id). */
const stackTrace: Rule = (ctx) => {
  const text = ctx.crashReport || ctx.log
  const exc = /(?:^|\n)\s*(?:Caused by: )?([\w.$]+(?:Exception|Error))(?::\s*([^\n]*))?\n((?:\s+at [^\n]+\n?){1,40})/g
  const found: { jar: ScannedJar; exception: string; frame: string }[] = []
  for (const m of text.matchAll(exc)) {
    for (const f of m[3].matchAll(/at (?:[\w.-]+\/\/)?([\w.$]+)\.([\w$<>]+)\(/g)) {
      const mixinOwner = /\$(?:[a-z]{3}\d{3})\$([a-z0-9_]+)\$/.exec(f[2])?.[1]
      const jar = (mixinOwner && jarOfModId(ctx.jars, mixinOwner)) || jarOfClass(ctx.jars, f[1])
      if (jar) {
        found.push({ jar, exception: `${m[1].split('.').pop()}${m[2] ? `: ${m[2].slice(0, 160)}` : ''}`, frame: f[0] })
        break
      }
    }
  }
  const first = found[0]
  if (!first) return []
  return [{
    title: `Похоже, виноват мод ${modName(first.jar)}`,
    explanation: `Ошибка «${first.exception}» произошла внутри кода этого мода. Скорее всего в нём баг или он конфликтует с другим модом.`,
    confidence: 'medium',
    evidence: first.frame,
    fixes: [update(first.jar), disable(first.jar)]
  }]
}

/* ---------------- files, drivers, install ---------------- */

const brokenConfig: Rule = (ctx) => {
  const text = all(ctx)
  const re = /(?:Failed loading config file|ParsingException|MalformedJsonException|JsonSyntaxException|Failed to (?:load|read|parse) config|Error loading config)[^\n]*?([A-Za-z]:[\\/][^\n:]*?[\\/]config[\\/][^\s'"\n]+?\.(?:toml|json5?|cfg|properties|yml|yaml))|(?:Failed loading config file|ParsingException|Failed to (?:load|parse) config)[^\n]*?(config[\\/][^\s'"\n]+?\.(?:toml|json5?|cfg|properties|yml|yaml))/
  const m = re.exec(text)
  if (!m) return []
  const rel = (m[1] ?? m[2]).replace(/^.*?[\\/]config[\\/]/, 'config/')
  return [{
    title: 'Сломан файл настроек мода',
    explanation: `Файл «${rel}» испорчен (часто после вылета во время сохранения). Перемещу его в корзину — мод создаст новый с настройками по умолчанию.`,
    confidence: 'high',
    evidence: line(text, m.index),
    fixes: [{ label: `Сбросить ${rel.split(/[\\/]/).pop()}`, action: { kind: 'trashFile', path: rel } }]
  }]
}

const DRIVERS: [RegExp, string, string][] = [
  [/nvoglv|nvd3dum|NVIDIA/i, 'NVIDIA', 'https://www.nvidia.com/ru-ru/drivers/'],
  [/atio6axx|atig6|amdxx|AMD|Radeon/i, 'AMD', 'https://www.amd.com/ru/support/download/drivers.html'],
  [/ig\w*icd|igxelp|Intel/i, 'Intel', 'https://www.intel.ru/content/www/ru/ru/support/detect.html']
]

const graphicsDriver: Rule = (ctx) => {
  const text = `${all(ctx)}\n${ctx.hsErr ?? ''}`
  const gl = /Pixel format not accelerated|GLFW error 6554[23]|WGL: The driver does not appear to support OpenGL|Couldn't set pixel format|OpenGL 3\.2 or above is required|No OpenGL context found/.exec(text)
  const native = ctx.hsErr && /EXCEPTION_ACCESS_VIOLATION/.test(ctx.hsErr) && /\[(nvoglv64|atio6axx|ig\w+icd64|amdxx64)\.dll/i.exec(ctx.hsErr)
  if (!gl && !native) return []
  const source = native ? native[1] : text
  const vendor = DRIVERS.find(([re]) => re.test(source))
  return [{
    title: 'Проблема с драйвером видеокарты',
    explanation: `Игра упала внутри драйвера видеокарты${vendor ? ` ${vendor[1]}` : ''}. Это не моды — нужно обновить драйвер. Если на ноутбуке две видеокарты, выбери мощную для javaw.exe в настройках графики Windows.`,
    confidence: 'high',
    evidence: native ? native[0] : line(text, gl!.index),
    fixes: vendor ? [{ label: `Скачать драйвер ${vendor[1]}`, action: { kind: 'openUrl', url: vendor[2] } }] : []
  }]
}

/** Minecraft 26.2+: the Vulkan renderer failed (no driver, missing Vulkan 1.2 features, driver crash). */
const vulkanRenderer: Rule = (ctx) => {
  const text = `${all(ctx)}\n${ctx.hsErr ?? ''}`
  const m = /Failed to create backend[^\n]*VULKAN[^\n]*|VulkanBackend[^\n]*(?:Exception|failed)|No supported graphics backend was found|VK_ERROR_\w+|vkCreate\w+ failed|BackendCreationException[^\n]*/i.exec(text)
  const usedVulkan = /Using graphics backend[^\n]*Vulkan/i.test(text) && (ctx.hsErr || /EXCEPTION_ACCESS_VIOLATION|Device lost/i.test(text))
  if (!m && !usedVulkan) return []
  return [{
    title: 'Видеокарта не тянет Vulkan',
    explanation: 'Новые версии Minecraft рисуют через Vulkan, а твоя видеокарта (или драйвер) с ним не справилась. Переключу игру на OpenGL — он работает почти везде.',
    confidence: 'high',
    evidence: m ? m[0].trim().slice(0, 300) : 'Using graphics backend Vulkan',
    fixes: [{ label: 'Запускать на OpenGL', action: { kind: 'setGraphics', api: 'opengl' } }]
  }]
}

const brokenInstall: Rule = (ctx) => {
  const text = all(ctx)
  const m = /Could not find or load main class|ClassNotFoundException: (?:net\.minecraft|com\.mojang|cpw\.mods|net\.fabricmc|net\.neoforged)|NoSuchFileException: [^\n]*libraries|zip END header not found[^\n]*libraries|Invalid or corrupt jarfile[^\n]*(libraries|versions)/.exec(text)
  if (!m) return []
  return [{
    title: 'Файлы игры повреждены',
    explanation: 'Не хватает или испорчены файлы самой игры/загрузчика (не моды). Лаунчер перепроверит и докачает их.',
    confidence: 'high',
    evidence: line(text, m.index),
    fixes: [repair()]
  }]
}

const repair = (): Fix => ({ label: 'Починить файлы игры', action: { kind: 'repairInstance' } })
const disableById = (ctx: AnalyzeContext, id: string): Fix[] => {
  const jar = jarOfModId(ctx.jars, id)
  return jar ? [disable(jar)] : []
}

const RULES: Rule[] = [vulkanRenderer, fabricResolution, forgeDependencies, javaVersion, memory, jvmArgs, brokenInstall, brokenConfig, mixins, suspectedMods, graphicsDriver, jarIssues, stackTrace]

/** Runs every rule; duplicates (same title) are dropped, more certain problems first. */
export function analyzeCrash(ctx: AnalyzeContext): Problem[] {
  const problems: Problem[] = []
  for (const rule of RULES) {
    try {
      problems.push(...rule(ctx))
    } catch (err) {
      console.warn('[doctor] rule failed', err)
    }
  }
  const unique = problems.filter((p, i) => problems.findIndex((q) => q.title === p.title) === i)
  // A precise loader message beats the generic "this mod is in the stack trace" guess.
  const precise = unique.some((p) => p.confidence === 'high')
  const order = { high: 0, medium: 1, low: 2 }
  return unique
    .filter((p) => !(precise && p.title.startsWith('Похоже, виноват')))
    .sort((a, b) => order[a.confidence] - order[b.confidence])
}

/* ---------------- server join ---------------- */

/** Recognises why the game could not join (or was kicked from) a server. */
export function analyzeDisconnect(reason: string, ctx: Pick<AnalyzeContext, 'instance' | 'jars'>, online: boolean): Problem[] {
  const r = reason
  const version = /(?:Outdated (?:client|server)|Incompatible client)!? (?:Please use|I'm still on|Server is running) ([\d.]+\w*)|outdated_(?:client|server)[^\d]*([\d.]+)/i.exec(r)
  if (version) {
    const v = version[1] ?? version[2]
    return [{
      title: `Сервер на другой версии (${v})`,
      explanation: `Сервер работает на Minecraft ${v}, а ты заходишь с ${ctx.instance.mcVersion}. Версии должны совпадать. Создам сборку ${v} — и можно заходить.`,
      confidence: 'high',
      evidence: r,
      fixes: [{ label: `Создать сборку ${v}`, action: { kind: 'createInstance', mcVersion: v } }]
    }]
  }
  if (/Failed to verify username|unverified_username|Invalid session|Not authenticated with Minecraft\.net/i.test(r)) {
    return [{
      title: online ? 'Сессия Microsoft устарела' : 'Сервер пускает только лицензию',
      explanation: online
        ? 'Сервер не смог проверить твой аккаунт. Перезайди в Microsoft-аккаунт в лаунчере.'
        : 'Это лицензионный сервер: он проверяет аккаунт через Microsoft, а ты зашёл с офлайн-ником. Нужно войти через Microsoft-аккаунт с купленным Minecraft (или играть на пиратских серверах).',
      confidence: 'high',
      evidence: r,
      fixes: [{ label: 'Открыть аккаунты', action: { kind: 'openAccounts' } }]
    }]
  }
  if (/white-?listed|whitelist/i.test(r)) {
    return [{ title: 'Тебя нет в вайтлисте', explanation: 'Сервер пускает только игроков из списка. Попроси админа добавить твой ник.', confidence: 'high', evidence: r, fixes: [] }]
  }
  if (/banned/i.test(r)) {
    return [{ title: 'Ты забанен на сервере', explanation: 'Сервер отказал в доступе из-за бана. Тут лаунчер помочь не может — только админ сервера.', confidence: 'high', evidence: r, fixes: [] }]
  }
  if (/Connection refused|timed out|UnknownHostException|No such host|Can't resolve address|Couldn't connect/i.test(r)) {
    return [{
      title: 'Сервер недоступен',
      explanation: 'Лаунчер не смог достучаться до сервера: он выключен, адрес написан с ошибкой или его блокирует провайдер/файрвол.',
      confidence: 'medium',
      evidence: r,
      fixes: []
    }]
  }
  const modMismatch = /mod|channel|registr|FML|negotiat|Fabric|Forge/i.test(r)
  if (modMismatch) {
    const ids = new Set<string>()
    for (const m of r.matchAll(/\[([^\]]+)\]/g)) for (const part of m[1].split(/,\s*/)) {
      const id = part.trim().split(/[:@\s]/)[0].toLowerCase()
      if (/^[a-z][\w-]{1,40}$/.test(id) && !BUILTIN_IDS.has(id) && !jarOfModId(ctx.jars, id)) ids.add(id)
    }
    for (const m of r.matchAll(/(?:missing|requires?)[^\n]*?mods?:?\s*([\w-]+(?:,\s*[\w-]+)*)/gi)) for (const id of m[1].split(/,\s*/)) {
      if (/^[a-z][\w-]{1,40}$/.test(id) && !BUILTIN_IDS.has(id) && !jarOfModId(ctx.jars, id)) ids.add(id)
    }
    return [{
      title: 'Моды не совпадают с сервером',
      explanation: ids.size
        ? `На сервере есть моды, которых нет у тебя: ${[...ids].map(prettyId).join(', ')}. Установлю их в сборку.`
        : 'Набор модов (или их версии) у тебя и на сервере отличается. Возьми у админа список модов сервера или его модпак.',
      confidence: ids.size ? 'high' : 'medium',
      evidence: r,
      fixes: [...ids].slice(0, 8).map(install)
    }]
  }
  return [{
    title: 'Сервер отключил тебя',
    explanation: `Причина от сервера: «${r.slice(0, 300)}».`,
    confidence: 'low',
    evidence: r,
    fixes: []
  }]
}
