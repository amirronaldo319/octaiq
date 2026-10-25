import type { Fighter } from '../../src/engine/types.ts'
import { buildNameIndex } from './names.ts'

export interface FighterResult {
  fighters: Fighter[]
  warnings: string[]
}

/** Resolves stats for the given fighter names (names come from the odds feed). */
export type FighterProvider = (names: string[]) => Promise<FighterResult>

/**
 * Ask `primary` first (e.g. your hand-curated CSV), then ask `fallback` only for
 * the names the primary did not cover, so API quota is spent only where needed.
 */
export function combineProviders(primary: FighterProvider, fallback: FighterProvider | null): FighterProvider {
  return async (names) => {
    const first = await primary(names)
    if (!fallback) return first
    const known = buildNameIndex(first.fighters, (f) => f.name)
    const remaining = names.filter((n) => !known.find(n))
    if (remaining.length === 0) return first
    const second = await fallback(remaining)
    return {
      fighters: [...first.fighters, ...second.fighters],
      warnings: [...first.warnings, ...second.warnings],
    }
  }
}
