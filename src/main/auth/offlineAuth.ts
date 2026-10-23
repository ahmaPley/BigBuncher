import { createHash } from 'node:crypto'

const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

export function validateOfflineName(name: string): string {
  const trimmed = name.trim()
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error('Ник: 3–16 символов, только латиница, цифры и _')
  }
  return trimmed
}

/** Same UUID the vanilla server assigns offline players: v3 of "OfflinePlayer:<name>". */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  return hash.toString('hex')
}
