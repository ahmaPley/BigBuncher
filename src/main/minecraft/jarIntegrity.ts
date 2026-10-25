import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yauzl from 'yauzl'

/**
 * A download cut off halfway leaves a jar that exists but cannot be opened (e.g. a Forge
 * installer → "invalid local file header signature"). The installers trust files that are
 * already there, so such a jar breaks every install until it is removed. These helpers find
 * and delete broken jars (download cache only — never player data) so the retry re-downloads them.
 */

/** Opens the zip and touches the local header of every entry. */
function isZipReadable(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return resolve(false)
      let ok = true
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) {
            ok = false
            zip.close()
            return resolve(false)
          }
          stream.on('error', () => undefined)
          stream.destroy()
          zip.readEntry()
        })
      })
      zip.on('end', () => resolve(ok))
      zip.on('error', () => resolve(false))
      zip.readEntry()
    })
  })
}

function jarsIn(dir: string, since: number, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) jarsIn(p, since, out)
    else if (name.endsWith('.jar') && st.mtimeMs >= since) out.push(p)
  }
  return out
}

/** Deletes unreadable jars under the given folders that changed after `since`; returns their paths. */
export async function removeCorruptJars(dirs: string[], since: number): Promise<string[]> {
  const removed: string[] = []
  for (const dir of dirs) {
    for (const jar of jarsIn(dir, since)) {
      if (await isZipReadable(jar)) continue
      rmSync(jar, { force: true })
      removed.push(jar)
    }
  }
  if (removed.length) console.warn('[install] removed corrupt downloads:', removed)
  return removed
}

/** True for errors caused by a damaged archive. */
export const isCorruptArchiveError = (err: unknown): boolean =>
  err instanceof AggregateError
    ? err.errors.some(isCorruptArchiveError)
    : /local file header|central directory|end of central|zip file|ZipException|invalid (?:code|distance|stored block)|unexpected end of file|corrupt/i.test(String(err instanceof Error ? err.message : err))
