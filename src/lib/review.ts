/** A graded bout: the side the model picked and who won. `probA` is the model's chance that A won. */
export interface ReviewBout {
  a: string
  b: string
  probA: number
  /** Present once the fight is graded: 'a' or 'b' won */
  winner?: 'a' | 'b'
}

export interface Review {
  graded: number
  picked: number
  /** How many picks the model's own probabilities expected to be right, and how many it could miss by luck alone */
  expected: number
  spread: number
  misses: { pick: string; winner: string; confidence: number }[]
  lines: string[]
}

const confidence = (b: ReviewBout): number => Math.max(b.probA, 1 - b.probA)
const pickSide = (b: ReviewBout): 'a' | 'b' => (b.probA >= 0.5 ? 'a' : 'b')
const name = (b: ReviewBout, s: 'a' | 'b'): string => (s === 'a' ? b.a : b.b)
const pct = (p: number): string => `${Math.round(p * 100)}%`

/** What happened on a card, in words: the misses, the upset, the close calls, and whether the result was luck or a real miss. */
export function reviewEvent(bouts: readonly ReviewBout[]): Review | null {
  const graded = bouts.filter((b): b is ReviewBout & { winner: 'a' | 'b' } => b.winner !== undefined)
  if (graded.length === 0) return null
  const hits = graded.filter((b) => pickSide(b) === b.winner)
  const misses = graded
    .filter((b) => pickSide(b) !== b.winner)
    .map((b) => ({ pick: name(b, pickSide(b)), winner: name(b, b.winner), confidence: confidence(b) }))
    .sort((x, y) => y.confidence - x.confidence)
  const expected = graded.reduce((s, b) => s + confidence(b), 0)
  const spread = Math.sqrt(graded.reduce((s, b) => s + confidence(b) * (1 - confidence(b)), 0))
  const lines: string[] = []
  lines.push(`Picked ${hits.length} of ${graded.length}. The model’s own probabilities expected about ${expected.toFixed(1)}.`)
  const z = spread > 0 ? (hits.length - expected) / spread : 0
  if (z <= -1) lines.push('That is worse than its own confidence implied, beyond ordinary luck for a card this size. Worth a look at what the misses had in common.')
  else if (z >= 1) lines.push('That is better than its own confidence implied. On one card, some of that is luck.')
  else lines.push('That is within the normal swing for one card.')
  if (misses[0] && misses[0].confidence >= 0.65) lines.push(`Most confident miss: ${misses[0].pick} at ${pct(misses[0].confidence)} lost to ${misses[0].winner}.`)
  const upset = graded.filter((b) => b.winner !== pickSide(b)).sort((x, y) => confidence(y) - confidence(x))[0]
  if (upset && confidence(upset) >= 0.65) {
    const w = upset.winner
    lines.push(`Biggest upset: ${name(upset, w)} won with a ${pct(w === 'a' ? upset.probA : 1 - upset.probA)} chance.`)
  }
  const close = graded.filter((b) => confidence(b) < 0.6)
  if (close.length >= 2) lines.push(`Near coin flips (under 60%): right ${close.filter((b) => pickSide(b) === b.winner).length} of ${close.length}.`)
  return { graded: graded.length, picked: hits.length, expected, spread, misses, lines }
}

export interface Band {
  label: string
  n: number
  accuracy: number
  /** What the model said on average in this band */
  said: number
}

const BANDS: [number, number, string][] = [[0.5, 0.6, '50–60%'], [0.6, 0.7, '60–70%'], [0.7, 1.01, '70% and up']]

/** Accuracy by confidence band over many events, and the bands that fell short of what the model said. */
export function bandsOf(events: readonly (readonly ReviewBout[])[]): { bands: Band[]; weaknesses: string[] } {
  const all = events.flat().filter((b) => b.winner !== undefined)
  const bands = BANDS.map(([lo, hi, label]): Band => {
    const inBand = all.filter((b) => confidence(b) >= lo && confidence(b) < hi)
    return {
      label, n: inBand.length,
      accuracy: inBand.length ? inBand.filter((b) => pickSide(b) === b.winner).length / inBand.length : 0,
      said: inBand.length ? inBand.reduce((s, b) => s + confidence(b), 0) / inBand.length : 0,
    }
  })
  const weaknesses = bands
    .filter((b) => b.n >= 30 && b.said - b.accuracy >= 0.08)
    .map((b) => `Picks the model rated ${b.label} were right ${pct(b.accuracy)} of the time, below the ${pct(b.said)} it implied (${b.n} fights).`)
  return { bands, weaknesses }
}
