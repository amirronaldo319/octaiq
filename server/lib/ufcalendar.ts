import type { Fighter } from '../../src/engine/types.ts'
import { inferStyle } from './csv.ts'
import type { FighterCache } from './fighterCache.ts'
import { normalizeName, sameName, slugify } from './names.ts'
import type { FighterProvider } from './providers.ts'

/**
 * Adapter for the UFCalendar fight API (https://api.ufcalendar.com/docs).
 * Field names below follow its OpenAPI 3.1 spec (v1.3.0): Fighter, StatsPanel, HistoryEntry.
 */
export const BASE_URL = 'https://api.ufcalendar.com/v1'
const POSITIVE_TTL_MS = 7 * 86_400_000
const NEGATIVE_TTL_MS = 86_400_000
const CONCURRENCY = 4
const STAT_KEYS = ['slpm', 'str_acc', 'str_def', 'td_avg', 'td_def', 'sub_avg'] as const
type StatKey = (typeof STAT_KEYS)[number]

export interface ApiFighter {
  id: number
  slug: string
  name: string
  reach_inches: number | null
  dob: string | null
  records?: Record<string, { value: string }>
  stats:
    | ({ values?: Partial<Record<StatKey, number | null>>; sapm?: string | null; td_acc?: string | null } & Partial<
        Record<StatKey, string | null>
      >)
    | null
  last_fight: { date: string | null } | null
}

export interface ApiHistoryRow {
  status: string
  method_normalized: string | null
}

const FINISHES = new Set(['ko_tko', 'submission', 'technical_submission'])

/** Accepts a number or a display string such as "1.34" or "42%". */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const n = Number(v.replace('%', '').trim())
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n
}

/** Accepts 0.55 or 55 and returns 0.55. */
const fraction = (v: number): number => Math.min(1, Math.max(0, v > 1 ? v / 100 : v))
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function stat(profile: ApiFighter, key: StatKey): number | undefined {
  return toNumber(profile.stats?.values?.[key]) ?? toNumber(profile.stats?.[key])
}

interface Derived {
  finishRate: number
  chin: number
}

/** Career-history heuristics, shrunk toward neutral for small samples. */
export function deriveFromHistory(rows: readonly ApiHistoryRow[]): Derived {
  const wins = rows.filter((r) => r.status === 'win')
  const losses = rows.filter((r) => r.status === 'loss')
  const finishWins = wins.filter((r) => r.method_normalized && FINISHES.has(r.method_normalized)).length
  const koLosses = losses.filter((r) => r.method_normalized === 'ko_tko').length
  const decided = wins.length + losses.length
  return {
    finishRate: (finishWins + 1.5) / (wins.length + 3),
    chin: clamp(0.8 - 2 * (koLosses / (decided + 4)), 0.2, 0.9),
  }
}

/** Returns null when a required stat is absent, so callers can treat the fighter as unknown. */
export function mapProfile(profile: ApiFighter, history: readonly ApiHistoryRow[] | null, now: Date): Fighter | null {
  const slpm = stat(profile, 'slpm')
  const strAcc = stat(profile, 'str_acc')
  const strDef = stat(profile, 'str_def')
  const tdAvg = stat(profile, 'td_avg')
  const tdDef = stat(profile, 'td_def')
  if ([slpm, strAcc, strDef, tdAvg, tdDef].some((v) => v === undefined)) return null

  const subAvg = stat(profile, 'sub_avg') ?? 0.3
  const dob = Date.parse(profile.dob ?? '')
  const lastFight = Date.parse(profile.last_fight?.date ?? '')
  const derived = history && history.length > 0 ? deriveFromHistory(history) : { finishRate: 0.5, chin: 0.65 }
  const record = profile.records?.pro_mma?.value ?? Object.values(profile.records ?? {})[0]?.value

  return {
    id: slugify(profile.name),
    name: profile.name,
    record: record ?? '—',
    age: Number.isNaN(dob) ? 30 : Math.floor((now.getTime() - dob) / (365.25 * 86_400_000)),
    reachCm: profile.reach_inches ? Math.round(profile.reach_inches * 2.54) : 180,
    style: inferStyle(slpm as number, tdAvg as number, subAvg),
    slpm: slpm as number,
    strikeAcc: fraction(strAcc as number),
    strikeDef: fraction(strDef as number),
    tdPer15: tdAvg as number,
    tdDef: fraction(tdDef as number),
    subPer15: subAvg,
    finishRate: derived.finishRate,
    chin: derived.chin,
    // No source for cardio; override it in your CSV if you have a view.
    cardio: 0.75,
    layoffDays: Number.isNaN(lastFight) ? 300 : Math.max(0, Math.floor((now.getTime() - lastFight) / 86_400_000)),
  }
}

