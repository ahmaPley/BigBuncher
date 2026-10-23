import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Tiny synchronous JSON file store with atomic writes (write temp + rename).
 * Missing or corrupted files fall back to `defaults`.
 */
export class JsonStore<T extends object> {
  private data: T

  constructor(
    private readonly filePath: string,
    private readonly defaults: () => T
  ) {
    this.data = this.load()
  }

  get(): T {
    return this.data
  }

  set(next: T): T {
    this.data = next
    this.persist()
    return this.data
  }

  update(mutator: (draft: T) => T | void): T {
    const result = mutator(this.data)
    if (result) this.data = result
    this.persist()
    return this.data
  }

  private load(): T {
    try {
      if (existsSync(this.filePath)) {
        return { ...this.defaults(), ...JSON.parse(readFileSync(this.filePath, 'utf8')) }
      }
    } catch (err) {
      console.warn(`[store] cannot read ${this.filePath}, using defaults`, err)
    }
    return this.defaults()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }
}
