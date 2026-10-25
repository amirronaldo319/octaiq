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

/** True when the two JSON texts differ only in volatile timestamp fields. */
export function sameIgnoringTimestamps(a: string, b: string): boolean {
  try {
    return JSON.stringify(strip(JSON.parse(a))) === JSON.stringify(strip(JSON.parse(b)))
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
