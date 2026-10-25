import { createMemoryCache } from './fighterCache.ts'
import { createMemoryHistory } from './history.ts'
import { mapEvents, oddsUrl, SPORT_KEY, type OddsEvent } from './oddsApi.ts'
import { createUfcalendarProvider, BASE_URL as UFC_BASE } from './ufcalendar.ts'

export interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  detail: string
}

export interface CheckDeps {
  oddsKey: string | undefined
  ufcKey: string | undefined
  fetchImpl: typeof fetch
  /** Spend the 1 odds credit to verify the full odds payload parses */
  fetchOdds: boolean
  now?: () => number
}

const ICON: Record<CheckResult['status'], string> = { ok: '✓', warn: '!', fail: '✗', skip: '-' }
const SAMPLE_FALLBACK = 'Alex Pereira'

const result = (name: string, status: CheckResult['status'], detail: string): CheckResult => ({ name, status, detail })

/** Describes an HTTP failure without echoing URLs, which can carry keys. */
function httpFailure(name: string, status: number, authHint: string): CheckResult {
  if (status === 401 || status === 403) return result(name, 'fail', `rejected (HTTP ${status}). ${authHint}`)
  if (status === 429) return result(name, 'warn', 'rate limit or monthly quota exhausted (HTTP 429)')
  return result(name, 'fail', `unexpected HTTP ${status}`)
}

async function safeFetch(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) })
  } catch {
    return null
  }
}

export async function checkOdds(deps: CheckDeps): Promise<{ results: CheckResult[]; names: string[] }> {
  const { oddsKey, fetchImpl } = deps
  if (!oddsKey) {
    return { results: [result('Odds API key', 'fail', 'ODDS_API_KEY is not set')], names: [] }
  }

  // /sports is documented as not counting against quota, so it validates the key for free.
  const sports = await safeFetch(fetchImpl, `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(oddsKey)}`)
  if (!sports) return { results: [result('Odds API key', 'fail', 'could not reach api.the-odds-api.com')], names: [] }
  if (!sports.ok) return { results: [httpFailure('Odds API key', sports.status, 'Check ODDS_API_KEY.')], names: [] }

  const results: CheckResult[] = [result('Odds API key', 'ok', 'accepted')]
  const list = (await sports.json().catch(() => [])) as { key: string; active?: boolean }[]
  const mma = Array.isArray(list) ? list.find((s) => s.key === SPORT_KEY) : undefined
  if (!mma) results.push(result('MMA market', 'warn', 'not listed for this key'))
  else if (mma.active === false) results.push(result('MMA market', 'warn', 'listed but currently inactive (no upcoming events)'))
  else results.push(result('MMA market', 'ok', 'listed and active'))

  if (!deps.fetchOdds) {
    results.push(result('Odds payload', 'skip', 'skipped (--no-odds)'))
    return { results, names: [] }
  }

  const odds = await safeFetch(fetchImpl, oddsUrl(oddsKey))
  if (!odds) {
    results.push(result('Odds payload', 'fail', 'could not reach api.the-odds-api.com'))
    return { results, names: [] }
  }
  if (!odds.ok) {
    results.push(httpFailure('Odds payload', odds.status, 'Check ODDS_API_KEY.'))
    return { results, names: [] }
  }
  const events = (await odds.json().catch(() => null)) as OddsEvent[] | null
  if (!Array.isArray(events)) {
    results.push(result('Odds payload', 'fail', 'response was not the expected list of events'))
    return { results, names: [] }
  }
  const fights = mapEvents(events, [], createMemoryHistory(), new Date((deps.now ?? Date.now)()))
  const books = fights.length > 0 ? Math.round(fights.reduce((s, f) => s + f.books.length, 0) / fights.length) : 0
  const remaining = odds.headers.get('x-requests-remaining')
  results.push(
    fights.length > 0
      ? result('Odds payload', 'ok', `${fights.length} upcoming fights, ~${books} books each${remaining ? `, ${remaining} credits left` : ''}`)
      : result('Odds payload', 'warn', `parsed OK but no upcoming fights with usable odds${remaining ? `, ${remaining} credits left` : ''}`),
  )
  const names = [...new Set(fights.slice(0, 1).flatMap((f) => [f.a.name, f.b.name]))]
  return { results, names }
}

export async function checkUfcalendar(deps: CheckDeps, sampleNames: string[]): Promise<CheckResult[]> {
  const { ufcKey, fetchImpl } = deps
  if (!ufcKey) return [result('Stats API key', 'fail', 'UFCALENDAR_API_KEY is not set')]

  const probe = await safeFetch(fetchImpl, `${UFC_BASE}/fighters?q=pereira&limit=1`, {
    headers: { authorization: `Bearer ${ufcKey}`, accept: 'application/json' },
  })
  if (!probe) return [result('Stats API key', 'fail', 'could not reach api.ufcalendar.com')]
  if (!probe.ok) return [httpFailure('Stats API key', probe.status, 'Check UFCALENDAR_API_KEY and that your plan includes the fight API.')]

  const left = probe.headers.get('x-ratelimit-remaining')
  const limit = probe.headers.get('x-ratelimit-limit')
  const results = [result('Stats API key', 'ok', `accepted${left && limit ? `, ${left}/${limit} requests left this month` : ''}`)]

  // Run the real adapter end to end so field-name or unit mismatches show up here, not mid-card.
  const names = sampleNames.length > 0 ? sampleNames : [SAMPLE_FALLBACK]
  const provider = createUfcalendarProvider({ apiKey: ufcKey, fetchImpl, cache: createMemoryCache(), now: deps.now })
  const { fighters, warnings } = await provider(names)
  for (const f of fighters) {
    results.push(
      result(
        `Stats for ${f.name}`,
        'ok',
        `SLpM ${f.slpm.toFixed(2)}, acc ${(f.strikeAcc * 100).toFixed(0)}%, def ${(f.strikeDef * 100).toFixed(0)}%, ` +
          `TD/15 ${f.tdPer15.toFixed(2)}, TD def ${(f.tdDef * 100).toFixed(0)}%, finish ${(f.finishRate * 100).toFixed(0)}%, record ${f.record}`,
      ),
    )
  }
  for (const w of warnings) results.push(result('Stats lookup', 'warn', w))
  if (fighters.length === 0 && warnings.length === 0) results.push(result('Stats lookup', 'warn', 'no fighters resolved'))
  return results
}

export async function runChecks(deps: CheckDeps): Promise<CheckResult[]> {
  const odds = await checkOdds(deps)
  const stats = await checkUfcalendar(deps, odds.names)
  return [...odds.results, ...stats]
}

/** Renders the report, scrubbing secrets as a last line of defence. */
export function formatReport(results: readonly CheckResult[], secrets: readonly (string | undefined)[]): string {
  let text = results.map((r) => `${ICON[r.status]} ${r.name}: ${r.detail}`).join('\n')
  for (const s of secrets) if (s) text = text.split(s).join('***')
  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  return `${text}\n\n${failed === 0 ? 'No failures' : `${failed} failed`}${warned ? `, ${warned} warning(s)` : ''}.`
}

export const hasFailures = (results: readonly CheckResult[]): boolean => results.some((r) => r.status === 'fail')
