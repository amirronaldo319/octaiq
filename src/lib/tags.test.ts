import { describe, expect, it } from 'vitest'
import { dataQuality, noteTags } from './tags'

describe('noteTags', () => {
  it('turns free-text notes into short labels', () => {
    expect(noteTags(['Main event. Replaced Brian Ortega, who withdrew with a cut (CagesidePress, Sept 14 2026).']).map((t) => t.label)).toEqual(['Replacement opponent'])
    expect(noteTags(['Title bout.']).map((t) => t.label)).toEqual(['Title fight'])
    expect(noteTags(["Hasanov's record is 6-0-0 on ESPN Deportes but 5-0-0 on MMA Sucka; ufc.com does not show it."]).map((t) => t.label)).toEqual(['Unconfirmed details'])
    expect(noteTags(['Still listed on ufc.com with no cancellation notice. Check before relying on this bout.']).map((t) => t.label)).toEqual(['Check before relying'])
    expect(noteTags(['Confirmed on ufc.com.'])).toEqual([])
  })
  it('does not repeat a label', () => {
    expect(noteTags(['Title bout.', 'Championship fight.'])).toHaveLength(1)
  })
})

describe('dataQuality', () => {
  const names = { a: 'Ann', b: 'Bea' }
  const solid = { priorA: 12, priorB: 9, probLo: 0.5, probHi: 0.62 }
  it('is Good with experienced fighters and a narrow range', () => {
    expect(dataQuality(names, solid, []).level).toBe('Good')
  })
  it('is separate from how lopsided the forecast is: a debutant makes it Fair', () => {
    const q = dataQuality(names, { ...solid, priorB: 0 }, [])
    expect(q.level).toBe('Fair')
    expect(q.reasons.join(' ')).toContain('Bea has no UFC fights')
  })
  it('is Limited with two weaknesses, or when the card says to check', () => {
    expect(dataQuality(names, { ...solid, priorA: 1, priorB: 2 }, []).level).toBe('Limited')
    expect(dataQuality(names, solid, [{ label: 'Check before relying', tone: 'warn' }]).level).toBe('Limited')
  })
  it('is Limited with no forecast', () => {
    expect(dataQuality(names, undefined, []).level).toBe('Limited')
  })
})
