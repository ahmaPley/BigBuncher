/**
 * Templates («заготовки») for new plugins and the instruction file for an AI that writes plugins.
 * A plugin = a folder with launcher.json + a web page; BigBuncher shows the page in place of its own UI.
 */

type Files = (p: { id: string; name: string }) => Record<string, string>

const BRIDGE_JS = `// Мост к BigBuncher. У страницы нет доступа к ПК: всё через postMessage родителю.
const pending = new Map()
const listeners = new Map()
let seq = 0

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.__bb === 'res' && pending.has(m.id)) {
    const { ok, fail } = pending.get(m.id)
    pending.delete(m.id)
    m.ok ? ok(m.value) : fail(new Error(m.error))
  } else if (m.__bb === 'event') {
    for (const cb of listeners.get(m.name) ?? []) cb(m.payload)
  }
})

export const bb = {
  /** Вызов метода BigBuncher: await bb.call('getData') */
  call(method, ...args) {
    return new Promise((ok, fail) => {
      const id = ++seq
      pending.set(id, { ok, fail })
      window.parent.postMessage({ __bb: 'req', id, method, args }, '*')
    })
  },
  /** Своя программа плагина (поле backend в launcher.json), отвечает JSON. */
  backend(...args) {
    return bb.call('backend', args)
  },
  /** События: 'context' (язык/иконка/цвет поменялись), 'download' (скачан файл в браузере). */
  on(name, cb) {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(cb)
  }
}
`

const icon = (letter: string, color: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="14" fill="${color}"/>
  <text x="32" y="44" font-family="Segoe UI, sans-serif" font-size="34" font-weight="800" text-anchor="middle" fill="#fff">${letter}</text>
</svg>
`

const manifest = (id: string, name: string, accent: string): string =>
  JSON.stringify(
    {
      id,
      name,
      version: '0.1.0',
      author: 'Я',
      description: 'Мой плагин для BigBuncher',
      entry: 'index.html',
      accent,
      icons: [{ key: 'main', name: 'Иконка', path: 'icon.svg' }]
    },
    null,
    2
  ) + '\n'

const BASE_CSS = `:root {
  --bg: #0d1117;
  --panel: #121920;
  --border: rgba(255, 255, 255, 0.08);
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #4cba4a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}
button {
  font: inherit;
  font-weight: 700;
  border: 0;
  border-radius: 10px;
  padding: 10px 18px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
button.ghost { background: transparent; color: var(--muted); }
button.ghost:hover, button.ghost.active { background: rgba(255, 255, 255, 0.06); color: var(--text); }
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 20px;
}
.muted { color: var(--muted); }
`

export const TEMPLATES: Record<string, Files> = {
  blank: ({ id, name }) => ({
    'launcher.json': manifest(id, name, '#4c8dff'),
    'icon.svg': icon(name.slice(0, 1).toUpperCase(), '#4c8dff'),
    'bridge.js': BRIDGE_JS,
    'style.css': BASE_CSS + `
main {
  height: 100vh;
  display: grid;
  place-items: center;
  text-align: center;
}
h1 { font-size: 48px; margin: 0 0 8px; }
`,
    'index.html': `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <div>
      <h1>${name}</h1>
      <p class="muted">Поменяй этот текст в index.html — BigBuncher сразу покажет изменения.</p>
      <button id="hello">Нажми меня</button>
      <p id="out" class="muted"></p>
    </div>
  </main>
  <script type="module" src="app.js"></script>
</body>
</html>
`,
    'app.js': `import { bb } from './bridge.js'

// Счётчик нажатий хранится в BigBuncher (getData/setData) и не пропадает после перезапуска.
const out = document.getElementById('out')
const data = await bb.call('getData')
let clicks = data.clicks ?? 0
out.textContent = \`Нажато: \${clicks}\`

document.getElementById('hello').onclick = async () => {
  clicks++
  await bb.call('setData', { clicks })
  out.textContent = \`Нажато: \${clicks}\`
}
`
  }),

  pages: ({ id, name }) => ({
    'launcher.json': manifest(id, name, '#4cba4a'),
    'icon.svg': icon(name.slice(0, 1).toUpperCase(), '#4cba4a'),
    'bridge.js': BRIDGE_JS,
    'style.css': BASE_CSS + `
.app { display: grid; grid-template-columns: 220px 1fr; height: 100vh; }
nav { padding: 20px 12px; border-right: 1px solid var(--border); display: grid; align-content: start; gap: 4px; }
nav .brand { font-size: 20px; font-weight: 800; padding: 0 8px 16px; }
nav button { text-align: left; }
section { display: none; padding: 32px; overflow: auto; }
section.active { display: block; }
h2 { margin-top: 0; }
.play { font-size: 20px; padding: 16px 40px; }
textarea { width: 100%; min-height: 160px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 10px; font: inherit; }
`,
    'index.html': `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="app">
    <nav>
      <div class="brand">${name}</div>
      <button class="ghost active" data-page="home">Главная</button>
      <button class="ghost" data-page="notes">Заметки</button>
      <button class="ghost" data-page="about">О плагине</button>
    </nav>
    <section id="home" class="active">
      <h2>Главная</h2>
      <div class="card">
        <p class="muted">Сюда можно поставить кнопку «Играть», новости, моды — что захочешь.</p>
        <button class="play" id="site">Открыть сайт игры</button>
      </div>
    </section>
    <section id="notes">
      <h2>Заметки</h2>
      <textarea id="note" placeholder="Пиши — сохранится само"></textarea>
    </section>
    <section id="about">
      <h2>О плагине</h2>
      <p class="muted" id="ctx"></p>
    </section>
  </div>
  <script type="module" src="app.js"></script>
</body>
</html>
`,
    'app.js': `import { bb } from './bridge.js'

// страницы
for (const b of document.querySelectorAll('nav [data-page]')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('nav [data-page]')) x.classList.toggle('active', x === b)
    for (const s of document.querySelectorAll('section')) s.classList.toggle('active', s.id === b.dataset.page)
  }
}

document.getElementById('site').onclick = () => bb.call('openExternal', 'https://www.minecraft.net')

// заметка сохраняется в BigBuncher
const note = document.getElementById('note')
note.value = (await bb.call('getData')).note ?? ''
let t
note.oninput = () => {
  clearTimeout(t)
  t = setTimeout(() => bb.call('setData', { note: note.value }), 400)
}

const ctx = await bb.call('context')
document.getElementById('ctx').textContent = \`id: \${ctx.launcherId}, язык: \${ctx.lang}, BigBuncher \${ctx.appVersion}\`
`
  })
}

