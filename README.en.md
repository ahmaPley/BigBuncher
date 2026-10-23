# BigBuncher

A Minecraft: Java Edition launcher for Windows. Electron + React + TypeScript.

[Русская версия](README.md)

![concept](assets/01_launcher/launcher_main_screen.png)

## Features

- Launch any Minecraft Java Edition version (releases and snapshots from Mojang's manifest).
- Install versions with automatic **Forge, Fabric, NeoForge and Quilt** installation.
- Instances: each one has its own mods, worlds and configs; versions, libraries and assets are shared.
- **Multi-packs**: several states of one instance (a copy with other mods, or another version), switched in one click.
- Mod catalog from **Modrinth** (no key needed) and **CurseForge** (free API key) with search, required dependencies,
  enable/disable and removal.
- **Resource packs**: shared packs for every instance (auto-enabled even on other versions) plus per-instance packs.
- **Skins**: library, PNG import, copy by player name, export, and an editor with two modes —
  **Body** (paint directly on the 3D model) and **Texture** (flat layout). A panel in the top-left corner hides any body part
  or overlay layer. Brush, picker, spray, fill, dithering, darken/lighten/invert, colour replace, eraser, symmetry,
  grid, zoom, palette with import/export.
- The player's skin on a 3D model on the home screen.
- Skins work **in game even without a Microsoft login**: the launcher runs a local Yggdrasil server and loads
  `authlib-injector`. For Microsoft accounts the skin is uploaded to the Mojang profile.
- Microsoft login (Xbox Live → Minecraft Services) and offline mode.
- Automatic Java download (official Mojang runtimes) or a custom Java.
- RAM, Java, game folder, resolution and JVM argument settings, all persisted.
- **Auto-update** through GitHub Releases: the launcher offers new versions itself.

The UI is in Russian.

## Download

Grab `BigBuncher.exe` from [Releases](https://github.com/ahmaPley/BigBuncher/releases/latest). It is a portable
single file, no installation. Windows SmartScreen may warn because the exe is unsigned: *More info → Run anyway*.

Data locations:
- settings, accounts, skins: `%APPDATA%\BigBuncher\`
- game files (versions, libraries, Java, instances): `%APPDATA%\.bigbuncher\` (configurable)

## Development

Requirements: Node.js 20+ (tested on 24), Windows 10/11. Python 3 + Pillow only to regenerate images.

```bash
npm install          # dependencies
npm run dev          # run with hot reload
npm run typecheck    # type check
npm run build        # build into out/
npm run dist         # build release/BigBuncher.exe
npm run release      # build and publish a GitHub release (bump "version" in package.json first)
```

Checks:

```bash
# end-to-end: real downloads and a real game launch, temporary settings folder
BIGBUNCHER_SMOKE=1 BIGBUNCHER_SMOKE_LOADERS=fabric,forge,neoforge,quilt BIGBUNCHER_SMOKE_LAUNCH=fabric npx electron .
# multi-packs, resource packs, update check (no game launch)
BIGBUNCHER_SMOKE=features npx electron .
# screenshot of a page (#skins/new opens the skin editor)
BIGBUNCHER_PAGE=skins BIGBUNCHER_CAPTURE=shot.png npx electron .
```

## Documentation (Russian)

- [ARCHITECTURE.md](ARCHITECTURE.md): project structure and how modules interact.
- [AGENTS.md](AGENTS.md): rules for AI agents and contributors.

## Credits

Made by TambiStudio (ahmaPley), built with Claude. Not affiliated with Mojang or Microsoft.
Uses [authlib-injector](https://github.com/yushijinhun/authlib-injector), [skinview3d](https://github.com/bs-community/skinview3d)
and [@xmcl](https://github.com/Voxelum/minecraft-launcher-core-node).
