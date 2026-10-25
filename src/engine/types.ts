export type Style = 'Striker' | 'Wrestler' | 'Grappler' | 'Pressure' | 'Counter'

export interface Fighter {
  id: string
  name: string
  record: string
  age: number
  reachCm: number
  style: Style
  /** Significant strikes landed per minute */
  slpm: number
  /** Strike accuracy 0-1 */
  strikeAcc: number
  /** Strike defense 0-1 */
  strikeDef: number
  /** Takedowns landed per 15 min */
  tdPer15: number
  /** Takedown defense 0-1 */
  tdDef: number
  /** Submission attempts per 15 min */
  subPer15: number
  /** Finish rate 0-1 */
  finishRate: number
  /** Durability 0-1 (higher = harder to finish) */
  chin: number
  /** Cardio 0-1 */
  cardio: number
  /** Days since last fight */
  layoffDays: number
  /** Official UFC ranking in the division, when listed */
  rank?: number
}

export interface Fight {
  id: string
  weightClass: string
  rounds: 3 | 5
  mainEvent: boolean
  a: Fighter
  b: Fighter
  /** Current moneylines per book, American odds */
  books: BookLine[]
  /** Opening/historical lines for movement chart for fighter A, American */
  history: number[]
  /** ISO start time, present for live fights */
  commenceTime?: string
  /** True when a fighter had no stats on file, so the model is not meaningful */
  statsMissing?: boolean
  /** Present for fights that belong to a tracked event */
  bout?: BoutInfo
}

export interface NewsItem {
  /** YYYY-MM-DD publication date */
  date: string
  text: string
  source: string
  url?: string
}

export interface BoutInfo {
  order: number
  card: 'main' | 'prelim'
  notes: string[]
  /** Dated, sourced news about the bout; only items with a source and a date are ever listed */
  news?: NewsItem[]
  /** Where each side's stats came from, e.g. 'ufcalendar', 'csv', or null when missing */
  statsA: boolean
  statsB: boolean
  hasOdds: boolean
}

export interface BookLine {
  book: string
  a: number
  b: number
}

export type Method = 'KO/TKO' | 'Submission' | 'Decision'

export interface Prediction {
  probA: number
  probB: number
  methodA: Record<Method, number>
  methodB: Record<Method, number>
  /** Probability the fight goes the distance */
  distance: number
  /** Round-by-round finish probability (index 0 = round 1) */
  finishByRound: number[]
  factors: Factor[]
  /** Absolute gap between the interpretable model and the simulation win probability */
  disagreement: number
}

export interface Factor {
  label: string
  /** Positive favors A, negative favors B. Units: log-odds contribution */
  value: number
}
