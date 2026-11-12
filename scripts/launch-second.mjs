// Starts one more Minecraft next to a game already running from BigBuncher (the launcher allows one).
// Usage: node scripts/launch-second.mjs <instanceId> <playerName> [maxRamMb]
import { launch } from '@xmcl/core'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [instanceId, name, ram = '4096'] = process.argv.slice(2)
if (!instanceId || !name) throw new Error('usage: node scripts/launch-second.mjs <instanceId> <playerName> [maxRamMb]')
const appData = process.env.APPDATA
const settings = JSON.parse(readFileSync(join(appData, 'BigBuncher', 'settings.json'), 'utf8'))
const gameDir = settings.gameDir || join(appData, '.bigbuncher')
const instance = JSON.parse(readFileSync(join(appData, 'BigBuncher', 'instances.json'), 'utf8')).instances.find((i) => i.id === instanceId)
if (!instance) throw new Error(`no instance ${instanceId}`)
const versionJson = JSON.parse(readFileSync(join(gameDir, 'versions', instance.mcVersion, `${instance.mcVersion}.json`), 'utf8'))
const component = versionJson.javaVersion?.component ?? 'jre-legacy'
// offline UUID the same way Minecraft does: md5("OfflinePlayer:" + name), version 3
const md5 = createHash('md5').update(`OfflinePlayer:${name}`).digest()
md5[6] = (md5[6] & 0x0f) | 0x30
md5[8] = (md5[8] & 0x3f) | 0x80
const uuid = md5.toString('hex')

const child = await launch({
  gamePath: join(gameDir, 'instances', instanceId),
  resourcePath: gameDir,
  javaPath: join(gameDir, 'runtime', component, 'bin', 'javaw.exe'),
  version: instance.versionId,
  gameProfile: { name, id: uuid },
  accessToken: uuid,
  userType: 'legacy',
  launcherName: 'BigBuncher',
  launcherBrand: 'BigBuncher',
  minMemory: 1024,
  maxMemory: Number(ram),
  resolution: { width: 1280, height: 720 },
  extraExecOption: { detached: true, stdio: 'ignore' }
})
child.unref()
console.log(`started ${instance.name} (${instance.versionId}) as ${name}, pid ${child.pid}`)
