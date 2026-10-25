/** Fighter-name normalisation so odds feeds and stats files can be joined. */

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Order-insensitive key, so "Park Jun-ho" and "Jun-ho Park" collide. */
function tokenKey(name: string): string {
  return normalizeName(name).split(' ').filter(Boolean).sort().join(' ')
}

export function sameName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b) || tokenKey(a) === tokenKey(b)
}

export interface NameIndex<T> {
  find(name: string): T | undefined
}

export function buildNameIndex<T>(items: readonly T[], nameOf: (item: T) => string): NameIndex<T> {
  const exact = new Map<string, T>()
  const tokens = new Map<string, T>()
  for (const item of items) {
    exact.set(normalizeName(nameOf(item)), item)
    tokens.set(tokenKey(nameOf(item)), item)
  }
  return {
    find: (name) => exact.get(normalizeName(name)) ?? tokens.get(tokenKey(name)),
  }
}

export function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, '-')
}
