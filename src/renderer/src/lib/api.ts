import type { ExposedApi } from '../../../shared/ipc'

declare global {
  interface Window {
    bigbuncher: ExposedApi
  }
}

/** Typed bridge to the main process (see src/shared/ipc.ts). */
export const api: ExposedApi = window.bigbuncher
