import { app } from 'electron'
import { join } from 'node:path'
import { getSettings } from '../settings/settingsService'

/** Launcher-private data: settings, accounts, skins. */
export const userDataDir = (): string => app.getPath('userData')

export const defaultGameDir = (): string => join(app.getPath('appData'), '.bigbuncher')

/** Shared Minecraft root: versions/, libraries/, assets/, runtime/. */
export const gameDir = (): string => getSettings().gameDir || defaultGameDir()

export const instancesDir = (): string => join(gameDir(), 'instances')

export const instanceDir = (id: string): string => join(instancesDir(), id)

export const javaRuntimeDir = (): string => join(gameDir(), 'runtime')

export const skinsDir = (): string => join(userDataDir(), 'skins')

export const authlibInjectorPath = (): string => join(gameDir(), 'bigbuncher', 'authlib-injector.jar')
