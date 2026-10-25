import type { Fight, Fighter, Prediction } from '../engine/types'

export interface Narrative {
  forA: string[]
  forB: string[]
  risks: string[]
}

const fmt = (n: number, d = 1): string => n.toFixed(d)
const strikeOut = (f: Fighter, o: Fighter): number => f.slpm * f.strikeAcc * (1 - o.strikeDef)
const grappleOut = (f: Fighter, o: Fighter): number => f.tdPer15 * (1 - o.tdDef)

/** Plain-language reason for a factor, built only from the numbers that produced it. */
function explain(label: string, win: Fighter, lose: Fighter): string {
  switch (label) {
    case 'Striking edge':
      return `Projected strike output ${fmt(strikeOut(win, lose), 2)} vs ${fmt(strikeOut(lose, win), 2)} per minute (landed rate × accuracy × the opponent's miss rate).`
    case 'Grappling edge':
      return `Projected takedown rate ${fmt(grappleOut(win, lose), 2)} vs ${fmt(grappleOut(lose, win), 2)} per 15 minutes after the opponent's takedown defense.`
    case 'Submission threat':
      return `Submission attempts ${fmt(win.subPer15, 1)} vs ${fmt(lose.subPer15, 1)} per 15 minutes.`
    case 'Durability':
      return `Durability estimate ${fmt(win.chin, 2)} vs ${fmt(lose.chin, 2)} (an estimate from career history or a default, not a measurement).`
    case 'Cardio':
      return `Cardio estimate ${fmt(win.cardio, 2)} vs ${fmt(lose.cardio, 2)} (often a default; check the data source).`
    case 'Reach':
      return `Reach ${win.reachCm} cm vs ${lose.reachCm} cm.`
    case 'Age':
      return `Age ${win.age} vs ${lose.age}; the model penalizes age past 33.`
    case 'Layoff / ring rust':
      return `Days since last fight: ${win.layoffDays} vs ${lose.layoffDays}; long layoffs are penalized past 420 days.`
    default:
      return label
  }
}

const fights = (record: string): number | null => {
  const parts = record.split('-').map((p) => Number.parseInt(p, 10))
  return parts.length >= 2 && parts.every((n) => Number.isFinite(n)) ? parts.reduce((s, n) => s + n, 0) : null
}

export function buildNarrative(fight: Fight, prediction: Prediction): Narrative {
  const { a, b } = fight
  const ranked = [...prediction.factors].filter((f) => Math.abs(f.value) >= 0.05).sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
  const forA = ranked.filter((f) => f.value > 0).slice(0, 3).map((f) => `${f.label}: ${explain(f.label, a, b)}`)
  const forB = ranked.filter((f) => f.value < 0).slice(0, 3).map((f) => `${f.label}: ${explain(f.label, b, a)}`)

  const risks = [
    'This is an unvalidated baseline: factor weights are hand-set, not fitted or backtested on historical fights.',
    'Statistics are career averages and are not adjusted for opponent quality.',
  ]
  for (const f of [a, b]) {
    if (f.layoffDays > 420) risks.push(`${f.name} has been inactive for about ${f.layoffDays} days; the effect of a long layoff is modeled coarsely.`)
    if (f.age >= 36) risks.push(`${f.name} is ${f.age}; age effects are modeled with a single linear penalty.`)
    const n = fights(f.record)
    if (n !== null && n < 10) risks.push(`${f.name} has only ${n} recorded fights, so career averages are a small sample.`)
  }
  if (prediction.disagreement > 0.07) {
    risks.push(`The interpretable model and the simulation differ by ${fmt(prediction.disagreement * 100)} points on the winner.`)
  }
  return { forA, forB, risks }
}

/** Short label for how far the two internal estimates agree. A heuristic, not a calibrated interval. */
export function agreementLabel(disagreement: number): 'Low' | 'Moderate' | 'High' {
  if (disagreement < 0.03) return 'Low'
  if (disagreement < 0.07) return 'Moderate'
  return 'High'
}
