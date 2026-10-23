import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yauzl from 'yauzl'

export interface PackMeta {
  description: string
  packFormat?: number
  iconDataUrl?: string
}

/** Reads the listed entries of a zip into memory (resource packs are small metadata-wise). */
function readZipEntries(file: string, names: string[]): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      const out: Record<string, Buffer> = {}
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!names.includes(entry.fileName)) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return zip.readEntry()
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            out[entry.fileName] = Buffer.concat(chunks)
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/** Minecraft text components can be strings, objects or arrays — flatten to plain text. */
function flattenText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/§./g, '')
  if (Array.isArray(value)) return value.map(flattenText).join('')
  if (value && typeof value === 'object') {
    const v = value as { text?: unknown; extra?: unknown }
    return flattenText(v.text ?? '') + flattenText(v.extra ?? '')
  }
  return ''
}

/** Description, pack_format and icon from a pack (.zip file or unpacked folder). */
export async function readPackMeta(path: string): Promise<PackMeta> {
  let mcmeta: Buffer | undefined
  let icon: Buffer | undefined
  try {
    if (statSync(path).isDirectory()) {
      mcmeta = readFileSync(join(path, 'pack.mcmeta'))
      icon = readFileSync(join(path, 'pack.png'))
    } else {
      const entries = await readZipEntries(path, ['pack.mcmeta', 'pack.png'])
      mcmeta = entries['pack.mcmeta']
      icon = entries['pack.png']
    }
  } catch {
    /* missing pieces are fine */
  }
  let description = ''
  let packFormat: number | undefined
  try {
    const json = JSON.parse((mcmeta ?? Buffer.from('{}')).toString('utf8').replace(/^﻿/, ''))
    description = flattenText(json.pack?.description)
    packFormat = json.pack?.pack_format
  } catch {
    /* malformed pack.mcmeta */
  }
  return { description, packFormat, iconDataUrl: icon ? `data:image/png;base64,${icon.toString('base64')}` : undefined }
}
