import { resolve } from 'node:path'
import { recordLedgers } from './ledger/ledger.ts'
import { buildStaticEvents } from './lib/snapshot.ts'

const ROOT = resolve(import.meta.dirname, '..')

console.info('Computing predictions for every event (the probability ranges take a few seconds)...')
const { payloads } = await buildStaticEvents(ROOT, { bootstrap: 100 })
const results = recordLedgers(ROOT, payloads, new Date())
for (const r of results) console.info(`${r.recorded ? 'RECORDED' : 'skipped '}  ${r.eventId}: ${r.reason}`)
if (results.some((r) => r.recorded)) console.info('Commit data/ledger/ to make the record public.')
