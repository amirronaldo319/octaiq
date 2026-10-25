import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { devig } from '../../src/engine/odds.ts'
import { normalizeName } from '../lib/names.ts'
import type { Bout } from './dataset.ts'

/** OpenML dataset 43464, "UFC Fights (2010-2020) with Betting Odds", licensed CC BY 4.0 on OpenML. */
export const ODDS_SOURCE = {
  name: 'UFC Fights (2010-2020) with Betting Odds',
  page: 'https://www.openml.org/d/43464',
  url: 'https://openml.org/data/v1/download/22102289/UFC-Fights-(2010---2020)-with-Betting-Odds.arff',
  md5: '5a25fab3ff4bd389d40ce432462e4443',
  license: 'CC BY 4.0 (as labelled on OpenML)',
  attribution: 'UFC Fights (2010-2020) with Betting Odds, OpenML dataset 43464, CC BY 4.0. The original uploader is not named in the OpenML metadata.',
  file: 'ufc_odds.arff',
} as const

export interface OddsManifest {
  source: string
  license: string
  attribution: string
  md5: string
  bytes: number
  retrievedAt: string
}

export interface OddsRecord {
  date: number
  red: string
  blue: string
  redOdds: number
  blueOdds: number
  winner: 'Red' | 'Blue' | 'Draw'
}

/** Splits one ARFF data line, honouring single quotes and backslash escapes (e.g. 'Women\'s Strawweight'). */
export function splitArffLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue }
      if (c === "'") quoted = false
      else cur += c
    } else if (c === "'") quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((v) => v.trim())
}

const parseUsDate = (text: string): number | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  return m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null
}

export interface OddsParseStats {
  rows: number
  usable: number
  missingOrUnusable: number
}

/** Reads the ARFF and keeps rows with a date, valid American odds on both sides, and a known winner. */
export function parseOddsArff(text: string): { records: OddsRecord[]; stats: OddsParseStats } {
  const at = text.search(/^@DATA/im)
  if (at < 0) throw new Error('Not an ARFF file: no @DATA section')
  const attrs = [...text.slice(0, at).matchAll(/^@ATTRIBUTE\s+(\S+)/gim)].map((m) => m[1])
  const col = (name: string): number => {
    const i = attrs.indexOf(name)
    if (i < 0) throw new Error(`ARFF is missing the ${name} column`)
    return i
  }
  const [cr, cb, cro, cbo, cd, cw] = ['R_fighter', 'B_fighter', 'R_odds', 'B_odds', 'date', 'Winner'].map(col)
  const lines = text.slice(at).split(/\r?\n/).slice(1).filter((l) => l.trim() !== '' && !l.startsWith('%'))
  const records: OddsRecord[] = []
  for (const line of lines) {
    const f = splitArffLine(line)
    const date = parseUsDate(f[cd] ?? '')
    const ro = Number(f[cro])
    const bo = Number(f[cbo])
    const w = f[cw]
    const validOdds = (o: number): boolean => Number.isFinite(o) && Math.abs(o) >= 100
    if (date === null || !validOdds(ro) || !validOdds(bo) || (w !== 'Red' && w !== 'Blue' && w !== 'Draw')) continue
    records.push({ date, red: f[cr], blue: f[cb], redOdds: ro, blueOdds: bo, winner: w })
  }
  return { records, stats: { rows: lines.length, usable: records.length, missingOrUnusable: lines.length - records.length } }
}

export interface MarketLine {
  /** Margin-removed probability that bout.a wins */
  pA: number
  /** Sum of the two raw implied probabilities (1.00 = no margin) */
  overround: number
  oddsA: number
  oddsB: number
  /** 0 when the dataset date equals the results date, otherwise -1 or +1 */
  offsetDays: number
}

