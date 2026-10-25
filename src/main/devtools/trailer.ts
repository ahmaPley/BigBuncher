import { app, screen, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Records the 1.2 trailer: drives the real UI through the new features with demo data
 * (temporary userData + game folder, nothing of the player's is touched) while ffmpeg
 * records the window. Run:  BIGBUNCHER_TRAILER=<out dir> npx electron .
 * Writes <out>/raw.mp4 and <out>/marks.json (scene start times for the captions).
 */

export function prepareTrailerPaths(): void {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'bigbuncher-trailer-')))
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runTrailer(win: BrowserWindow, outDir: string): Promise<void> {
  const { updateSettings } = await import('../settings/settingsService')
  const { addOfflineAccount } = await import('../auth/accountService')
  const { addInstanceRecord } = await import('../instances/instanceService')
  const { saveProfile } = await import('../dev/devService')
  const { publish } = await import('../diagnostics/crashDoctor')
  const { emit } = await import('../core/events')
  const { instanceDir } = await import('../core/paths')

  mkdirSync(outDir, { recursive: true })
  const realGame = join(app.getPath('appData'), '.bigbuncher')
  const game = mkdtempSync(join(tmpdir(), 'bigbuncher-trailer-game-'))
  updateSettings({ gameDir: game, graphicsApi: 'ask', devMode: true, background: 'sunset', afterLaunch: 'keep' })
  addOfflineAccount('Ahmad')
  const now = Date.now()
  const base = { versionId: '1.21.1', installed: true, createdAt: now }
  addInstanceRecord({ ...base, id: 'trl-shama', name: 'ШАМА 26.4', icon: 'grass', mcVersion: '26.4', loader: 'vanilla', lastPlayedAt: now - 5000 })
  addInstanceRecord({ ...base, id: 'trl-create', name: 'Create: Индустрия', icon: 'furnace', mcVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.264', lastPlayedAt: now - 4000 })
  const pack = addInstanceRecord({ ...base, id: 'trl-pack', name: 'Мой модпак', icon: 'crafting', mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14', lastPlayedAt: now })
  updateSettings({ selectedInstanceId: pack.id })

  // Real Fabric jars from the player's instances (copied, read-only) make the mod inspector look real.
  const mods = join(instanceDir(pack.id), 'mods')
  mkdirSync(mods, { recursive: true })
  const seen = new Set<string>()
  const instRoot = join(realGame, 'instances')
  for (const id of existsSync(instRoot) ? readdirSync(instRoot) : []) {
    const dir = join(instRoot, id, 'mods')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      const key = f.replace(/[-_+]\d.*$/, '')
      // skip placeholder jars left by the feature test (a few bytes)
      if (!f.endsWith('.jar') || seen.has(key) || seen.size >= 14 || statSync(join(dir, f)).size < 4096) continue
      seen.add(key)
      copyFileSync(join(dir, f), join(mods, f))
    }
  }
  const sampleJar = readdirSync(mods)[0]

  // Fake mod project for the dev page.
  const project = join(game, 'PEAKcraft')
  mkdirSync(join(project, 'src', 'main', 'resources'), { recursive: true })
  mkdirSync(join(project, 'build', 'libs'), { recursive: true })
  writeFileSync(join(project, 'build.gradle'), '// demo')
  writeFileSync(join(project, 'gradlew.bat'), '@echo demo')
  writeFileSync(join(project, 'src', 'main', 'resources', 'fabric.mod.json'), JSON.stringify({ id: 'peakcraft', name: 'PEAKcraft', version: '0.3.0' }))
  if (sampleJar) copyFileSync(join(mods, sampleJar), join(project, 'build', 'libs', 'peakcraft-0.3.0.jar'))
  saveProfile(pack.id, { projectDir: project, deployedFile: 'peakcraft-0.3.0.jar', quickPlayWorld: '' })

  console.log('[trailer] demo data ready')
  // ---- window & recorder ----
  win.setBounds({ x: 40, y: 40, width: 1180, height: 720 })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.focus()
  await sleep(3500)
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const click = (selector: string, text?: string): Promise<unknown> =>
    js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); el?.click(); return Boolean(el) })()`)

  const b = win.getBounds()
  const scale = screen.getDisplayMatching(b).scaleFactor
  const even = (n: number): number => Math.floor(n / 2) * 2
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0', '-offset_x', String(Math.round(b.x * scale)), '-offset_y', String(Math.round(b.y * scale)), '-video_size', `${even(b.width * scale)}x${even(b.height * scale)}`, '-i', 'desktop', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', join(outDir, 'raw.mp4')],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }
  )
  let ffErr = ''
  ffmpeg.stderr?.on('data', (d: Buffer) => (ffErr = (ffErr + d.toString()).slice(-2000)))
  await sleep(1200)
  const t0 = Date.now()
  const marks: { scene: string; t: number }[] = []
  const mark = (scene: string): void => {
    console.log('[trailer] scene', scene)
    marks.push({ scene, t: (Date.now() - t0) / 1000 })
  }
  const nav = (page: string): Promise<unknown> => js(`window.__bb.navigate(${JSON.stringify(page)})`)

  try {
    console.log('[trailer] recording')
    mark('home')
    await sleep(3500)

    mark('graphics')
    await js(`window.__bb.setGraphicsAsk({ instanceId: '${pack.id}' })`)
    await sleep(4500)
    await js('window.__bb.setGraphicsAsk(undefined)')

    mark('crash')
    publish({
      id: 'demo-crash',
      instanceId: pack.id,
      phase: 'crash',
      createdAt: Date.now(),
      exitCode: 1,
      headline: 'Minecraft крашнулся (код 1)',
      problems: [
        {
          title: 'Не хватает мода «Fabric API»',
          explanation: 'Мод «Jade» не работает без «Fabric API», а его нет в сборке. Поэтому игра не запустилась.',
          confidence: 'high',
          evidence: "Mod 'Jade' (jade) 15.10.3 requires any version of fabric-api, which is missing!",
          fixes: [{ label: 'Установить «Fabric API» с Modrinth', action: { kind: 'installMod', modId: 'fabric-api' } }]
        },
        {
          title: 'Видеокарта не тянет Vulkan',
          explanation: 'Новые версии Minecraft рисуют через Vulkan, а твоя видеокарта с ним не справилась. Переключу игру на OpenGL — он работает почти везде.',
          confidence: 'high',
          evidence: 'Failed to create backend VULKAN: VK_ERROR_INCOMPATIBLE_DRIVER',
          fixes: [{ label: 'Запускать на OpenGL', action: { kind: 'setGraphics', api: 'opengl' } }]
        }
      ]
    })
    await sleep(3800)
    await click('.doctor-evidence .link-btn')
    await sleep(1800)
    await click('.modal .btn.primary', 'Исправить и запустить')
    for (let i = 0; i < 40 && !(await js('Boolean(document.querySelector(".doctor-result"))')); i++) await sleep(250)
    await sleep(3200)
    await js('window.__bb.setDiagnosis(undefined)')

    mark('server')
    publish({
      id: 'demo-server',
      instanceId: pack.id,
      phase: 'disconnect',
      createdAt: Date.now(),
      headline: 'Не получилось играть на сервере mc.goi.ru',
      problems: [
        {
          title: 'Моды не совпадают с сервером',
          explanation: 'На сервере есть моды, которых нет у тебя: create, flywheel. Установлю их в сборку.',
          confidence: 'high',
          evidence: 'Mismatched mod channel list: missing [create, flywheel]',
          fixes: [{ label: 'Установить «create» с Modrinth', action: { kind: 'installMod', modId: 'create' } }]
        }
      ]
    })
    await sleep(4200)
    await js('window.__bb.setDiagnosis(undefined)')

    mark('bisect')
    await nav('instances')
    const steps = ['Проверяю, повторяется ли краш…', 'Шаг 1 из ~5: запуск с 7 из 14 подозреваемых модов', 'Шаг 2 из ~5: запуск с 4 из 7 подозреваемых модов', 'Шаг 3 из ~5: запуск с 2 из 4 подозреваемых модов', 'Шаг 4 из ~5: запуск с 1 из 2 подозреваемых модов']
    for (const [i, detail] of steps.entries()) {
      emit('bisect', { instanceId: pack.id, running: true, step: i, detail })
      await sleep(1100)
    }
    emit('bisect', { instanceId: pack.id, running: false, step: 5, detail: 'Найден виновник: Sodium Extra', culprit: 'sodium-extra.jar' })
    await sleep(2600)
    await click('.bisect-banner .btn')

    mark('dev')
    await nav('dev')
    await sleep(600)
    await click('.dev-page .btn', 'Проверить моды') // jar scan takes a few seconds — start it early
    await sleep(1200)
    // the page itself is the scroller (.page { overflow-y: auto })
    await js(`document.querySelector('.dev-page').scrollTo({ top: document.querySelector('.dev-console').offsetTop - 60, behavior: 'smooth' })`)
    await sleep(700)
    const gradle = ['> gradlew build', '> Task :compileJava', '> Task :processResources', '> Task :remapJar', 'BUILD SUCCESSFUL in 6s', 'Сборка прошла успешно', 'Скопирован peakcraft-0.3.0.jar → mods/']
    for (const line of gradle) {
      emit('devLog', { source: line.startsWith('Скоп') ? 'deploy' : 'gradle', line, level: 'info' })
      await sleep(120)
    }
    const gameLines = [
      '[12:41:07] [main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.14',
      `[12:41:08] [main/INFO]: Loading ${seen.size + 1} mods`,
      '[12:41:12] [Render thread/INFO]: Setting user: Ahmad',
      '[12:41:15] [Render thread/INFO]: [PEAKcraft] Climbing system ready',
      '[12:41:19] [Render thread/WARN]: Missing sound for event: peakcraft:stamina_low',
      '[12:41:22] [Render thread/INFO]: Sound engine started',
      '[12:41:31] [Render thread/ERROR]: Exception ticking climber',
      'java.lang.NullPointerException: Cannot invoke "Ledge.normal()" because "ledge" is null',
      '\tat com.ahmad.peakcraft.climb.ClimbController.tick(ClimbController.java:88)',
      '\tat net.minecraft.client.player.LocalPlayer.tick(LocalPlayer.java:250)'
    ]
    for (const line of gameLines) {
      emit('gameLog', { instanceId: pack.id, line, stream: /ERROR|Exception|\tat/.test(line) ? 'err' : 'out' })
      await sleep(200)
    }
    await sleep(1500)
    for (let i = 0; i < 40 && !(await js('Boolean(document.querySelector(".mod-table"))')); i++) await sleep(200)
    await js(`document.querySelector('.dev-page').scrollTo({ top: 99999, behavior: 'smooth' })`)
    await sleep(3800)

    mark('settings')
    await nav('settings')
    await sleep(800)
    await js(`[...document.querySelectorAll('.card-title')].find(e => e.textContent.includes('Графика'))?.scrollIntoView({ behavior: 'smooth', block: 'center' })`)
    await sleep(3500)
    mark('end')
  } finally {
    ffmpeg.stdin?.write('q')
    await new Promise((r) => ffmpeg.on('close', r))
    writeFileSync(join(outDir, 'marks.json'), JSON.stringify(marks, null, 2))
    if (!existsSync(join(outDir, 'raw.mp4'))) console.error('[trailer] ffmpeg failed:', ffErr)
    console.log('[trailer] done', outDir)
  }
}
