/**
 * Small gradient-boosted trees for the "who wins" question, built to be compared with the logistic model.
 * Training data is mirrored (swap the fighters: x becomes -x, y becomes 1 - y) and predictions are averaged
 * over both orientations, so the model cannot prefer corner A.
 */
export interface TreesOptions {
  rounds: number
  depth: number
  learningRate: number
  minLeaf: number
  bins: number
  l2: number
}

export const DEFAULT_TREES: TreesOptions = { rounds: 120, depth: 3, learningRate: 0.05, minLeaf: 60, bins: 16, l2: 5 }

interface Node {
  feature: number
  /** Go left when value <= threshold; a leaf has feature -1 and value set */
  threshold: number
  left: Node | null
  right: Node | null
  value: number
}

export interface Trees {
  trees: Node[]
  options: TreesOptions
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

function thresholds(xs: readonly number[][], bins: number): number[][] {
  const dim = xs[0]?.length ?? 0
  const out: number[][] = []
  for (let j = 0; j < dim; j++) {
    const col = xs.map((r) => r[j]).sort((a, b) => a - b)
    const ts = new Set<number>()
    for (let b = 1; b < bins; b++) ts.add(col[Math.floor((b / bins) * (col.length - 1))])
    out.push([...ts].sort((a, b) => a - b))
  }
  return out
}

function grow(
  rows: number[], xs: readonly number[][], g: Float64Array, h: Float64Array, ts: number[][], depth: number, o: TreesOptions,
): Node {
  let G = 0
  let H = 0
  for (const i of rows) { G += g[i]; H += h[i] }
  const leaf: Node = { feature: -1, threshold: 0, left: null, right: null, value: -G / (H + o.l2) }
  if (depth === 0 || rows.length < 2 * o.minLeaf) return leaf

  const parentScore = (G * G) / (H + o.l2)
  let best = { gain: 1e-9, feature: -1, threshold: 0 }
  for (let j = 0; j < ts.length; j++) {
    for (const t of ts[j]) {
      let gl = 0
      let hl = 0
      let nl = 0
      for (const i of rows) if (xs[i][j] <= t) { gl += g[i]; hl += h[i]; nl++ }
      if (nl < o.minLeaf || rows.length - nl < o.minLeaf) continue
      const gain = (gl * gl) / (hl + o.l2) + ((G - gl) ** 2) / (H - hl + o.l2) - parentScore
      if (gain > best.gain) best = { gain, feature: j, threshold: t }
    }
  }
  if (best.feature < 0) return leaf
  const left = rows.filter((i) => xs[i][best.feature] <= best.threshold)
  const right = rows.filter((i) => xs[i][best.feature] > best.threshold)
  return {
    feature: best.feature, threshold: best.threshold, value: 0,
    left: grow(left, xs, g, h, ts, depth - 1, o), right: grow(right, xs, g, h, ts, depth - 1, o),
  }
}

const walk = (node: Node, x: readonly number[]): number =>
  node.feature < 0 || !node.left || !node.right ? node.value : walk(x[node.feature] <= node.threshold ? node.left : node.right, x)

export function trainTrees(xsIn: readonly number[][], ysIn: readonly number[], options: Partial<TreesOptions> = {}): Trees {
  const o = { ...DEFAULT_TREES, ...options }
  const xs = [...xsIn, ...xsIn.map((r) => r.map((v) => -v))]
  const ys = [...ysIn, ...ysIn.map((y) => 1 - y)]
  const ts = thresholds(xs, o.bins)
  const f = new Float64Array(xs.length)
  const g = new Float64Array(xs.length)
  const h = new Float64Array(xs.length)
  const all = xs.map((_, i) => i)
  const trees: Node[] = []
  for (let r = 0; r < o.rounds; r++) {
    for (let i = 0; i < xs.length; i++) {
      const p = sigmoid(f[i])
      g[i] = p - ys[i]
      h[i] = Math.max(p * (1 - p), 1e-6)
    }
    const tree = grow(all, xs, g, h, ts, o.depth, o)
    trees.push(tree)
    for (let i = 0; i < xs.length; i++) f[i] += o.learningRate * walk(tree, xs[i])
  }
  return { trees, options: o }
}

const raw = (m: Trees, x: readonly number[]): number => m.trees.reduce((s, t) => s + m.options.learningRate * walk(t, x), 0)

/** Probability that fighter A wins, symmetrised over both orientations. */
export function predictTrees(m: Trees, x: readonly number[]): number {
  return 0.5 * (sigmoid(raw(m, x)) + 1 - sigmoid(raw(m, x.map((v) => -v))))
}
