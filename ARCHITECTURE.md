# Архитектура BigBuncher

## Процессы

```
┌──────────────────────────┐   window.bigbuncher.*    ┌───────────────────────────┐
│ Renderer (React, src/    │ ───── ipc invoke ──────▶ │ Main (Node, src/main)     │
│ renderer) — только UI    │ ◀──── push events ────── │ вся логика, сеть, файлы   │
└──────────────────────────┘      (event:<name>)      └───────────────────────────┘
              ▲                                                    │
              └──────── src/shared: типы + контракт IPC ───────────┘
```

- **Renderer** не имеет доступа к Node. Всё делает через `window.bigbuncher`, который строит preload.
- **Main** состоит из независимых сервисов. Каждый сервис отвечает за одну область.
- **Shared** содержит только типы и список методов; рантайм-зависимостей нет.

## Контракт IPC (`src/shared/ipc.ts`)

Единственный источник правды:

1. `BigBuncherApi` — интерфейс всех методов, сгруппированных по пространствам имён (`accounts`, `instances`, `mods`…).
2. `API_METHODS` — те же методы списком; preload (`src/preload/index.ts`) превращает каждый в `ipcRenderer.invoke('ns:method')`.
3. `src/main/ipc.ts` — объект `handlers: BigBuncherApi`, связывающий методы с сервисами. TypeScript не даст пропустить метод.
4. Ответ main всегда `{ ok, value } | { ok: false, error }`, поэтому текст ошибки доходит до UI без искажений.
5. `AppEvents` — push-события из main (`task`, `game`, `gameLog`, `accountsChanged`, `instancesChanged`, `settingsChanged`). Отправляются через `core/events.ts → emit()`.

## Main: модули

```
src/main/
├── index.ts                 окно, single-instance, режимы smoke/capture
├── ipc.ts                   привязка контракта к сервисам
├── core/                    общая инфраструктура, без доменной логики
│   ├── events.ts            emit() в окна + onAppEvent() для кода main
│   ├── http.ts              fetchJson / postJson / downloadFile (User-Agent, HttpError)
│   ├── downloadAgent.ts     пул соединений + повторы для загрузки файлов игры
│   ├── jsonStore.ts         атомарное JSON-хранилище
│   ├── paths.ts             все пути (gameDir, instances, runtime, skins)
│   └── tasks.ts             runTask(): долгие операции с прогрессом в UI
├── settings/settingsService.ts     настройки + валидация
├── auth/
│   ├── microsoftAuth.ts     OAuth окно → XBL → XSTS → Minecraft Services
│   ├── offlineAuth.ts       валидация ника, offline UUID (как у ванильного сервера)
│   └── accountService.ts    хранение аккаунтов, safeStorage для refresh token, обновление токенов
├── minecraft/
│   ├── versionService.ts    манифест Mojang, версии загрузчиков
│   ├── javaService.ts       подбор/скачивание Java (рантаймы Mojang), поиск установленных
│   ├── installService.ts    ваниль → Java → загрузчик → библиотеки/ассеты
│   └── launchService.ts     сборка параметров запуска, процесс игры, логи, скины
├── loaders/                 по файлу на загрузчик, общий интерфейс ModLoader
│   ├── types.ts             interface ModLoader
│   ├── index.ts             реестр загрузчиков
│   ├── fabricLoader.ts  quiltLoader.ts  forgeLoader.ts  neoforgeLoader.ts
│   └── taskProgress.ts      прогресс задач @xmcl → TaskReporter
├── instances/
│   ├── instanceService.ts   сборки: создание, установка (очередь), переименование, удаление в Корзину
│   └── multiPackService.ts  мультисборки: группы сборок-«состояний», клон/новое состояние, переключение
├── resourcepacks/
│   ├── resourcePackService.ts  общие паки (<gameDir>/shared/resourcepacks) + паки сборки, синхронизация перед запуском
│   └── packReader.ts        pack.mcmeta / pack.png из zip
├── updates/updateService.ts автообновление portable-exe через GitHub Releases
├── mods/
│   ├── modService.ts        поиск, установка с зависимостями, вкл/выкл, удаление, индекс модов
│   └── providers/           interface ModProvider + modrinthProvider, curseforgeProvider
├── skins/
│   ├── skinLibrary.ts       PNG-файлы + индекс (имя, модель)
│   ├── skinService.ts       импорт (файл/ник), сохранение, экспорт, применение, подготовка инъекции
│   ├── yggdrasilServer.ts   локальный Yggdrasil-сервер (API authlib-injector), подписанные текстуры
│   └── authlibInjector.ts   скачивание authlib-injector.jar
├── news/newsService.ts      патчноуты Java Edition из ленты лаунчера Mojang
├── system/systemService.ts  окно, диалоги, внешние ссылки
└── devtools/smokeTest.ts    сквозной тест на реальных сервисах
```

### Ключевые потоки

