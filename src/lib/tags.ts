import type { ResultsModelBout } from '../engine/eventTypes'

export interface Tag {
  label: string
  tone: 'warn' | 'info'
}

const RULES: { test: RegExp; tag: Tag }[] = [
  { test: /check before relying|retire|cancel/i, tag: { label: 'Check before relying', tone: 'warn' } },
  { test: /replac|stepped in|short.?notice|withdr/i, tag: { label: 'Replacement opponent', tone: 'warn' } },
  { test: /title bout|title fight|championship/i, tag: { label: 'Title fight', tone: 'info' } },
  { test: /record is|does not (say|show)|only one (secondary )?source|older listings?|one older listing|disagree/i, tag: { label: 'Unconfirmed details', tone: 'warn' } },
  { test: /early prelim/i, tag: { label: 'Early prelims', tone: 'info' } },
]

/** What the card's free-text notes mean, as short labels a visitor can scan. */
export function noteTags(notes: readonly string[]): Tag[] {
  const found = new Map<string, Tag>()
  for (const n of notes) for (const r of RULES) if (r.test.test(n)) found.set(r.tag.label, r.tag)
  // A replacement note usually also mentions old listings; keep the more specific label first.
  return [...found.values()].sort((a, b) => RULES.findIndex((r) => r.tag.label === a.label) - RULES.findIndex((r) => r.tag.label === b.label))
}

export interface Quality {
  level: 'Good' | 'Fair' | 'Limited'
  reasons: string[]
}

const THIN = 3
const WIDE_RANGE = 0.25

/**
 * How well supported a forecast is, separate from how lopsided it is. A heavy favourite can still rest on thin data.
 * Drops one step for each of: a fighter with few UFC fights, a wide likely range, unconfirmed details; and straight to
 * Limited when the card itself says to check before relying on the bout.
 */
export function dataQuality(
  names: { a: string; b: string },
  results: Pick<ResultsModelBout, 'priorA' | 'priorB' | 'probLo' | 'probHi'> | undefined,
  tags: readonly Tag[],
): Quality {
  if (!results) return { level: 'Limited', reasons: ['No model forecast for this bout yet.'] }
  const reasons: string[] = []
  let drops = 0
  for (const [name, n] of [[names.a, results.priorA], [names.b, results.priorB]] as const) {
    if (n < THIN) {
      reasons.push(n === 0 ? `${name} has no UFC fights in the data.` : `${name} has only ${n} UFC fight${n === 1 ? '' : 's'} in the data.`)
      drops++
    }
  }
  if (results.probLo !== undefined && results.probHi !== undefined && results.probHi - results.probLo > WIDE_RANGE) {
    reasons.push('The likely range is wide, so the answer depends a lot on which past fights are used.')
    drops++
  }
  if (tags.some((t) => t.label === 'Unconfirmed details')) {
    reasons.push('Some details of this bout are unconfirmed.')
    drops++
  }
  if (tags.some((t) => t.label === 'Replacement opponent')) reasons.push('A late replacement means less preparation time than usual.')
  const check = tags.some((t) => t.label === 'Check before relying')
  if (check) reasons.push('The card notes say to check this bout before relying on it.')
  const level: Quality['level'] = check || drops >= 2 ? 'Limited' : drops === 1 ? 'Fair' : 'Good'
  return { level, reasons: reasons.length ? reasons : ['Both fighters have a track record in the data and the range is narrow.'] }
}
