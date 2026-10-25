/** Odds math: conversions, de-vigging, expected value, Kelly sizing. */

export function americanToDecimal(american: number): number {
  if (american === 0 || !Number.isFinite(american)) throw new Error('Invalid American odds')
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) throw new Error('Decimal odds must exceed 1')
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1))
}

export function impliedProb(american: number): number {
  return 1 / americanToDecimal(american)
}

export function probToAmerican(p: number): number {
  const clamped = Math.min(0.999, Math.max(0.001, p))
  return decimalToAmerican(1 / clamped)
}

/** Remove the bookmaker margin from a two-way market (proportional method). */
export function devig(a: number, b: number): { a: number; b: number; vig: number } {
  const pa = impliedProb(a)
  const pb = impliedProb(b)
  const total = pa + pb
  return { a: pa / total, b: pb / total, vig: total - 1 }
}

/** Expected profit per 1 unit staked. */
export function expectedValue(modelProb: number, american: number): number {
  const profit = americanToDecimal(american) - 1
  return modelProb * profit - (1 - modelProb)
}

/** Fraction of bankroll to stake. `fraction` scales full Kelly (0.25 = quarter Kelly). */
export function kellyFraction(modelProb: number, american: number, fraction = 0.25, cap = 0.05): number {
  const b = americanToDecimal(american) - 1
  const full = (b * modelProb - (1 - modelProb)) / b
  if (full <= 0) return 0
  return Math.min(cap, full * fraction)
}

/** Profit for a winning bet at the given stake. */
export function payout(stake: number, american: number): number {
  return stake * (americanToDecimal(american) - 1)
}

/** Closing line value: positive when you beat the closing price (no-vig). */
export function closingLineValue(betAmerican: number, closeAmerican: number, closeOtherSide: number): number {
  const fair = devig(closeAmerican, closeOtherSide).a
  return fair - impliedProb(betAmerican)
}
