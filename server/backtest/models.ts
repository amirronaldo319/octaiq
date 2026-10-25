/** Small, dependency-free models. All inputs are antisymmetric (A minus B), so no intercept is used. */

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const clampP = (p: number): number => Math.min(1 - 1e-6, Math.max(1e-6, p))

export const logit = (p: number): number => Math.log(clampP(p) / (1 - clampP(p)))

/** Elo win probability for A; eloDiff400 is (eloA - eloB) / 400. */
export const eloProb = (eloDiff400: number): number => 1 / (1 + 10 ** -eloDiff400)

export interface LogisticModel {
  weights: number[]
  scales: number[]
  lambda: number
}

/** Solves A x = b by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error('Singular matrix in logistic regression')
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col]
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n]
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c]
    x[r] = s / m[r][r]
  }
  return x
}

/** L2-regularised logistic regression with no intercept, fitted by Newton's method. */
export interface TrainOptions {
  /** Start from these (scaled-space) weights instead of zero, to converge in a few steps on resampled data */
  init?: readonly number[]
  /** Reuse feature scales, so weights from different resamples are comparable */
  scales?: readonly number[]
  maxIter?: number
}

export function trainLogistic(x: readonly number[][], y: readonly number[], lambda: number, opts: TrainOptions = {}): LogisticModel {
  if (x.length === 0) throw new Error('No training rows')
  const d = x[0].length
  const scales = opts.scales
    ? [...opts.scales]
    : Array.from({ length: d }, (_, j) => {
        const rms = Math.sqrt(x.reduce((s, row) => s + row[j] ** 2, 0) / x.length)
        return rms > 1e-9 ? rms : 1
      })
  const xs = x.map((row) => row.map((v, j) => v / scales[j]))
  let w: number[] = opts.init ? [...opts.init] : new Array<number>(d).fill(0)
  for (let iter = 0; iter < (opts.maxIter ?? 30); iter++) {
    const grad = w.map((wj) => lambda * wj)
    const hess = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? lambda : 0)))
    for (let k = 0; k < xs.length; k++) {
      const p = sigmoid(xs[k].reduce((s, v, j) => s + v * w[j], 0))
      const r = p - y[k]
      const wgt = p * (1 - p)
      for (let i = 0; i < d; i++) {
        grad[i] += r * xs[k][i]
        for (let j = 0; j < d; j++) hess[i][j] += wgt * xs[k][i] * xs[k][j]
      }
    }
    const step = solve(hess, grad)
    w = w.map((wj, j) => wj - step[j])
    if (Math.max(...step.map(Math.abs)) < 1e-8) break
  }
  return { weights: w, scales, lambda }
}

export function predictLogistic(model: LogisticModel, row: readonly number[]): number {
  return sigmoid(row.reduce((s, v, j) => s + (v / model.scales[j]) * model.weights[j], 0))
}

/**
 * Temperature scaling: p' = sigmoid(a * logit(p)). One parameter, antisymmetric, fitted by Newton on
 * previously out-of-sample predictions only.
 */
export function fitTemperature(preds: readonly number[], y: readonly number[]): number {
  let a = 1
  const z = preds.map(logit)
  for (let iter = 0; iter < 50; iter++) {
    let g = 0
    let h = 1e-9
    for (let k = 0; k < z.length; k++) {
      const p = sigmoid(a * z[k])
      g += (p - y[k]) * z[k]
      h += p * (1 - p) * z[k] ** 2
    }
    const step = g / h
    a -= step
    if (Math.abs(step) < 1e-9) break
  }
  return Math.min(3, Math.max(0.2, a))
}

export const applyTemperature = (p: number, a: number): number => sigmoid(a * logit(p))