type FailureKind = 'notfound' | 'auth' | 'quota' | 'other'

class ApiError extends Error {
  readonly kind: FailureKind
  constructor(kind: FailureKind) {
    super(kind)
    this.kind = kind
  }
}

export interface UfcalendarDeps {
  apiKey: string
  fetchImpl: typeof fetch
  cache: FighterCache
  now?: () => number
}

export function createUfcalendarProvider(deps: UfcalendarDeps): FighterProvider {
  const now = deps.now ?? Date.now

  async function get<T>(path: string): Promise<T> {
    let res: Response
    try {
      res = await deps.fetchImpl(`${BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${deps.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ApiError('other')
    }
    if (res.status === 404) throw new ApiError('notfound')
    if (res.status === 401 || res.status === 403) throw new ApiError('auth')
    if (res.status === 429) throw new ApiError('quota')
    if (!res.ok) throw new ApiError('other')
    return ((await res.json()) as { data: T }).data
  }

  async function findProfile(name: string): Promise<ApiFighter | null> {
    const bySlug = await get<ApiFighter>(`/fighters/${encodeURIComponent(slugify(name))}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.kind === 'notfound') return null
      throw e
    })
    // Guard against a slug that resolves to a different person.
    if (bySlug && sameName(bySlug.name, name)) return bySlug

    const hits = await get<{ slug: string; name: string }[]>(`/fighters?q=${encodeURIComponent(name)}&limit=5`)
    const hit = hits.find((h) => sameName(h.name, name))
    if (!hit) return null
    return get<ApiFighter>(`/fighters/${encodeURIComponent(hit.slug)}`)
  }

  async function resolve(name: string): Promise<Fighter | null> {
    const profile = await findProfile(name)
    if (!profile) return null
    const history = await get<ApiHistoryRow[]>(`/fighters/${encodeURIComponent(profile.slug)}/history`).catch((e: unknown) => {
      // A history failure only costs us the heuristics; auth and quota problems still abort.
      if (e instanceof ApiError && (e.kind === 'auth' || e.kind === 'quota')) throw e
      return null
    })
    return mapProfile(profile, history, new Date(now()))
  }

  return async (names) => {
    const fighters: Fighter[] = []
    const warnings: string[] = []
    let halted = false
    const unique = [...new Map(names.map((n) => [normalizeName(n), n])).entries()]

    for (let i = 0; i < unique.length && !halted; i += CONCURRENCY) {
      await Promise.all(
        unique.slice(i, i + CONCURRENCY).map(async ([key, name]) => {
          if (halted) return
          const cached = deps.cache.get(key)
          const ttl = cached?.fighter ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
          if (cached && now() - cached.at < ttl) {
            if (cached.fighter) fighters.push(cached.fighter)
            return
          }
          try {
            const fighter = await resolve(name)
            deps.cache.set(key, { at: now(), fighter })
            if (fighter) fighters.push(fighter)
            else warnings.push(`UFCalendar has no usable career stats for ${name}`)
          } catch (err) {
            if (!(err instanceof ApiError)) throw err
            if (err.kind === 'auth') {
              halted = true
              warnings.push('UFCalendar rejected the API key or your plan lacks access (check UFCALENDAR_API_KEY).')
            } else if (err.kind === 'quota') {
              halted = true
              warnings.push('UFCalendar rate limit or monthly quota reached; using cached stats only.')
            } else warnings.push(`UFCalendar lookup failed for ${name}`)
          }
        }),
      )
    }
    return { fighters, warnings }
  }
}
