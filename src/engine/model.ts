import { createRng } from './rng'
import type { Factor, Fight, Fighter, Method, Prediction } from './types'

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const logistic = (x: number): number => 1 / (1 + Math.exp(-x))

function strikeOffense(f: Fighter, opp: Fighter): number {
  return f.slpm * f.strikeAcc * (1 - opp.strikeDef)
}

function grappleOffense(f: Fighter, opp: Fighter): number {
  return f.tdPer15 * (1 - opp.tdDef)
}

/** Interpretable log-odds contributions; positive favors fighter A. */
export function computeFactors(a: Fighter, b: Fighter, rounds: 3 | 5): Factor[] {
  const agePenalty = (f: Fighter): number => Math.max(0, f.age - 33) * 0.06
  const layoffPenalty = (f: Fighter): number => clamp((f.layoffDays - 420) * 0.0015, 0, 0.6)
  return [
    { label: 'Striking edge', value: (strikeOffense(a, b) - strikeOffense(b, a)) * 0.9 },
    { label: 'Grappling edge', value: (grappleOffense(a, b) - grappleOffense(b, a)) * 0.35 },
    { label: 'Submission threat', value: (a.subPer15 - b.subPer15) * 0.12 },
    { label: 'Durability', value: (a.chin - b.chin) * 1.2 },
    { label: 'Cardio', value: (a.cardio - b.cardio) * 0.8 * (rounds / 3) },
    { label: 'Reach', value: ((a.reachCm - b.reachCm) / 10) * 0.15 },
    { label: 'Age', value: agePenalty(b) - agePenalty(a) },
    { label: 'Layoff / ring rust', value: layoffPenalty(b) - layoffPenalty(a) },
  ]
}

interface SimResult {
  winA: number
  methodA: Record<Method, number>
  methodB: Record<Method, number>
  distance: number
  finishByRound: number[]
}

function finishChance(att: Fighter, def: Fighter, round: number): number {
  const power = 0.5 + att.slpm / 8
  const fatigue = 1 + (att.cardio - def.cardio) * 0.1 * round
  const raw = att.finishRate * 0.11 * power * (1.15 - def.chin) * fatigue
  return clamp(raw, 0.005, 0.35)
}

function submissionShare(f: Fighter): number {
  const grapple = f.subPer15 + f.tdPer15 * 0.4
  return clamp(grapple / (grapple + f.slpm * 0.55), 0.05, 0.85)
}

/** Monte Carlo round-by-round fight simulation. */
export function simulateFight(fight: Fight, gap: number, sims: number, seed: number): SimResult {
  const { a, b, rounds } = fight
  const rng = createRng(seed)
  const subA = submissionShare(a)
  const subB = submissionShare(b)
  const roundWinA = logistic(gap * 0.55)
  const winsA = { ko: 0, sub: 0, dec: 0 }
  const winsB = { ko: 0, sub: 0, dec: 0 }
  const finishRounds = new Array<number>(rounds).fill(0)
  let aWins = 0

  for (let i = 0; i < sims; i++) {
    let scoreA = 0
    let scoreB = 0
    let ended = false
    for (let r = 1; r <= rounds && !ended; r++) {
      const fa = finishChance(a, b, r) * (0.8 + 0.4 * roundWinA)
      const fb = finishChance(b, a, r) * (0.8 + 0.4 * (1 - roundWinA))
      const roll = rng()
      if (roll < fa) {
        const isSub = rng() < subA
        if (isSub) winsA.sub++
        else winsA.ko++
        aWins++
        finishRounds[r - 1]++
        ended = true
      } else if (roll < fa + fb) {
        const isSub = rng() < subB
        if (isSub) winsB.sub++
        else winsB.ko++
        finishRounds[r - 1]++
        ended = true
      } else if (rng() < roundWinA) scoreA++
      else scoreB++
    }
    if (ended) continue
    // Split draws roughly evenly; a draw counts as half a decision win for each side.
    if (scoreA > scoreB || (scoreA === scoreB && rng() < 0.5)) {
      winsA.dec++
      aWins++
    } else {
      winsB.dec++
    }
  }

  const norm = (n: number): number => n / sims
  return {
    winA: norm(aWins),
    methodA: { 'KO/TKO': norm(winsA.ko), Submission: norm(winsA.sub), Decision: norm(winsA.dec) },
    methodB: { 'KO/TKO': norm(winsB.ko), Submission: norm(winsB.sub), Decision: norm(winsB.dec) },
    distance: norm(winsA.dec + winsB.dec),
    finishByRound: finishRounds.map(norm),
  }
}

/** Blend interpretable logistic model with the simulation for the final probability. */
export function predict(fight: Fight, sims = 20000, seed = 7): Prediction {
  const factors = computeFactors(fight.a, fight.b, fight.rounds)
  const gap = factors.reduce((sum, f) => sum + f.value, 0)
  const sim = simulateFight(fight, gap, sims, seed)
  const probA = clamp(0.5 * logistic(gap) + 0.5 * sim.winA, 0.02, 0.98)
  const disagreement = Math.abs(logistic(gap) - sim.winA)
  return {
    probA,
    probB: 1 - probA,
    methodA: sim.methodA,
    methodB: sim.methodB,
    distance: sim.distance,
    finishByRound: sim.finishByRound,
    factors,
    disagreement,
  }
}
