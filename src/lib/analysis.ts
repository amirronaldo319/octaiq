import { devig, expectedValue, impliedProb, kellyFraction } from '../engine/odds'
import { predict } from '../engine/model'
import type { Fight, Fighter, Prediction } from '../engine/types'

export type Side = 'a' | 'b'

export interface SideAnalysis {
  side: Side
  fighter: Fighter
  modelProb: number
  /** False when no sportsbook quotes exist for this fight; market fields are then null/zero */
  priced: boolean
  /** Consensus no-vig market probability (average across books) */
  fairProb: number | null
  bestOdds: number | null
  bestBook: string | null
  /** modelProb minus the implied probability of the best price */
  edge: number
  ev: number
  kelly: number
}

export interface FightAnalysis {
  fight: Fight
  prediction: Prediction
  /** False when stats are missing for either fighter, so the model output is not meaningful */
  modelValid: boolean
  a: SideAnalysis
  b: SideAnalysis
  /** Average bookmaker margin on the moneyline; null when unpriced */
  vig: number | null
}

function bestPrice(fight: Fight, side: Side): { odds: number; book: string } | null {
  if (fight.books.length === 0) return null
  let best = fight.books[0]
  for (const line of fight.books) {
    if (line[side] > best[side]) best = line
  }
  return { odds: best[side], book: best.book }
}

export function analyzeFight(fight: Fight, kellyScale: number): FightAnalysis {
  const prediction = predict(fight)
  const modelValid = !fight.statsMissing
  const devigged = fight.books.map((l) => devig(l.a, l.b))
  const priced = devigged.length > 0
  const fairA = priced ? devigged.reduce((s, d) => s + d.a, 0) / devigged.length : null
  const vig = priced ? devigged.reduce((s, d) => s + d.vig, 0) / devigged.length : null

  const build = (side: Side): SideAnalysis => {
    const best = bestPrice(fight, side)
    const modelProb = side === 'a' ? prediction.probA : prediction.probB
    // Edge and EV are only defined when both a price and a trustworthy model exist.
    const usable = best !== null && modelValid
    return {
      side,
      fighter: fight[side],
      modelProb,
      priced: best !== null,
      fairProb: fairA === null ? null : side === 'a' ? fairA : 1 - fairA,
      bestOdds: best?.odds ?? null,
      bestBook: best?.book ?? null,
      edge: usable ? modelProb - impliedProb(best.odds) : 0,
      ev: usable ? expectedValue(modelProb, best.odds) : 0,
      kelly: usable ? kellyFraction(modelProb, best.odds, kellyScale) : 0,
    }
  }
  return { fight, prediction, modelValid, a: build('a'), b: build('b'), vig }
}

export function analyzeCard(fights: readonly Fight[], kellyScale: number): FightAnalysis[] {
  return fights.map((f) => analyzeFight(f, kellyScale))
}

export interface Opportunity extends SideAnalysis {
  priced: true
  fairProb: number
  bestOdds: number
  bestBook: string
  fightId: string
  opponent: string
  weightClass: string
}

/** Positive-EV sides across the card, best first. */
export function findValue(analyses: readonly FightAnalysis[], minEdge: number): Opportunity[] {
  const out: Opportunity[] = []
  for (const an of analyses) {
    // Without real stats the model is just a coin flip, so never surface it as value.
    if (!an.modelValid) continue
    for (const s of [an.a, an.b]) {
      if (s.fairProb === null || s.bestOdds === null || s.bestBook === null) continue
      if (s.edge >= minEdge && s.ev > 0) {
        out.push({
          ...s,
          priced: true,
          fairProb: s.fairProb,
          bestOdds: s.bestOdds,
          bestBook: s.bestBook,
          fightId: an.fight.id,
          opponent: s.side === 'a' ? an.fight.b.name : an.fight.a.name,
          weightClass: an.fight.weightClass,
        })
      }
    }
  }
  return out.sort((x, y) => y.ev - x.ev)
}

export type SortKey = 'order' | 'lean' | 'competitive' | 'finish' | 'edge' | 'uncertain'

export const SORT_LABELS: Record<SortKey, string> = {
  order: 'Bout order',
  lean: 'Strongest model lean',
  competitive: 'Most competitive',
  finish: 'Highest finish probability',
  edge: 'Largest model-vs-market gap',
  uncertain: 'Most uncertain',
}

