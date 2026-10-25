import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Keys that change on every run without changing what the data says. */
const VOLATILE = new Set(['generatedAt', 'retrievedAt', 'checkedAt'])

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !VOLATILE.has(k))
        .map(([k, v]) => [k, strip(v)]),
    )
  }
  return value
}

/** Numbers this close are the same result: Linux and macOS differ in the last digits of exp/log/pow. */
const REL_TOLERANCE = 1e-9

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || Math.abs(a - b) <= REL_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => k in b && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return a === b
}

/** True when the two JSON texts differ only in volatile timestamps or floating-point noise. */
export function sameIgnoringTimestamps(a: string, b: string): boolean {
  try {
    return sameValue(strip(JSON.parse(a)), strip(JSON.parse(b)))
  } catch {
    return a === b
  }
}

/**
 * Writes `text` unless the file already says the same thing apart from timestamps. Returns whether it wrote.
 * This keeps scheduled refreshes from creating a commit when nothing meaningful changed.
 */
export function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && sameIgnoringTimestamps(readFileSync(path, 'utf8'), text)) return false
  writeFileSync(path, text)
  return true
}
