import { payout } from '../engine/odds'

export type BetStatus = 'open' | 'won' | 'lost' | 'push'

export interface Bet {
  id: string
  placedAt: number
  fightLabel: string
  pick: string
  american: number
  stake: number
  modelProb: number
  status: BetStatus
  /** No-vig closing probability for the pick, set when settled. */
  closeFairProb?: number
}

export interface BetStats {
  settled: number
  wins: number
  staked: number
  profit: number
  roi: number
  hitRate: number
  avgClv: number | null
  /** Cumulative profit after each settled bet, oldest first */
  curve: number[]
  maxDrawdown: number
}

export function betProfit(bet: Bet): number {
  if (bet.status === 'won') return payout(bet.stake, bet.american)
  if (bet.status === 'lost') return -bet.stake
  return 0
}

export function computeStats(bets: readonly Bet[], impliedOf: (american: number) => number): BetStats {
  const settled = bets.filter((b) => b.status !== 'open').sort((x, y) => x.placedAt - y.placedAt)
  const curve: number[] = []
  let running = 0
  let peak = 0
  let maxDrawdown = 0
  for (const bet of settled) {
    running += betProfit(bet)
    curve.push(running)
    peak = Math.max(peak, running)
    maxDrawdown = Math.max(maxDrawdown, peak - running)
  }
  const staked = settled.filter((b) => b.status !== 'push').reduce((s, b) => s + b.stake, 0)
  const wins = settled.filter((b) => b.status === 'won').length
  const decided = settled.filter((b) => b.status !== 'push').length
  const clvs = settled
    .filter((b) => b.closeFairProb !== undefined)
    .map((b) => (b.closeFairProb as number) - impliedOf(b.american))
  return {
    settled: settled.length,
    wins,
    staked,
    profit: running,
    roi: staked > 0 ? running / staked : 0,
    hitRate: decided > 0 ? wins / decided : 0,
    avgClv: clvs.length > 0 ? clvs.reduce((s, v) => s + v, 0) / clvs.length : null,
    curve,
    maxDrawdown,
  }
}

const KEY = 'octaiq.bets.v1'

export function loadBets(): Bet[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Bet[]) : []
  } catch {
    return []
  }
}

export function saveBets(bets: readonly Bet[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(bets))
  } catch {
    // Storage unavailable (private mode / quota); the in-memory state still works.
  }
}
