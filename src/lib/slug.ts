/** Mirrors the server's name normalisation so a fighter's slug is identical on both sides. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export const slugify = (name: string): string => normalizeName(name).replace(/ /g, '-')
