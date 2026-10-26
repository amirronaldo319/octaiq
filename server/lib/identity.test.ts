import { describe, expect, it } from 'vitest'
import { buildIdentity, editDistance, internalIdOf } from './identity.ts'

const known = [
  { key: 'jon jones', externalId: 'abc123' },
  { key: 'park junho', externalId: 'def456' },
  { key: 'mike davis', externalId: null, ambiguous: true },
  { key: 'zach reese', externalId: 'ghi789' },
  { key: 'jose aldo', externalId: 'jkl012' },
]
const id = buildIdentity(known, { 'zachary reese': 'zach reese' })

describe('identity matching', () => {
  it('accepts an exact name, accents and punctuation aside, and gives a stable internal ID', () => {
    const r = id('Jon Jones')
    expect(r).toMatchObject({ kind: 'exact', key: 'jon jones', internalId: 'fi_abc123', quarantined: false })
    expect(id('José Aldo').kind).toBe('exact')
    expect(internalIdOf(null)).toBeNull()
  })

  it('accepts the same words in a different order, but not a different spelling', () => {
    expect(id('Junho Park')).toMatchObject({ kind: 'reordered', key: 'park junho' })
    const near = id('Jon Jonez')
    expect(near.kind).toBe('unmatched')
    expect(near.key).toBeNull()
  })

  it('accepts a reviewed alias, and nothing similar-looking on its own', () => {
    expect(id('Zachary Reese')).toMatchObject({ kind: 'alias', key: 'zach reese' })
    const typo = id('Zack Reese')
    expect(typo.kind).toBe('unmatched')
    expect(typo.candidates[0]).toMatchObject({ name: 'zach reese' })
    expect(typo.quarantined).toBe(true)
  })

  it('quarantines a name shared by two people and never matches it', () => {
    const r = id('Mike Davis')
    expect(r.kind).toBe('ambiguous')
    expect(r.quarantined).toBe(true)
    expect(r.internalId).toBeNull()
  })

  it('does not quarantine a genuine newcomer with no similar name', () => {
    const r = id('Qwerty Newcomer')
    expect(r).toMatchObject({ kind: 'unmatched', candidates: [], quarantined: false })
  })
})

describe('editDistance', () => {
  it('counts single edits and gives up beyond the limit', () => {
    expect(editDistance('kitten', 'sitten')).toBe(1)
    expect(editDistance('abc', 'abc')).toBe(0)
    expect(editDistance('abcdef', 'uvwxyz')).toBeGreaterThan(3)
  })
})
