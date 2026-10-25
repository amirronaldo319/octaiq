/** Whole-percent display that always adds up: a two-way split is [round(p), 100 - round(p)]. */
export function pctPair(p: number): [number, number] {
  const a = Math.min(100, Math.max(0, Math.round(p * 100)))
  return [a, 100 - a]
}

/**
 * Splits `total` whole units across `shares` in proportion (largest remainder), so the displayed whole
 * numbers add up to the total instead of 99 or 101.
 */
export function apportion(shares: readonly number[], total: number): number[] {
  const sum = shares.reduce((s, v) => s + Math.max(0, v), 0)
  if (sum <= 0) return shares.map(() => 0)
  const raw = shares.map((v) => (Math.max(0, v) / sum) * total)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((s, v) => s + v, 0)
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((x, y) => y.frac - x.frac || x.i - y.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out
}