export interface MatchStats {
  records: number
  matched: number
  matchedExactDate: number
  matchedOffByOneDay: number
  unmatched: number
  ambiguous: number
  /** Matched pairs where the two sources name different winners (a data-quality alarm) */
  winnerDisagreements: number
  drawsSkipped: number
}

const tokenKey = (name: string): string => normalizeName(name).split(' ').filter(Boolean).sort().join(' ')
const pairKey = (a: string, b: string): string => [tokenKey(a), tokenKey(b)].sort().join('|')
const DAY = 86_400_000

/**
 * Joins odds to results by date and the unordered pair of fighter names. Dates may differ by a day
 * between sources; a one-day offset is accepted only when it yields exactly one candidate.
 * Joined prices are only for evaluation: they never feed into model features.
 */
export function matchOdds(bouts: readonly Bout[], records: readonly OddsRecord[]): { byBout: Map<string, MarketLine>; stats: MatchStats } {
  const index = new Map<string, Bout[]>()
  for (const b of bouts) {
    if (b.result !== 'a' && b.result !== 'b') continue
    const key = `${b.date}|${pairKey(b.nameA, b.nameB)}`
    index.set(key, [...(index.get(key) ?? []), b])
  }
  const stats: MatchStats = { records: records.length, matched: 0, matchedExactDate: 0, matchedOffByOneDay: 0, unmatched: 0, ambiguous: 0, winnerDisagreements: 0, drawsSkipped: 0 }
  const byBout = new Map<string, MarketLine>()

  for (const r of records) {
    if (r.winner === 'Draw') { stats.drawsSkipped++; continue }
    const pk = pairKey(r.red, r.blue)
    let found: { bout: Bout; offset: number } | null = null
    let ambiguous = false
    for (const offset of [0, -1, 1]) {
      const cands = index.get(`${r.date + offset * DAY}|${pk}`) ?? []
      if (cands.length === 1) { found = { bout: cands[0], offset }; break }
      if (cands.length > 1) { ambiguous = true; break }
    }
    if (!found) {
      if (ambiguous) stats.ambiguous++
      else stats.unmatched++
      continue
    }
    const { bout, offset } = found
    if (byBout.has(bout.id)) { stats.ambiguous++; continue }
    // Orient the prices to the bout's A corner.
    const redIsA = tokenKey(r.red) === tokenKey(bout.nameA)
    const oddsA = redIsA ? r.redOdds : r.blueOdds
    const oddsB = redIsA ? r.blueOdds : r.redOdds
    const fair = devig(oddsA, oddsB)
    const aWon = bout.result === 'a'
    const recordSaysAWon = (r.winner === 'Red') === redIsA
    if (aWon !== recordSaysAWon) stats.winnerDisagreements++
    byBout.set(bout.id, { pA: fair.a, overround: 1 + fair.vig, oddsA, oddsB, offsetDays: offset })
    stats.matched++
    if (offset === 0) stats.matchedExactDate++
    else stats.matchedOffByOneDay++
  }
  return { byBout, stats }
}

/** Downloads the ARFF to `dir` and verifies the MD5 that OpenML publishes. */
export async function fetchOddsDataset(
  dir: string,
  fetchText: (url: string) => Promise<string>,
  expectedMd5: string = ODDS_SOURCE.md5,
): Promise<OddsManifest> {
  mkdirSync(dir, { recursive: true })
  const text = await fetchText(ODDS_SOURCE.url)
  const md5 = createHash('md5').update(text).digest('hex')
  if (md5 !== expectedMd5) {
    throw new Error(`Downloaded odds file has MD5 ${md5}, expected ${expectedMd5}. Refusing to use it.`)
  }
  writeFileSync(join(dir, ODDS_SOURCE.file), text)
  const manifest: OddsManifest = {
    source: ODDS_SOURCE.page,
    license: ODDS_SOURCE.license,
    attribution: ODDS_SOURCE.attribution,
    md5,
    bytes: Buffer.byteLength(text),
    retrievedAt: new Date().toISOString(),
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