const lean = (an: FightAnalysis): number => Math.abs(an.prediction.probA - 0.5)
const marketGap = (an: FightAnalysis): number =>
  an.a.fairProb === null ? -1 : Math.abs(an.prediction.probA - an.a.fairProb)

/** Sorts a copy. Fights without a usable model sink to the bottom of every model-based ordering. */
export function sortAnalyses(analyses: readonly FightAnalysis[], key: SortKey): FightAnalysis[] {
  const orderOf = (an: FightAnalysis): number => an.fight.bout?.order ?? 0
  const score: Record<Exclude<SortKey, 'order'>, (an: FightAnalysis) => number> = {
    lean: lean,
    competitive: (an) => -lean(an),
    finish: (an) => 1 - an.prediction.distance,
    edge: marketGap,
    uncertain: (an) => an.prediction.disagreement,
  }
  const copy = [...analyses]
  if (key === 'order') return copy.sort((x, y) => orderOf(x) - orderOf(y))
  return copy.sort((x, y) => {
    if (x.modelValid !== y.modelValid) return x.modelValid ? -1 : 1
    return score[key](y) - score[key](x) || orderOf(x) - orderOf(y)
  })
}

export interface Leaderboard {
  title: string
  explain: string
  rows: { id: string; label: string; value: string }[]
}

const pct = (p: number): string => `${(p * 100).toFixed(0)}%`

/** Ranked callouts across the card. Only fights with a usable model take part. */
export function buildLeaderboards(analyses: readonly FightAnalysis[], limit = 3): Leaderboard[] {
  const valid = analyses.filter((a) => a.modelValid)
  const name = (an: FightAnalysis): string => `${an.fight.a.name} vs ${an.fight.b.name}`
  const top = (
    title: string,
    explain: string,
    score: (an: FightAnalysis) => number,
    show: (an: FightAnalysis) => { label: string; value: string },
  ): Leaderboard => ({
    title,
    explain,
    rows: [...valid].sort((x, y) => score(y) - score(x)).slice(0, limit).map((an) => ({ id: an.fight.id, ...show(an) })),
  })

  const favorite = (an: FightAnalysis): SideAnalysis => (an.a.modelProb >= an.b.modelProb ? an.a : an.b)
  const methodTotal = (an: FightAnalysis, m: 'KO/TKO' | 'Submission' | 'Decision'): number =>
    an.prediction.methodA[m] + an.prediction.methodB[m]

  return [
    top('Highest win probability', 'The model favorite with the largest probability. A high number is not high confidence.',
      (an) => favorite(an).modelProb, (an) => ({ label: favorite(an).fighter.name, value: pct(favorite(an).modelProb) })),
    top('Most likely knockout', 'Combined chance that the fight ends by KO/TKO, either fighter.',
      (an) => methodTotal(an, 'KO/TKO'), (an) => ({ label: name(an), value: pct(methodTotal(an, 'KO/TKO')) })),
    top('Most likely submission', 'Combined chance that the fight ends by submission, either fighter.',
      (an) => methodTotal(an, 'Submission'), (an) => ({ label: name(an), value: pct(methodTotal(an, 'Submission')) })),
    top('Most likely decision', 'Chance the fight goes the distance.',
      (an) => an.prediction.distance, (an) => ({ label: name(an), value: pct(an.prediction.distance) })),
    top('Most competitive', 'Win probability closest to 50/50.',
      (an) => -lean(an), (an) => ({ label: name(an), value: `${pct(an.prediction.probA)} / ${pct(an.prediction.probB)}` })),
    top('Highest model disagreement', 'Where the interpretable model and the simulation differ most. Treat these picks with extra caution.',
      (an) => an.prediction.disagreement, (an) => ({ label: name(an), value: `${(an.prediction.disagreement * 100).toFixed(1)} pts` })),
    ...(valid.some((a) => a.a.fairProb !== null)
      ? [top('Largest model-vs-market gap', 'Absolute difference between the model and the de-vigged market for the first-listed fighter. A gap is a question to investigate, not an edge.',
          marketGap, (an) => ({ label: name(an), value: `${(marketGap(an) * 100).toFixed(1)} pts` }))]
      : []),
  ]
}
