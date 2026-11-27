import { locale } from './i18nDom'

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} млн`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')} тыс`
  return String(n)
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

export function formatDate(iso: string | number): string {
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
}

/** 3 ч 20 мин / 45 мин / меньше минуты */
export function formatPlaytime(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'меньше минуты'
  const h = Math.floor(min / 60)
  return h ? `${h} ч ${min % 60} мин` : `${min} мин`
}

export function formatRam(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} ГБ` : `${mb} МБ`
}

export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Electron prefixes IPC errors with "Error invoking remote method ...: Error: "
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
