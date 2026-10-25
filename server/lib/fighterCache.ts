import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Fighter } from '../../src/engine/types.ts'

export interface CacheEntry {
  at: number
  /** null records a confirmed miss so we do not spend quota re-searching */
  fighter: Fighter | null
}

export interface FighterCache {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
}

export function createMemoryCache(): FighterCache {
  const map = new Map<string, CacheEntry>()
  return { get: (k) => map.get(k), set: (k, v) => void map.set(k, v) }
}

export function createFileCache(path: string): FighterCache {
  let data: Record<string, CacheEntry> = {}
  try {
    if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, CacheEntry>
  } catch {
    data = {}
  }
  return {
    get: (k) => data[k],
    set(k, v) {
      data[k] = v
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(data))
      } catch {
        // Read-only filesystem: the in-memory copy still serves this run.
      }
    },
  }
}
