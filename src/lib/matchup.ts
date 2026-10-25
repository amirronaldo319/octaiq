import type { Career, CareerRow } from '../../server/backtest/careers'
import { weightClassIndex } from '../engine/weightClass'

const DAY = 86_400_000

export const lastFive = (c: Career | undefined): CareerRow[] => (c?.timeline ?? []).slice(0, 5)

export type Opposition = 'Tougher' | 'Similar' | 'Easier'

/** How an opponent's rating compares with the fighter's own current rating. */
export function oppositionLabel(oppElo: number, selfElo: number | null): Opposition {
  const gap = oppElo - (selfElo ?? 1500)
  return gap > 50 ? 'Tougher' : gap < -50 ? 'Easier' : 'Similar'
}

export interface RoundHistory {
  three: { wins: number; losses: number; fights: number }
  five: { wins: number; losses: number; fights: number }
}

/** Results in three-round and five-round fights, so a main event's longer distance has some context. */
export function roundHistory(c: Career | undefined): RoundHistory {
  const out: RoundHistory = { three: { wins: 0, losses: 0, fights: 0 }, five: { wins: 0, losses: 0, fights: 0 } }
  for (const row of c?.timeline ?? []) {
    const bucket = row.rounds === 5 ? out.five : row.rounds === 3 ? out.three : null
    if (!bucket) continue
    bucket.fights++
    if (row.result === 'W') bucket.wins++
    else if (row.result === 'L') bucket.losses++
  }
  return out
}

export interface AdjustedForm {
  fights: number
  /** Strikes landed per minute as a multiple of what those opponents usually absorbed; above 1 is better than their usual */
  strikes: number | null
  /** Takedowns landed per 15 minutes as a multiple of what those opponents usually gave up */
  takedowns: number | null
}

/** Recent output measured against each opponent's usual, so a fighter is not flattered or punished by who they faced. */
export function adjustedForm(c: Career | undefined, count = 5): AdjustedForm | null {
  const rows = lastFive(c).slice(0, count).filter((r) => r.sigPerMin !== undefined && r.oppUsualSigAbsorbed != null && r.oppUsualSigAbsorbed > 0)
  if (rows.length < 2) return null
  const strikes = rows.reduce((s, r) => s + (r.sigPerMin as number), 0) / rows.reduce((s, r) => s + (r.oppUsualSigAbsorbed as number), 0)
  const td = rows.filter((r) => r.tdPer15 !== undefined && r.oppUsualTdAbsorbed != null)
  const tdUsual = td.reduce((s, r) => s + (r.oppUsualTdAbsorbed as number), 0)
  return {
    fights: rows.length,
    strikes: Math.round(strikes * 100) / 100,
    // Takedown rates are small numbers; below this the ratio says nothing.
    takedowns: tdUsual >= 1 ? Math.round((td.reduce((s, r) => s + (r.tdPer15 as number), 0) / tdUsual) * 100) / 100 : null,
  }
}

export interface Condition {
  text: string
  tone: 'warn' | 'info'
}

const monthsOf = (days: number): number => Math.round(days / 30)

/** Layoff and weight-class change going into this bout, from the fighter's own timeline. */
export function conditionsFor(c: Career | undefined, eventDate: string, boutClass: string): Condition[] {
  const last = c?.timeline[0]
  if (!c || !last) return []
  const out: Condition[] = []
  const days = Math.round((Date.parse(eventDate) - Date.parse(`${last.date}T00:00:00Z`)) / DAY)
  if (days >= 365) out.push({ text: `${monthsOf(days)} months since the last fight (${last.date})`, tone: 'warn' })
  else if (days >= 270) out.push({ text: `${monthsOf(days)} months since the last fight`, tone: 'info' })
  else if (days > 0 && days <= 35) out.push({ text: `Fought only ${days} days earlier`, tone: 'warn' })
  const before = weightClassIndex(last.weightClass)
  const now = weightClassIndex(boutClass)
  if (before !== null && now !== null && before !== now) {
    out.push({ text: `${now > before ? 'Moving up' : 'Dropping down'} in weight (last fought at ${last.weightClass.replace(/ Bout$/, '').replace(/^UFC /, '')})`, tone: 'info' })
  }
  if (c.timeline.length > 0 && c.timeline[0].result === 'L' && c.timeline.slice(0, 2).every((r) => r.result === 'L')) out.push({ text: 'Lost the last two', tone: 'info' })
  return out
}

