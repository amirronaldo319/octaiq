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