**Создание сборки:** `instances.create` → запись в `instances.json` → `installInstance` → `runTask` →
`installInstanceVersion`: `installVersionTask` (json+jar) → `ensureJava` (по `javaVersion.component` версии) →
`ModLoader.install` (Forge/NeoForge запускают процессоры инсталлера этой Java) → `installDependenciesTask` (библиотеки, ассеты, нативы).
Повторный вызов докачивает только недостающее, поэтому это же и «восстановить файлы».

**Запуск:** `game.launch` → если сборка не установлена, ставит её → `ensureJava` → `getLaunchCredentials`
(обновляет токен Microsoft при необходимости) → `prepareSkinInjection` → `launch()` из `@xmcl/core` →
stdout/stderr уходят в событие `gameLog`, состояние в `game`.

**Скин в игре без Microsoft:**
1. Офлайн-аккаунту назначен скин из библиотеки (`skins.applyToAccount`).
2. При запуске `yggdrasilServer` стартует на `127.0.0.1:<свободный порт>` с RSA-ключом, сгенерированным на старте, и регистрирует профиль (uuid, ник, PNG, модель).
3. Игра запускается с `-javaagent:authlib-injector.jar=<сервер>` и prefetched-метаданными. authlib-injector перенаправляет запросы authlib к Mojang на локальный сервер.
4. Игра запрашивает `/sessionserver/session/minecraft/profile/<uuid>`; сервер отдаёт свойство `textures`, подписанное своим ключом, и PNG по `/textures/<sha256>`. Игра видит скин как настоящий.
Microsoft-аккаунты инъекцию не используют (иначе сломается вход на онлайн-серверы); их скин загружается в профиль Mojang через API.

**Моды:** `ModProvider.search` (фильтр по версии MC и загрузчику; Quilt видит и Fabric-моды) →
`resolveFile` (последний совместимый файл + обязательные зависимости) → загрузка в `instances/<id>/mods` →
`bigbuncher-mods.json` хранит происхождение файла (иконка, версия, проект). Отключение = суффикс `.disabled`.

## Renderer: модули

```
src/renderer/src/
├── main.tsx                 точка входа, стили
├── App.tsx                  каркас + реестр страниц PAGES
├── lib/
│   ├── api.ts               типизированный window.bigbuncher
│   ├── appState.tsx         глобальное состояние: подписки на события, навигация, тосты, run()
│   ├── assets.ts            картинки (фоны, блоки, логотип), подписи загрузчиков
│   └── format.ts            форматирование чисел/дат/ошибок
├── components/              переиспользуемые UI-элементы
│   ├── ui.tsx               Button, Toggle, Progress, Segmented, Modal, Dropdown, BlockIcon, EmptyState
│   ├── Icon.tsx             набор SVG-иконок
│   ├── Sidebar, TitleBar, Toasts, AccountsModal, InstancePicker, PlayButton
│   ├── SkinViewer.tsx       3D-модель (skinview3d)
│   ├── SkinHead.tsx, SkinFront.tsx  2D-превью скина
│   ├── SkinEditor.tsx       оболочка редактора скинов (панель инструментов, палитра, настройки)
│   └── skinEditor/          ядро редактора:
│       ├── skinLayout.ts    раскладка 64x64: части тела, слои, зеркалирование для симметрии
│       ├── paintTools.ts    инструменты над ImageData (кисть, спрей, заливка, дизеринг, тени, замена цвета)
│       ├── useSkinDocument.ts  холст-документ, история отмены, блокировка скрытых слоёв
│       ├── TextureView.tsx  режим «Текстура» (2D развёртка)
│       ├── ModelView.tsx    режим «Тело»: рисование по 3D-модели (raycast → UV → пиксель)
│       ├── PartToggles.tsx  панель слоёв слева сверху
│       └── palette.ts       палитра (localStorage)
├── pages/                   по файлу на вкладку: Home, Install, Instances, Mods, ResourcePacks, Skins, Settings
└── styles/                  tokens.css (дизайн-токены), base.css, components.css, pages.css
```

Состояние: всё живое (настройки, аккаунты, сборки, задачи, логи) приходит из main через события в `appState.tsx`.
Страницы держат только локальное состояние формы. Любой вызов API со всплывающей ошибкой: `run(() => api.x.y())`.

## Ассеты

`assets/` — исходный концепт-борд (не трогаем). `scripts/prepare_assets.py` режет из него фоны и иконки блоков в
`src/renderer/src/assets/img/` и рисует логотип/иконку приложения в `build/icon.png|ico`.

### Мультисборки

`MultiPack` (userData/multipacks.json) = имя + `activeStateId`. Каждое состояние — обычный `Instance` с `multiPackId`
и `stateName`, со своей папкой. «Копия текущего» копирует папку активного состояния (без логов, миры по желанию),
«Другая версия» создаёт и устанавливает новую сборку. Переключение = смена `activeStateId` + `selectedInstanceId`.

### Текстурпаки

Общие паки лежат в `<gameDir>/shared/resourcepacks`. Перед каждым запуском `syncSharedPacksIntoInstance` делает
жёсткие ссылки в `<instance>/resourcepacks` (список в `.bigbuncher-shared.json`) и для паков с «Авто» дописывает
`file/<pack>` в `resourcePacks` и `incompatibleResourcePacks` в options.txt, чтобы паки других версий включались без вопросов.

