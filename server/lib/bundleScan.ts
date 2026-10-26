import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Finding {
  file: string
  rule: string
}

const PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: 'apiKey query value', re: /[?&]apiKey=[A-Za-z0-9]{12,}/ },
  { rule: 'ODDS_API_KEY assigned a value', re: /ODDS_API_KEY["']?\s*[:=]\s*["'][A-Za-z0-9_-]{12,}["']/ },
  { rule: 'UFCALENDAR_API_KEY assigned a value', re: /UFCALENDAR_API_KEY["']?\s*[:=]\s*["'][A-Za-z0-9_-]{12,}["']/ },
  { rule: 'X-Api-Key header with a value', re: /x-api-key["']?\s*[:=]\s*["'][A-Za-z0-9_-]{12,}["']/i },
  { rule: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

/** Looks for secret-shaped text, and for the exact values of any secrets the build environment holds. */
export function scanText(file: string, text: string, secrets: readonly string[] = []): Finding[] {
  const out: Finding[] = []
  for (const p of PATTERNS) if (p.re.test(text)) out.push({ file, rule: p.rule })
  for (const s of secrets) if (s.length >= 8 && text.includes(s)) out.push({ file, rule: 'exact value of a secret from the environment' })
  return out
}

const SCANNED = /\.(js|mjs|html|json|css|map|webmanifest|txt|xml)$/

export function scanDirectory(dir: string, secrets: readonly string[] = []): Finding[] {
  if (!existsSync(dir)) return []
  const out: Finding[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (SCANNED.test(name)) out.push(...scanText(path, readFileSync(path, 'utf8'), secrets))
    }
  }
  walk(dir)
  return out
}