export const TEMPLATE_LIST = [
  { id: 'blank', name: 'Пустой', description: 'Одна страница и кнопка — проще некуда' },
  { id: 'pages', name: 'Со страницами', description: 'Меню слева и несколько страниц, как в BigBuncher' }
]

export const PLUGIN_GUIDE = `# Как сделать плагин для BigBuncher

Этот файл можно целиком отдать ИИ (Claude, ChatGPT и т.п.) со словами
«сделай мне плагин для BigBuncher: <что хочешь>». Тут всё, что ему нужно знать.

## Что такое плагин

Плагин — это папка с веб-страницей. BigBuncher показывает её вместо своего интерфейса
(как лаунчеры других игр в «Дополнениях»). Делиться плагином — это zip этой папки.

    launcher.json   — описание (обязательно)
    index.html      — страница (имя задаётся в entry)
    bridge.js       — мост к BigBuncher (не меняй)
    style.css, app.js, картинки — что угодно

## launcher.json

    {
      "id": "my-plugin",            // латиница, цифры, - и _; 2–41 символ; НЕ "minecraft"
      "name": "Мой плагин",
      "version": "0.1.0",
      "author": "Ник",
      "description": "Что делает",
      "entry": "index.html",
      "accent": "#4cba4a",          // цвет плагина
      "icons": [{ "key": "main", "name": "Иконка", "path": "icon.svg" }],
      "backend": "MyTool.exe"       // необязательно: своя программа, отвечает JSON
    }

## Правила

1. **Изменения видны сразу.** BigBuncher следит за файлами плагина: сохранил html/css/js/json —
   страница перезагрузилась. Поэтому плагин должен сам восстанавливать своё состояние при
   загрузке (читать его через getData), а не держать важное только в памяти.
2. **Никакого доступа к ПК напрямую.** Страница работает в песочнице: нет Node.js, нет файлов.
   Всё — только через методы моста ниже. Других методов нет.
3. **Всё, что даёт плагин, должно работать и без него.** Плагин не ломает BigBuncher и игры:
   если его удалить, всё остальное работает как раньше.
4. **Пиши интерфейс по-русски** (язык игрока приходит в context.lang — можно добавить и другие).
5. **Никаких секретов, паролей и токенов** в файлах плагина — его будут пересылать друзьям.
6. **Не удаляй файлы игрока** безвозвратно и не трогай сейвы без спроса.
7. Стиль — тёмный, как у BigBuncher: фон #0d1117, карточки #121920, скругления 10–18px.
8. Всё в папке плагина, никаких ссылок на файлы вне её (кроме https-картинок).

## Мост (bridge.js)

    import { bb } from './bridge.js'
    const ctx = await bb.call('context')

| Метод | Что делает |
|---|---|
| context() | { launcherId, lang, icon, accent, appVersion } |
| getData() | объект, сохранённый плагином |
| setData(patch) | дописать поля в сохранённый объект |
| setAccent('#rrggbb' или '') | цвет плагина ('' — свой из launcher.json) |
| backend([...args]) | запустить свою программу (поле backend), она печатает JSON; {"error": "..."} = ошибка |
| pickFiles(title, ['zip','jar']) | выбрать файлы → массив путей |
| pickSaveFile(title, defaultName, ['zip']) | куда сохранить → путь или null |
| pickDirectory(title) | выбрать папку → путь или null |
| openPath(path) | открыть папку или .txt/.log/.json/.md |
| openExternal(url) | открыть http(s)-ссылку в браузере |
| openSteam(url) | только steam://validate/<id>, steam://store/<id>, steam://nav/games/details/<id> |
| setIcon(key) | выбрать иконку из icons |
| refreshIcons() | перечитать иконки (если плагин их создал/поменял) |
| switchLauncher(id) | переключиться на другой лаунчер ('minecraft' — назад) |
| gameStarted(gameFolder) | игра запущена: BigBuncher свернётся и запустит таймер игры; таймер спрашивает у backend \`status <gameFolder>\` → { running } |

События: \`bb.on('context', ({ lang, icon, accent }) => …)\`, \`bb.on('download', (file) => …)\` —
игрок скачал файл в браузере ({ path, fileName, ext, site, url }).

## Как проверить

В BigBuncher: «Дополнения» → «Редактор» → выбери плагин. Справа — живой предпросмотр,
слева — файлы. Сохраняй — предпросмотр обновится сам.
`
