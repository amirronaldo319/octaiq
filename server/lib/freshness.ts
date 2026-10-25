export interface FreshnessInput {
  now: Date
  /** Date of the newest bout in the results data, YYYY-MM-DD */
  lastBoutDate: string
  /** When the backtest report was generated */
  reportGeneratedAt: string
}

export interface FreshnessProblem {
  message: string
}

const DAY = 86_400_000
/** UFC rarely goes a month without a card; longer than this means the results feed has probably stopped. */
export const MAX_RESULTS_AGE_DAYS = 30
export const MAX_REPORT_AGE_HOURS = 2

/** Reasons the published data should not be trusted as current; empty when everything looks fresh. */
export function checkFreshness(i: FreshnessInput): FreshnessProblem[] {
  const problems: FreshnessProblem[] = []
  const last = Date.parse(`${i.lastBoutDate}T00:00:00Z`)
  if (!Number.isFinite(last)) problems.push({ message: `The newest bout date "${i.lastBoutDate}" is not a date.` })
  else if (i.now.getTime() - last > MAX_RESULTS_AGE_DAYS * DAY) {
    problems.push({ message: `The newest result in the data is from ${i.lastBoutDate}, more than ${MAX_RESULTS_AGE_DAYS} days ago. The results source may have stopped updating.` })
  }
  const made = Date.parse(i.reportGeneratedAt)
  if (!Number.isFinite(made) || i.now.getTime() - made > MAX_REPORT_AGE_HOURS * 3_600_000) {
    problems.push({ message: 'The backtest report was not regenerated in this run.' })
  }
  return problems
}
