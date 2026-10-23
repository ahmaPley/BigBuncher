import { createWriteStream, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'

export const USER_AGENT = `TambiStudio/BigBuncher/${app.getVersion()} (github.com/ahmaPley)`

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`HTTP ${status} при запросе ${url}`)
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT)
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''))
  return res
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return (await request(url, init)).json() as Promise<T>
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

export async function fetchBuffer(url: string, init: RequestInit = {}): Promise<Buffer> {
  return Buffer.from(await (await request(url, init)).arrayBuffer())
}

/** Streams a file to disk (via a .part file), reporting bytes as they arrive. */
export async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  const res = await request(url)
  if (!res.body) throw new Error(`Пустой ответ от ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  mkdirSync(dirname(destination), { recursive: true })
  const part = `${destination}.part`
  const source = Readable.fromWeb(res.body as never)
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress?.(received, total)
  })
  await pipeline(source, createWriteStream(part))
  renameSync(part, destination)
}
