import { describe, expect, it } from 'vitest'
import { buildHash, parseHash, type Route } from './route'

describe('parseHash', () => {
  it('treats an empty or unknown hash as the Event tab', () => {
    expect(parseHash('')).toEqual({ tab: 'event' })
    expect(parseHash('#/')).toEqual({ tab: 'event' })
    expect(parseHash('#/nonsense')).toEqual({ tab: 'event' })
  })

  it('reads the other tabs', () => {
    expect(parseHash('#/record')).toEqual({ tab: 'record' })
    expect(parseHash('#/health')).toEqual({ tab: 'health' })
    expect(parseHash('#/value')).toEqual({ tab: 'value' })
  })

  it('reads an event, a bout and a fighter in any order', () => {
    expect(parseHash('#/event/ufc-334-gane-hokit')).toEqual({ tab: 'event', eventId: 'ufc-334-gane-hokit' })
    expect(parseHash('#/event/e1/bout/e1-3')).toEqual({ tab: 'event', eventId: 'e1', boutId: 'e1-3' })
    expect(parseHash('#/event/e1/fighter/tom-nolan/bout/e1-1')).toEqual({ tab: 'event', eventId: 'e1', boutId: 'e1-1', fighter: 'tom-nolan' })
  })

  it('works without an event id', () => {
    expect(parseHash('#/event/bout/x-1')).toEqual({ tab: 'event', boutId: 'x-1' })
  })

  it('ignores malformed or unsafe segments instead of throwing', () => {
    expect(parseHash('#/event/e1/bout/%E0%A4%A')).toEqual({ tab: 'event', eventId: 'e1' })
    expect(parseHash('#/event/e1/bout/<script>')).toEqual({ tab: 'event', eventId: 'e1' })
    expect(parseHash('#/event/../../etc')).toEqual({ tab: 'event' })
    expect(parseHash('#/event/e1/bout')).toEqual({ tab: 'event', eventId: 'e1' })
    expect(parseHash(`#/event/${'a'.repeat(300)}`)).toEqual({ tab: 'event' })
  })
})

describe('buildHash', () => {
  const routes: Route[] = [
    { tab: 'event' },
    { tab: 'event', eventId: 'ufc-vegas-123' },
    { tab: 'event', eventId: 'ufc-vegas-123', boutId: 'ufc-vegas-123-1' },
    { tab: 'event', eventId: 'e', boutId: 'e-2', fighter: 'tom-nolan' },
    { tab: 'record' },
    { tab: 'health' },
    { tab: 'bankroll' },
    { tab: 'event', eventId: 'e', boutId: 'e-1', version: '20261025T173628975Z' },
    { tab: 'gaps' },
    { tab: 'tools' },
    { tab: 'compare' },
    { tab: 'compare', a: 'jon-jones' },
    { tab: 'compare', a: 'jon-jones', b: 'tom-aspinall' },
  ]

  it('round-trips every route', () => {
    for (const r of routes) expect(parseHash(buildHash(r))).toEqual(r)
  })

  it('produces readable, stable hashes', () => {
    expect(buildHash({ tab: 'event' })).toBe('#/')
    expect(buildHash({ tab: 'event', eventId: 'e', boutId: 'e-1' })).toBe('#/event/e/bout/e-1')
    expect(buildHash({ tab: 'record', boutId: 'ignored' })).toBe('#/record')
  })

  it('reads the two compared fighters and rejects unsafe slugs', () => {
    expect(parseHash('#/compare/jon-jones/tom-aspinall')).toEqual({ tab: 'compare', a: 'jon-jones', b: 'tom-aspinall' })
    expect(parseHash('#/compare/../x')).toEqual({ tab: 'compare', b: 'x' })
    expect(buildHash({ tab: 'compare', b: 'tom-aspinall' })).toBe('#/compare/-/tom-aspinall')
  })
})
