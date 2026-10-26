import type { EventPayload } from '../../src/engine/eventTypes.ts'
import type { MarketFile } from './marketSnapshot.ts'

/**
 * Operational health in one small file: how the forecasts published before events are doing, whether the inputs look sound,
 * whether the forecast distribution has drifted from the one the model was tested on, and whether prices are current.
 * It reports; it never retrains or changes anything.
 */
export interface MonitorInput {
  now: Date
  events: readonly EventPayload[]
  /** Graded published bouts: probability that A won and whether the pick was right, newest last */
  graded: readonly { probA: number; winner: 'a' | 'b'; shadowProbA?: number }[]
  /** Names quarantined for review and the number of names checked, from the identity audit */
  identity: { checked: number; quarantined: number } | null
  market: MarketFile | null
  /** Mean confidence (distance of the favourite's probability from a coin flip, plus 0.5) among the backtest's forecasts */
  trainingMeanConfidence: number | null
  trainingLogLoss: number | null
}

export interface Monitor {
  generatedAt: string
  prospective: { graded: number; correct: number; logLoss: number | null; window: number; note: string }
  inputs: { fights: number; withForecast: number; debutantBouts: number; identityChecked: number | null; quarantined: number | null }
  drift: { currentMeanConfidence: number | null; trainingMeanConfidence: number | null; flagged: boolean }
  market: { ageHours: number | null; pricedBouts: number; fights: number } | null
  /** Production against the shadow challenger on graded published forecasts that carry both; null until there are any */
  shadow: { graded: number; productionLogLoss: number; shadowLogLoss: number; difference: number } | null
  alerts: string[]
}

const WINDOW = 100
const DRIFT_LIMIT = 0.05
const STALE_HOURS = 8
const MIN_FOR_ALERT = 50

const confidence = (p: number): number => Math.max(p, 1 - p)

export function buildMonitor(i: MonitorInput): Monitor {
  const alerts: string[] = []
  const recent = i.graded.slice(-WINDOW)
  const logLoss = recent.length ? recent.reduce((s, g) => s - Math.log(Math.max(1e-6, g.winner === 'a' ? g.probA : 1 - g.probA)), 0) / recent.length : null
  const correct = i.graded.filter((g) => (g.probA >= 0.5) === (g.winner === 'a')).length
  const note = i.graded.length === 0
    ? 'No published forecast has been graded yet.'
    : `Over the last ${recent.length} graded fights. A single card is a very small sample; judge by many.`
  if (logLoss !== null && recent.length >= MIN_FOR_ALERT && logLoss > Math.log(2) + 0.03) alerts.push(`Recent published forecasts have a log loss of ${logLoss.toFixed(3)}, worse than a coin flip (${Math.log(2).toFixed(3)}).`)

  const fights = i.events.flatMap((e) => e.fights.map((f) => ({ ev: e, f })))
  const forecasts = fights.map(({ ev, f }) => ev.resultsModel.bouts[f.id]).filter((b): b is NonNullable<typeof b> => Boolean(b))
  const debutantBouts = forecasts.filter((b) => b.priorA === 0 || b.priorB === 0).length
  const current = forecasts.length ? forecasts.reduce((s, b) => s + confidence(b.probA), 0) / forecasts.length : null
  const flagged = current !== null && i.trainingMeanConfidence !== null && forecasts.length >= 10 && Math.abs(current - i.trainingMeanConfidence) > DRIFT_LIMIT
  if (flagged) alerts.push(`Current forecasts average ${(current as number).toFixed(2)} confidence against ${(i.trainingMeanConfidence as number).toFixed(2)} in the tests: the mix of fights may differ from what the model was tested on.`)
  if (fights.length > forecasts.length) alerts.push(`${fights.length - forecasts.length} bouts on current cards have no forecast.`)
  if (i.identity && i.identity.quarantined > 0) alerts.push(`${i.identity.quarantined} fighter names need a person to confirm the match to the results data.`)

  let market: Monitor['market'] = null
  if (i.market) {
    const ageHours = (i.now.getTime() - Date.parse(i.market.generatedAt)) / 3_600_000
    const priced = Object.values(i.market.events).reduce((n, e) => n + Object.keys(e).length, 0)
    market = { ageHours: Math.round(ageHours * 10) / 10, pricedBouts: priced, fights: fights.length }
    if (ageHours > STALE_HOURS) alerts.push(`Betting prices were last collected ${Math.round(ageHours)} hours ago.`)
  }

  const both = i.graded.filter((g): g is { probA: number; winner: 'a' | 'b'; shadowProbA: number } => g.shadowProbA !== undefined)
  const ll = (p: number, w: 'a' | 'b'): number => -Math.log(Math.max(1e-6, w === 'a' ? p : 1 - p))
  const shadow = both.length
    ? (() => {
        const production = both.reduce((s, g) => s + ll(g.probA, g.winner), 0) / both.length
        const sh = both.reduce((s, g) => s + ll(g.shadowProbA, g.winner), 0) / both.length
        return { graded: both.length, productionLogLoss: production, shadowLogLoss: sh, difference: sh - production }
      })()
    : null

  return {
    generatedAt: i.now.toISOString(),
    prospective: { graded: i.graded.length, correct, logLoss, window: recent.length, note },
    inputs: { fights: fights.length, withForecast: forecasts.length, debutantBouts, identityChecked: i.identity?.checked ?? null, quarantined: i.identity?.quarantined ?? null },
    drift: { currentMeanConfidence: current, trainingMeanConfidence: i.trainingMeanConfidence, flagged },
    market,
    shadow,
    alerts,
  }
}
