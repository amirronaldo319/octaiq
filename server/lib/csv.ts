import type { Fighter, Style } from '../../src/engine/types.ts'
import { slugify } from './names.ts'

/** Minimal RFC-4180 style parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const num = (row: Record<string, string>, key: string): number | undefined => {
  const raw = row[key]
  if (raw === undefined || raw === '' || raw === '--') return undefined
  const v = Number(raw.replace('%', ''))
  return Number.isFinite(v) ? v : undefined
}

/** Accepts 0.55 or 55 (or "55%") and returns 0.55. */
const pct = (v: number): number => Math.min(1, Math.max(0, v > 1 ? v / 100 : v))

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function inferStyle(slpm: number, tdAvg: number, subAvg: number): Style {
  if (tdAvg >= 2.5) return 'Wrestler'
  if (subAvg >= 1.2) return 'Grappler'
  if (slpm >= 4.5) return 'Pressure'
  if (slpm >= 3.5) return 'Striker'
  return 'Counter'
}

function ageFrom(row: Record<string, string>, now: Date): number | undefined {
  const age = num(row, 'age')
  if (age !== undefined) return age
  const dob = Date.parse(row.dob ?? '')
  if (Number.isNaN(dob)) return undefined
  return Math.floor((now.getTime() - dob) / (365.25 * 86_400_000))
}

function layoffFrom(row: Record<string, string>, now: Date): number | undefined {
  const days = num(row, 'days_since_last_fight')
  if (days !== undefined) return days
  const last = Date.parse(row.last_fight_date ?? '')
  if (Number.isNaN(last)) return undefined
  return Math.max(0, Math.floor((now.getTime() - last) / 86_400_000))
}

const REQUIRED = ['name', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'] as const

export interface FighterParseResult {
  fighters: Fighter[]
  warnings: string[]
}

/**
 * Convert CSV rows to fighters. Rows missing a required stat are skipped with a warning.
 * Optional columns fall back to neutral defaults (see docs in data/README.md).
 */
export function rowsToFighters(rows: readonly Record<string, string>[], now = new Date()): FighterParseResult {
  const fighters: Fighter[] = []
  const warnings: string[] = []
  rows.forEach((row, i) => {
    const missing = REQUIRED.filter((k) => (k === 'name' ? !row.name : num(row, k) === undefined))
    if (missing.length > 0) {
      warnings.push(`Row ${i + 2} (${row.name || 'unnamed'}): missing ${missing.join(', ')}; skipped`)
      return
    }
    const slpm = num(row, 'slpm') as number
    const tdAvg = num(row, 'td_avg') as number
    const subAvg = num(row, 'sub_avg') ?? 0.3
    const style = (row.style as Style | undefined) || inferStyle(slpm, tdAvg, subAvg)
    fighters.push({
      id: slugify(row.name),
      name: row.name,
      record: row.record || '—',
      age: ageFrom(row, now) ?? 30,
      reachCm: num(row, 'reach_cm') ?? 180,
      style,
      slpm,
      strikeAcc: pct(num(row, 'str_acc') as number),
      strikeDef: pct(num(row, 'str_def') as number),
      tdPer15: tdAvg,
      tdDef: pct(num(row, 'td_def') as number),
      subPer15: subAvg,
      finishRate: pct(num(row, 'finish_rate') ?? 0.5),
      chin: clamp01(num(row, 'chin') ?? 0.65),
      cardio: clamp01(num(row, 'cardio') ?? 0.75),
      layoffDays: layoffFrom(row, now) ?? 300,
    })
  })
  return { fighters, warnings }
}

export function parseFighterCsv(text: string, now = new Date()): FighterParseResult {
  return rowsToFighters(parseCsv(text), now)
}
