import { describe, expect, it } from 'vitest'
import { runningAccuracy } from '../components/TrackRecord'
import { bucketFor } from '../components/HitRate'

describe('runningAccuracy', () => {
  it('accumulates oldest first from a newest-first list', () => {
    const newest = { bouts: [{ correct: true }, { correct: true }] }
    const oldest = { bouts: [{ correct: false }, { correct: true }] }
    expect(runningAccuracy([newest, oldest])).toEqual([50, 75])
  })
})

describe('bucketFor', () => {
  const rel = [{ lo: 0.5, hi: 0.55, n: 400, observed: 0.5 }, { lo: 0.9, hi: 1, n: 40, observed: 0.9 }]
  it('finds the matching bucket, including the top one', () => {
    expect(bucketFor(0.52, rel)?.n).toBe(400)
    expect(bucketFor(1, rel)?.n).toBe(40)
    expect(bucketFor(0.7, rel)).toBeUndefined()
  })
})
