import { FEATURE_NAMES } from './features.ts'

export interface Reason {
  text: string
  /** Contribution to the pick's log-odds; larger means a bigger part of the forecast */
  strength: number
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
 * Factors that measure the same thing are summed before they are shown. Win rate, Elo, opponent quality and
 * experience move together, so their individual weights are unreliable (win rate can even get a negative
 * weight); only their combined push is meaningful.
 */
export const FAMILIES: Record<string, string> = {
  elo: 'Record and ratings', experience: 'Record and ratings', winRate: 'Record and ratings', finishRate: 'Record and ratings',
  koLossRate: 'Record and ratings', subLossRate: 'Record and ratings', form: 'Record and ratings', debut: 'Record and ratings',
  oppElo: 'Record and ratings', activity: 'Record and ratings',
  age: 'Age and reach', reach: 'Age and reach',
  layoff: 'Time off',
  sigDiff: 'Striking', sigLanded: 'Striking', sigAbsorbed: 'Striking', sigAcc: 'Striking', kdFor: 'Striking', kdAgainst: 'Striking',
  tdRate: 'Grappling', tdDef: 'Grappling', subRate: 'Grappling', ctrlNet: 'Grappling',
}

export interface Detail extends Reason {
  family: string
}

export interface Why {
  pick: 'a' | 'b'
  /** Families of factors that push toward the pick, biggest first */
  for: Reason[]
  /** Families that push the other way */
  against: Reason[]
  /** Every individual factor behind those families, for readers who want the detail */
  details: Detail[]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Plain-language reasons behind a forecast. Each feature's contribution is its weight times its A-minus-B value.
 * Contributions are summed within a family of related factors; the families that push most toward the pick are
 * "for" and the families that push the other way are "against". `columns` index FEATURE_NAMES, matching `contributions`.
 */
export function explain(columns: readonly number[], values: readonly number[], contributions: readonly number[], probA: number): Why {
  const pick: 'a' | 'b' = probA >= 0.5 ? 'a' : 'b'
  const sign = pick === 'a' ? 1 : -1
  const details: Detail[] = []
  columns.forEach((col, j) => {
    const name = FEATURE_NAMES[col]
    const phrases = PHRASES[name]
    const family = FAMILIES[name]
    if (!phrases || !family) return
    const strength = contributions[j] * sign
    // The pick's own value is higher when value * sign > 0.
    details.push({ family, strength: round2(strength), text: values[j] * sign > 0 ? phrases[0] : phrases[1] })
  })

  const byFamily = new Map<string, Detail[]>()
  for (const d of details) byFamily.set(d.family, [...(byFamily.get(d.family) ?? []), d])
  const families = [...byFamily.entries()].map(([family, items]) => {
    const net = items.reduce((sum, i) => sum + i.strength, 0)
    // Name the biggest contributors that point the same way as the family's net push.
    const lead = items.filter((i) => Math.sign(i.strength) === Math.sign(net)).sort((x, y) => Math.abs(y.strength) - Math.abs(x.strength)).slice(0, 2)
    return { net, text: `${family}: ${lead.map((i) => i.text.charAt(0).toLowerCase() + i.text.slice(1)).join(', ')}` }
  })
  return {
    pick,
    for: families.filter((f) => f.net >= MIN_STRENGTH).sort((x, y) => y.net - x.net).map((f) => ({ text: f.text, strength: round2(f.net) })),
    against: families.filter((f) => f.net <= -MIN_STRENGTH).sort((x, y) => x.net - y.net).map((f) => ({ text: f.text, strength: round2(-f.net) })),
    details: details.filter((d) => Math.abs(d.strength) >= MIN_STRENGTH).sort((x, y) => Math.abs(y.strength) - Math.abs(x.strength)),
  }
}
