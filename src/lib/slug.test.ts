import { describe, expect, it } from 'vitest'
import { normalizeName as serverNormalize, slugify as serverSlug } from '../../server/lib/names.ts'
import { normalizeName, slugify } from './slug'

describe('slugify', () => {
  const names = ['Renato Moicano', "Ode' Osbourne", 'Jiří Procházka', 'JeongYeong Lee', 'Jean-Paul Lebosnoyani', 'Uroš Medić', 'Nina Milošević', 'Mantas Kondratavičius', 'Dr. Who  Jr.']

  it('matches the server for every kind of name on the cards', () => {
    for (const n of names) {
      expect(slugify(n)).toBe(serverSlug(n))
      expect(normalizeName(n)).toBe(serverNormalize(n))
    }
  })

  it('produces readable, URL-safe slugs', () => {
    expect(slugify("Ode' Osbourne")).toBe('ode-osbourne')
    expect(slugify('Jiří Procházka')).toBe('jiri-prochazka')
    for (const n of names) expect(slugify(n)).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  })
})
