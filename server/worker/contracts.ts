/**
 * The shapes the prices service promises. The tests run every response through these, so a change to the output that would break
 * the site (or any other reader) fails a test instead of reaching production. Version 1.
 */
export const API_VERSION = 1

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isIso = (v: unknown): boolean => typeof v === 'string' && Number.isFinite(Date.parse(v))
const isProb = (v: unknown): boolean => typeof v === 'number' && v >= 0 && v <= 1

export function isMarketResponse(v: unknown): boolean {
  if (!isObj(v) || !isIso(v.generatedAt) || typeof v.source !== 'string' || typeof v.attribution !== 'string' || !isObj(v.events) || !isObj(v.freshness)) return false
  const f = v.freshness
  if (!isIso(f.fetchedAt) || typeof f.ageHours !== 'number' || typeof f.stale !== 'boolean') return false
  return Object.values(v.events).every(
    (bouts) => isObj(bouts) && Object.values(bouts).every((b) => isObj(b) && isProb(b.pA) && isProb(b.pLo) && isProb(b.pHi) && Number.isInteger(b.books) && (b.books as number) > 0 && (b.pLo as number) <= (b.pA as number) && (b.pA as number) <= (b.pHi as number)),
  )
}

export function isPricesResponse(v: unknown): boolean {
  if (!isObj(v) || !isIso(v.generatedAt) || !isObj(v.events)) return false
  return Object.values(v.events).every(
    (points) => Array.isArray(points) && points.every((p) => isObj(p) && isIso(p.t) && isObj(p.bouts) && Object.values(p.bouts).every((b) => isObj(b) && isProb(b.pA) && Number.isInteger(b.books))),
  )
}

export interface Health {
  apiVersion: number
  status: 'ok' | 'degraded' | 'no-data'
  now: string
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  marketAgeHours: number | null
  quota: { remaining: string | null; used: string | null; lastCost: string | null }
}

export function isHealthResponse(v: unknown): v is Health {
  if (!isObj(v) || v.apiVersion !== API_VERSION || !['ok', 'degraded', 'no-data'].includes(v.status as string) || !isIso(v.now) || !isObj(v.quota)) return false
  const nullableIso = (x: unknown): boolean => x === null || isIso(x)
  return nullableIso(v.lastSuccessAt) && nullableIso(v.lastAttemptAt) && (v.lastError === null || typeof v.lastError === 'string') && (v.marketAgeHours === null || typeof v.marketAgeHours === 'number')
}

/** Every error body has this shape. */
export function isErrorResponse(v: unknown): boolean {
  return isObj(v) && typeof v.error === 'string' && v.error.length > 0
}