const finishShare = (c: Career, kind: 'koWins' | 'subWins'): string | null => (c.wins >= 3 && c[kind] / c.wins >= 0.4 ? `${c[kind]} of ${c.wins} wins` : null)

/**
 * Evidence-backed ways each fighter could win, from their own record and their opponent's. This is editorial reading of the
 * past results; none of it is an input to the model.
 */
export function pathsToVictory(self: Career | undefined, opp: Career | undefined): string[] {
  if (!self || !self.matched || self.fights === 0) return []
  const out: string[] = []
  const ko = finishShare(self, 'koWins')
  if (ko) out.push(`Knockout power: ${ko} came by KO or TKO.`)
  const sub = finishShare(self, 'subWins')
  if (sub) out.push(`Submissions: ${sub} came by submission.`)
  if (self.wins >= 3 && self.decisionWins / self.wins >= 0.6) out.push(`Winning rounds: ${self.decisionWins} of ${self.wins} wins went to the judges.`)
  const form = adjustedForm(self)
  if (form?.strikes && form.strikes >= 1.1) out.push(`Striking volume: landed ${form.strikes.toFixed(2)} times the strikes those opponents usually absorb, over the last ${form.fights} fights.`)
  if (form?.takedowns && form.takedowns >= 1.3) out.push(`Takedowns: ${form.takedowns.toFixed(2)} times what those opponents usually give up, over the last ${form.fights} fights.`)
  if (opp && opp.matched && opp.losses >= 2) {
    const lossRows = opp.timeline.filter((r) => r.result === 'L')
    const finished = lossRows.filter((r) => r.method === 'KO/TKO' || r.method === 'Submission').length
    if (finished >= 2 && finished / lossRows.length >= 0.6) out.push(`Their opponent has been finished in ${finished} of ${lossRows.length} losses.`)
  }
  return out.slice(0, 3)
}

export interface ChangeInput {
  tags: readonly string[]
  priorMin: number | null
  rangeWidth: number | null
  /** Model minus market, in percentage points for fighter A, when a market exists */
  marketGapPoints: number | null
  conditions: readonly Condition[]
}

/** Concrete things that would move this forecast, so uncertainty is practical rather than abstract. */
export function whatCouldChange(i: ChangeInput): string[] {
  const out: string[] = []
  if (i.tags.includes('Replacement opponent') || i.tags.includes('Check before relying')) out.push('Another opponent change would reset the forecast: it is built for this exact pairing.')
  if (i.priorMin !== null && i.priorMin < 3) out.push('A fighter with few UFC fights is rated mostly on a short record; one more result would move the rating a lot.')
  if (i.rangeWidth !== null && i.rangeWidth > 0.2) out.push(`The likely range is wide (${Math.round(i.rangeWidth * 100)} points), so a different sample of past fights would give a noticeably different answer.`)
  if (i.marketGapPoints !== null && Math.abs(i.marketGapPoints) >= 5) out.push(`The betting market disagrees by ${Math.abs(Math.round(i.marketGapPoints))} points. In past tests the market was the more accurate, so it may know something the model cannot see.`)
  if (i.conditions.some((c) => c.tone === 'warn')) out.push('Long layoffs and quick turnarounds are only partly captured: the model sees the time off but not why.')
  out.push('Injuries, weight-cut trouble, camp changes and late news are not in the model. Check for them close to fight night.')
  return out
}
