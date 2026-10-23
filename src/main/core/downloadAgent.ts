import { Agent, interceptors, type Dispatcher } from 'undici'

/**
 * Shared HTTP dispatcher for game file downloads (@xmcl installers).
 * The installers queue thousands of files at once; a small connection pool with a long
 * connect timeout and automatic retries avoids the "Connect Timeout" storms that Mojang's
 * CDN produces under that load (especially on slower or filtered networks).
 */
export const downloadDispatcher: Dispatcher = new Agent({
  connections: 8,
  connect: { timeout: 30_000 },
  headersTimeout: 60_000,
  bodyTimeout: 120_000
}).compose(
  interceptors.retry({
    maxRetries: 5,
    minTimeout: 1_000,
    maxTimeout: 15_000,
    errorCodes: ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET']
  }),
  interceptors.redirect({ maxRedirections: 5 })
)

/** Options spread into every @xmcl install task. */
export const downloadOptions = { dispatcher: downloadDispatcher }

/**
 * Re-runs a resumable install step when it fails with network errors.
 * Already downloaded files are verified by checksum and skipped on the next attempt.
 */
export async function withRetries<T>(attempts: number, step: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await step(attempt)
    } catch (err) {
      lastError = err
      console.warn(`[download] attempt ${attempt}/${attempts} failed`, err instanceof AggregateError ? `${err.errors.length} errors` : err)
    }
  }
  throw summarize(lastError)
}

/** Flattens nested AggregateErrors into the leaf errors. */
function leafErrors(err: unknown): unknown[] {
  return err instanceof AggregateError ? err.errors.flatMap(leafErrors) : [err]
}

/** Short name of the file an xmcl download error refers to (url or destination), if any. */
function failedFileName(err: unknown): string | undefined {
  const e = err as { url?: string; destination?: string; message?: string }
  const source = e?.url ?? e?.destination ?? e?.message?.match(/https?:\/\/\S+/)?.[0]
  return source?.split(/[\\/]/).filter(Boolean).pop()?.replace(/[)(.,]+$/, '')
}

function summarize(err: unknown): Error {
  const errors = leafErrors(err)
  if (errors.length <= 1 && !(err instanceof AggregateError)) return err instanceof Error ? err : new Error(String(err))
  const files = [...new Set(errors.map(failedFileName).filter(Boolean))].slice(0, 3)
  const first = errors[0] instanceof Error ? (errors[0] as Error).message : String(errors[0])
  return new Error(
    `Не удалось скачать ${errors.length} файл(ов)${files.length ? `: ${files.join(', ')}` : ''}. ` +
      `Скорее всего, сервер медленно отвечает — нажмите «Восстановить» (гаечный ключ) у сборки, уже скачанное не потеряется. ` +
      `Причина: ${first.slice(0, 200)}`
  )
}
