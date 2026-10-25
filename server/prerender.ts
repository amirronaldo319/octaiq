import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EventIndex, EventPayload } from '../src/engine/eventTypes.ts'
import { renderEventPage, renderSitemap, ROBOTS } from './lib/prerender.ts'

/** After `vite build`: writes crawlable event pages, a sitemap and robots.txt into dist/. */
const DIST = resolve(import.meta.dirname, '../dist')
const indexPath = resolve(DIST, 'data/events.json')
if (!existsSync(indexPath)) {
  console.info('No dist/data/events.json: skipping prerender.')
  process.exit(0)
}
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as EventIndex
const ids: string[] = []
for (const e of index.events) {
  const path = resolve(DIST, `data/event-${e.id}.json`)
  if (!existsSync(path)) continue
  const dir = resolve(DIST, 'events', e.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'index.html'), renderEventPage(JSON.parse(readFileSync(path, 'utf8')) as EventPayload))
  ids.push(e.id)
}
writeFileSync(resolve(DIST, 'sitemap.xml'), renderSitemap(ids, new Date().toISOString().slice(0, 10)))
writeFileSync(resolve(DIST, 'robots.txt'), ROBOTS)
console.info(`Prerendered ${ids.length} event pages, sitemap.xml and robots.txt.`)
