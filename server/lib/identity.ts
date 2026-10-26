import { normalizeName } from './names.ts'

/**
 * How a name on a card relates to the results data. Only an exact name, the same words in another order, or a reviewed alias is
 * accepted automatically. Anything that merely looks similar is quarantined for a person to decide: a wrong match would attach
 * someone else's whole career to a fighter.
 */
export type MatchKind = 'exact' | 'reordered' | 'alias' | 'ambiguous' | 'unmatched'

export interface Candidate {
  name: string
  distance: number
}

export interface IdentityResult {
  input: string
  kind: MatchKind
  /** Normalised key in the results data, when matched */
  key: string | null
  /** The data source's own fighter ID and the internal ID built from it */
  externalId: string | null
  internalId: string | null
  /** Possible matches for a person to review; never applied automatically */
  candidates: Candidate[]
  /** True when a person should look at this name */
  quarantined: boolean
}

export interface KnownFighter {
  key: string
  externalId?: string | null
  ambiguous?: boolean
}

const tokenKey = (name: string): string => normalizeName(name).split(' ').filter(Boolean).sort().join(' ')

/** Edit distance with an early exit; names more than `limit` apart are not worth comparing. */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > limit) return limit + 1
    prev = cur
  }
  return prev[b.length]
}

export const internalIdOf = (externalId: string | null | undefined): string | null => (externalId ? `fi_${externalId}` : null)

export function buildIdentity(known: readonly KnownFighter[], aliases: Readonly<Record<string, string>> = {}): (name: string) => IdentityResult {
  const exact = new Map(known.map((k) => [k.key, k]))
  const byTokens = new Map<string, KnownFighter[]>()
  for (const k of known) byTokens.set(tokenKey(k.key), [...(byTokens.get(tokenKey(k.key)) ?? []), k])
  const result = (input: string, kind: MatchKind, f: KnownFighter | null, candidates: Candidate[] = []): IdentityResult => ({
    input, kind, key: f?.key ?? null, externalId: f?.externalId ?? null, internalId: internalIdOf(f?.externalId),
    candidates, quarantined: kind === 'ambiguous' || kind === 'unmatched' && candidates.length > 0,
  })
  return (input) => {
    const n = normalizeName(input)
    const aliased = aliases[n]
    const direct = exact.get(n)
    if (direct) return direct.ambiguous ? result(input, 'ambiguous', direct) : result(input, 'exact', direct)
    if (aliased) {
      const a = exact.get(normalizeName(aliased))
      if (a) return a.ambiguous ? result(input, 'ambiguous', a) : result(input, 'alias', a)
    }
    const sameWords = byTokens.get(tokenKey(n))
    if (sameWords?.length === 1) return result(input, 'reordered', sameWords[0])
    if (sameWords && sameWords.length > 1) return result(input, 'ambiguous', null, sameWords.map((f) => ({ name: f.key, distance: 0 })))
    const near = known
      .map((k) => ({ name: k.key, distance: editDistance(n, k.key) }))
      .filter((c) => c.distance <= 2)
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
      .slice(0, 3)
    return result(input, 'unmatched', null, near)
  }
}
