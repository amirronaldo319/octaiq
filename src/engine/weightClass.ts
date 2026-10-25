const CLASS_ORDER = ['strawweight', 'flyweight', 'bantamweight', 'featherweight', 'lightweight', 'welterweight', 'middleweight', 'light heavyweight', 'heavyweight']
/** 1 (strawweight) to 9 (heavyweight) from a results-file weight class; null for catch weight, open weight and unknowns. */
export function weightClassIndex(name: string): number | null {
  const t = name.toLowerCase()
  let found: number | null = null
  CLASS_ORDER.forEach((c, i) => {
    if (t.includes(c) && (found === null || c.length > CLASS_ORDER[found - 1].length)) found = i + 1
  })
  return found
}
