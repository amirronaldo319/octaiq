import type { FeatureRow } from './features.ts'
import { wcOneHot, type JointProbs } from './outcomes.ts'

/**
 * A direct model of the six outcomes together: A or B winning by KO/TKO, submission or decision. Unlike the
 * default (win probability times a method model), it lets the method depend on who is expected to win.
 * Training data is mirrored (fighters swapped, features negated, classes swapped) and predictions are averaged
 * over both orientations, so the model has no preference for corner A.
 */
export const CLASSES = ['aKo', 'aSub', 'aDec', 'bKo', 'bSub', 'bDec'] as const
const K = CLASSES.length
const swapClass = (c: number): number => (c + 3) % K

export interface DirectJoint {
  /** K rows of D standardised weights */
  weights: Float64Array
  scales: Float64Array
  dim: number
  /** How many inputs after the bias are antisymmetric (they change sign when the fighters swap) */
  anti: number
}

type Ctx = Pick<FeatureRow, 'x' | 'dist' | 'ctx'>

/** Bias, antisymmetric matchup features, symmetric finish-proneness features, five-round flag, weight class. */
export function jointInput(r: Ctx, columns: readonly number[]): number[] {
  return [1, ...columns.map((i) => r.x[i]), ...r.dist, r.ctx.rounds === 5 ? 1 : 0, ...wcOneHot(r.ctx.weightClass)]
}

const methodIndex = (m: string): number => (m === 'ko' ? 0 : m === 'sub' ? 1 : 2)

/** The class a decisive result belongs to, or null for draws, no-contests and unusual methods. */
export function classOf(r: Pick<FeatureRow, 'ctx'>): number | null {
  const { result, method } = r.ctx
  if ((result !== 'a' && result !== 'b') || (method !== 'ko' && method !== 'sub' && method !== 'dec')) return null
  return (result === 'a' ? 0 : 3) + methodIndex(method)
}

function softmax(z: Float64Array | number[]): number[] {
  const max = Math.max(...z)
  const e = Array.from(z, (v) => Math.exp(v - max))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / s)
}

export interface DirectOptions {
  iterations: number
  learningRate: number
  ridge: number
}

export const DEFAULT_DIRECT: DirectOptions = { iterations: 200, learningRate: 0.05, ridge: 5 }

export function trainDirect(rows: readonly FeatureRow[], columns: readonly number[], options: Partial<DirectOptions> = {}): DirectJoint {
  const o = { ...DEFAULT_DIRECT, ...options }
  const anti = columns.length
  const inputs: number[][] = []
  const labels: number[] = []
  for (const r of rows) {
    const c = classOf(r)
    if (c === null) continue
    const x = jointInput(r, columns)
    inputs.push(x)
    labels.push(c)
    inputs.push(x.map((v, j) => (j >= 1 && j <= anti ? -v : v)))
    labels.push(swapClass(c))
  }
  const n = inputs.length
  if (n === 0) throw new Error('No decisive rows to train on')
  const dim = inputs[0].length
  const scales = new Float64Array(dim).fill(1)
  for (let j = 1; j < dim; j++) {
    let ss = 0
    for (let i = 0; i < n; i++) ss += inputs[i][j] ** 2
    const rms = Math.sqrt(ss / n)
    scales[j] = rms > 1e-9 ? rms : 1
  }
  const x = new Float64Array(n * dim)
  for (let i = 0; i < n; i++) for (let j = 0; j < dim; j++) x[i * dim + j] = inputs[i][j] / scales[j]

  const w = new Float64Array(K * dim)
  const m = new Float64Array(K * dim)
  const v = new Float64Array(K * dim)
  const grad = new Float64Array(K * dim)
  const z = new Float64Array(K)
  for (let it = 1; it <= o.iterations; it++) {
    grad.fill(0)
    for (let i = 0; i < n; i++) {
      const base = i * dim
      let max = -Infinity
      for (let k = 0; k < K; k++) {
        let s = 0
        const wk = k * dim
        for (let j = 0; j < dim; j++) s += w[wk + j] * x[base + j]
        z[k] = s
        if (s > max) max = s
      }
      let sum = 0
      for (let k = 0; k < K; k++) {
        z[k] = Math.exp(z[k] - max)
        sum += z[k]
      }
      for (let k = 0; k < K; k++) {
        const err = z[k] / sum - (k === labels[i] ? 1 : 0)
        const gk = k * dim
        for (let j = 0; j < dim; j++) grad[gk + j] += err * x[base + j]
      }
    }
    const b1 = 0.9
    const b2 = 0.999
    for (let p = 0; p < w.length; p++) {
      const g = grad[p] / n + (o.ridge / n) * w[p]
      m[p] = b1 * m[p] + (1 - b1) * g
      v[p] = b2 * v[p] + (1 - b2) * g * g
      w[p] -= (o.learningRate * (m[p] / (1 - b1 ** it))) / (Math.sqrt(v[p] / (1 - b2 ** it)) + 1e-8)
    }
  }
  return { weights: w, scales, dim, anti }
}

function probsFor(model: DirectJoint, input: readonly number[]): number[] {
  const z = new Float64Array(K)
  for (let k = 0; k < K; k++) {
    let s = 0
    for (let j = 0; j < model.dim; j++) s += model.weights[k * model.dim + j] * (input[j] / model.scales[j])
    z[k] = s
  }
  return softmax(z)
}

/** Probabilities of the six outcomes, averaged over both orientations so swapping the fighters swaps the answer exactly. */
export function predictDirect(model: DirectJoint, r: Ctx, columns: readonly number[]): JointProbs {
  const x = jointInput(r, columns)
  const swapped = x.map((v, j) => (j >= 1 && j <= model.anti ? -v : v))
  const p1 = probsFor(model, x)
  const p2 = probsFor(model, swapped)
  const p = p1.map((v, c) => 0.5 * (v + p2[swapClass(c)]))
  return { aKo: p[0], aSub: p[1], aDec: p[2], bKo: p[3], bSub: p[4], bDec: p[5] }
}

/**
 * The direct model's split of methods within each winner, applied to a win probability from the validated
 * win model. The result sums to one, and the method mix can differ between the favourite and the underdog.
 */
export function hybridJoint(pWinA: number, direct: JointProbs): JointProbs {
  const a = direct.aKo + direct.aSub + direct.aDec
  const b = direct.bKo + direct.bSub + direct.bDec
  const pB = 1 - pWinA
  return {
    aKo: pWinA * (direct.aKo / a), aSub: pWinA * (direct.aSub / a), aDec: pWinA * (direct.aDec / a),
    bKo: pB * (direct.bKo / b), bSub: pB * (direct.bSub / b), bDec: pB * (direct.bDec / b),
  }
}
