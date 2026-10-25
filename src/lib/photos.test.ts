import { describe, expect, it } from 'vitest'
import { parsePhotos } from './photos'

const ok = { url: 'https://example.org/a.jpg', credit: 'Photographer', licence: 'CC BY 4.0', sourceUrl: 'https://example.org/a' }

describe('parsePhotos', () => {
  it('keeps only portraits that name a licence, a credit and https sources', () => {
    const map = parsePhotos({ 'jon-jones': ok, 'no-licence': { ...ok, licence: '' }, 'http-only': { ...ok, url: 'http://x/y.jpg' }, junk: 5 })
    expect(Object.keys(map)).toEqual(['jon-jones'])
  })
  it('treats anything unexpected as no photos', () => {
    expect(parsePhotos(null)).toEqual({})
    expect(parsePhotos([ok])).toEqual({})
  })
})
