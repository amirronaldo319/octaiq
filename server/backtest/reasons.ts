import { FEATURE_NAMES } from './features.ts'

export interface Reason {
  text: string
  /** Contribution to the pick's log-odds; larger means a bigger part of the forecast */
  strength: number
}

export interface Why {
  pick: 'a' | 'b'
  for: Reason[]
  against: Reason[]
}

/** [text when the favoured fighter's value is higher, text when it is lower] */
const PHRASES: Record<string, [string, string]> = {
  elo: ['Higher Elo rating', 'Lower Elo rating'],
  experience: ['More UFC experience', 'Less UFC experience'],
  winRate: ['Better win rate', 'Lower win rate'],
  finishRate: ['More finishes', 'Fewer finishes'],
  koLossRate: ['More knockout losses', 'Fewer knockout losses'],
  subLossRate: ['More submission losses', 'Fewer submission losses'],
  form: ['Better recent form', 'Worse recent form'],
  layoff: ['Longer layoff', 'Shorter layoff'],
  age: ['Older', 'Younger'],
  reach: ['Longer reach', 'Shorter reach'],
  debut: ['UFC debut', 'Has UFC fights behind them'],
  oppElo: ['Tougher past opposition', 'Weaker past opposition'],
  activity: ['More active recently', 'Less active recently'],
  sigDiff: ['Better striking differential', 'Worse striking differential'],
  sigLanded: ['Lands more strikes', 'Lands fewer strikes'],
  sigAbsorbed: ['Absorbs more strikes', 'Absorbs fewer strikes'],
  sigAcc: ['Better striking accuracy', 'Worse striking accuracy'],
  tdRate: ['More takedowns', 'Fewer takedowns'],
  tdDef: ['Better takedown defence', 'Worse takedown defence'],
  subRate: ['More submission attempts', 'Fewer submission attempts'],
  ctrlNet: ['More control time', 'Less control time'],
  kdFor: ['Scores more knockdowns', 'Scores fewer knockdowns'],
  kdAgainst: ['Takes more knockdowns', 'Takes fewer knockdowns'],
}

const MIN_STRENGTH = 0.03

/**
 * Plain-language reasons behind a forecast. Each feature's contribution is its weight times its A-minus-B value;
 * the factors with the largest push toward the pick are "for" and the largest pushes the other way are "against".
 * `columns` are indices into FEATURE_NAMES, in the same order as `contributions`.
 */
export function explain(columns: readonly number[], values: readonly number[], contributions: readonly number[], probA: number): Why {
  const pick: 'a' | 'b' = probA >= 0.5 ? 'a' : 'b'
  const sign = pick === 'a' ? 1 : -1
  const items = columns.map((col, j) => {
    const name = FEATURE_NAMES[col]
    const phrases = PHRASES[name]
    const towardPick = contributions[j] * sign
    // The pick's own value is higher when (value * sign) > 0.
    const higher = values[j] * sign > 0
    return { phrases, strength: towardPick, text: phrases ? (higher ? phrases[0] : phrases[1]) : '' }
  }).filter((i) => i.phrases)
  const round = (n: number): number => Math.round(n * 100) / 100
  return {
    pick,
    for: items.filter((i) => i.strength >= MIN_STRENGTH).sort((x, y) => y.strength - x.strength).slice(0, 3).map((i) => ({ text: i.text, strength: round(i.strength) })),
    against: items.filter((i) => i.strength <= -MIN_STRENGTH).sort((x, y) => x.strength - y.strength).slice(0, 2).map((i) => ({ text: i.text, strength: round(-i.strength) })),
  }
}