### Обновления

`updateService` раз в 6 часов читает `api.github.com/repos/ahmaPley/BigBuncher/releases/latest`. Если тег новее
`app.getVersion()`, в боковой панели появляется баннер. Установка: exe скачивается в userData/update, cmd-скрипт ждёт
выхода лаунчера, копирует файл поверх `PORTABLE_EXECUTABLE_FILE` и запускает его. Публикация: `npm run release`
(поднять `version` в package.json → сборка → `scripts/publish-release.ps1`).

### Доктор крашей (`src/main/diagnostics/`)

- `jarScanner.ts` — читает jar модов (fabric.mod.json, quilt.mod.json, mods.toml, neoforge.mods.toml, jar-in-jar) и
  пакеты классов; статическая проверка: не тот загрузчик, дубли id, нет зависимости, битый архив. `jarOfClass` /
  `jarOfModId` связывают строку стектрейса с jar.
- `crashAnalyzer.ts` — чистые правила `(ctx) => Problem[]`: сообщения Fabric/Quilt и Forge/NeoForge о зависимостях,
  Java, память, JVM-аргументы, Vulkan, повреждённые файлы игры, битые конфиги, миксины, «Suspected Mods», стектрейс,
  драйверы; `analyzeDisconnect` — причины отключения от сервера. Новое правило = функция в `RULES`.
- `crashDoctor.ts` — сессия игры (строки stdout, адрес сервера), разбор после выхода (`latest.log` + crash-report +
  `hs_err_pid*.log`), live-ловля фатальных ошибок загрузчика (Fabric держит окно ошибки, Forge — экран ошибки:
  игра закрывается сама через 4 с), `preflight` перед запуском, `applyFixes` (исправления + перезапуск),
  автопоиск виновника `startBisect` (запуски с половиной подозреваемых модов + их зависимости; моды всегда
  возвращаются как были). События: `diagnosis`, `bisect`.

### Графика (`minecraft/graphicsService.ts`)

Версии с `net/minecraft/client/PreferredGraphicsApi.class` в jar (26.2+) получают `--graphicsBackend vulkan|opengl`
(значения options.txt `preferredGraphicsBackend`: default/opengl/vulkan). `Settings.graphicsApi`: ask (UI спрашивает
перед запуском), auto (драйвер Vulkan в реестре + не старая видеокарта), vulkan, opengl.

### Режим разработчика (`dev/devService.ts`)

`DevProfile` на сборку (userData/devprofiles.json): папка Gradle-проекта, задача, автокопирование (fs.watch на
`build/libs`, в т.ч. подпроекты fabric/forge/neoforge), JDWP, mixin-флаги, quick play. `devLaunchArgs` добавляет
аргументы JVM/игры только при `Settings.devMode`. Деплой заменяет прошлый скопированный jar (это копия артефакта
сборки, не данные игрока).

## Точки расширения

| Что добавить | Где |
|---|---|
| Новый загрузчик | реализовать `ModLoader` в `src/main/loaders/`, добавить в `loaders/index.ts` и в `LoaderId` |
| Новая площадка модов | реализовать `ModProvider`, добавить в `PROVIDERS` в `mods/modService.ts` и в `ModProviderId` |
| Новый метод API | `BigBuncherApi` + `API_METHODS` в `shared/ipc.ts` → реализация в сервисе → `handlers` в `main/ipc.ts` |
| Новое push-событие | `AppEvents` в `shared/ipc.ts` → `emit()` в main → подписка в `appState.tsx` |
| Новая вкладка | страница в `pages/`, `PageId` + `PAGES` в `App.tsx`, пункт в `Sidebar.tsx` |
| Новая настройка | поле в `Settings` + значение по умолчанию и валидация в `settingsService.ts` + UI в `SettingsPage.tsx` |

## Зависимости

| Пакет | Зачем |
|---|---|
| `@xmcl/core`, `@xmcl/installer`, `@xmcl/task` | разбор версий, запуск, установщики Minecraft/Forge/NeoForge/Fabric/Quilt/Java. **Версии закреплены**: installer 6.1.2 (в 6.3.x API переписан, а `@xmcl/unzip@2.2.0` опубликован с битой зависимостью `workspace:`) |
| `undici` 6.21.3 | диспетчер загрузок для @xmcl (8 соединений, повторы). Закреплён через `overrides`: @xmcl 6.1.2 вызывает `throwOnError`, которого нет в undici 7 |
| `skinview3d`, `three` 0.156.1 | 3D-модель игрока; `three` напрямую — raycast для рисования по модели (версия = та, что у skinview3d) |
| `yauzl` | чтение pack.mcmeta из zip текстурпаков, метаданных модов (Доктор крашей) и проверка jar версии на выбор графики |
| `react`, `react-dom` | UI |
| `@fontsource-variable/inter` | шрифт Inter с кириллицей офлайн |
| `electron`, `electron-vite`, `electron-builder`, `vite`, `typescript` | сборка |
