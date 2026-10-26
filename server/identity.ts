import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { latestSnapshot, parseEventFile } from './lib/event.ts'
import { listEventFiles } from './lib/eventService.ts'
import { buildIdentity, type IdentityResult } from './lib/identity.ts'
import { loadAliases, loadDataset } from './backtest/resultsModel.ts'

/**
 * Checks every fighter name on the tracked cards against the results data and writes data/identity/report.json.
 * Exact, reordered and reviewed-alias matches are accepted; ambiguous or near-miss names are quarantined for a person.
 */
const ROOT = resolve(import.meta.dirname, '..')
const data = loadDataset(ROOT)
if (!data) {
  console.error('Dataset not downloaded. Run `npm run fetch-data` first.')
  process.exit(1)
}
const known = new Map<string, { key: string; externalId: string | null; ambiguous: boolean }>()
for (const [key, p] of data.profiles) known.set(key, { key, externalId: p.externalId ?? null, ambiguous: p.ambiguous ?? false })
for (const b of data.bouts) for (const key of [b.a, b.b]) if (!known.has(key)) known.set(key, { key, externalId: null, ambiguous: false })
const match = buildIdentity([...known.values()], loadAliases(ROOT))

const names = new Set<string>()
for (const f of listEventFiles(resolve(ROOT, 'data/events')).files) {
  for (const b of latestSnapshot(parseEventFile(JSON.parse(readFileSync(f.path, 'utf8')))).bouts) {
    names.add(b.a.name)
    names.add(b.b.name)
  }
}
const results: IdentityResult[] = [...names].sort().map((n) => match(n))
const counts = results.reduce<Record<string, number>>((c, r) => ({ ...c, [r.kind]: (c[r.kind] ?? 0) + 1 }), {})
const report = {
  generatedAt: new Date().toISOString(),
  checked: results.length,
  counts,
  // A newcomer with no similar name is not an error: it is simply not in the results data yet.
  quarantined: results.filter((r) => r.quarantined),
  newcomers: results.filter((r) => r.kind === 'unmatched' && !r.quarantined).map((r) => r.input),
  mapping: results.filter((r) => r.internalId).map((r) => ({ name: r.input, internalId: r.internalId, externalId: r.externalId, via: r.kind })),
}
mkdirSync(resolve(ROOT, 'data/identity'), { recursive: true })
const out = resolve(ROOT, 'data/identity/report.json')
// Keep the file stable between runs unless the content changed.
let previous = ''
try { previous = readFileSync(out, 'utf8') } catch { /* first run */ }
const text = JSON.stringify(report, null, 2) + '\n'
const strip = (t: string): string => t.replace(/"generatedAt": "[^"]*"/, '')
if (strip(previous) !== strip(text)) writeFileSync(out, text)
console.info(`Checked ${results.length} names: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}. ${report.quarantined.length} need review, ${report.newcomers.length} look like newcomers.`)
for (const q of report.quarantined) console.info(`  REVIEW ${q.input} (${q.kind})${q.candidates.length ? `: maybe ${q.candidates.map((c) => c.name).join(' / ')}` : ''}`)
