import { resolve } from 'node:path'
import { scanDirectory } from './lib/bundleScan.ts'

/** Fails when the built site contains something shaped like a provider key, or the exact value of one in this environment. */
const dist = resolve(import.meta.dirname, '../dist')
const secrets = [process.env.ODDS_API_KEY, process.env.UFCALENDAR_API_KEY].filter((v): v is string => Boolean(v?.trim()))
const findings = scanDirectory(dist, secrets)
if (findings.length > 0) {
  for (const f of findings) console.error(`SECRET? ${f.rule} in ${f.file.replace(dist, 'dist')}`)
  process.exit(1)
}
console.info(`No secrets found in dist/ (checked for ${secrets.length} exact value${secrets.length === 1 ? '' : 's'} and key-shaped patterns).`)
