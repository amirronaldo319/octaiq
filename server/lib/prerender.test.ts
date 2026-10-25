import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventPayload } from '../../src/engine/eventTypes.ts'
import { renderEventPage, renderSitemap, ROBOTS, SITE } from './prerender.ts'

const payload = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../src/test/fixtures/data/event-ufc-vegas-123.json'), 'utf8')) as EventPayload

describe('renderEventPage', () => {
  const html = renderEventPage(payload)
  it('has a distinct title, canonical URL, and every bout as text', () => {
    expect(html).toContain('<title>UFC Fight Night: Moicano vs. Nolan')
    expect(html).toContain(`rel="canonical" href="${SITE}events/ufc-vegas-123/"`)
    expect((html.match(/<li>/g) ?? []).length).toBe(payload.fights.length)
    expect(html).toContain('model picks')
  })
  it('links into the app and carries structured data', () => {
    expect(html).toContain(`${SITE}#/event/ufc-vegas-123`)
    expect(html).toContain('"@type":"SportsEvent"')
  })
  it('escapes names so data can never inject markup', () => {
    const evil = structuredClone(payload)
    evil.fights[0].a.name = '<script>alert(1)</script>'
    evil.event.title = 'A </script><b>x'
    const out = renderEventPage(evil)
    expect(out).not.toContain('<script>alert(1)')
    expect(out).not.toMatch(/<\/script><b>/)
  })
})

describe('sitemap and robots', () => {
  it('lists the home page and each event', () => {
    const xml = renderSitemap(['a', 'b'], '2026-10-25')
    expect(xml.match(/<loc>/g)).toHaveLength(3)
    expect(xml).toContain(`${SITE}events/b/`)
  })
  it('points robots at the sitemap', () => {
    expect(ROBOTS).toContain(`Sitemap: ${SITE}sitemap.xml`)
  })
})
