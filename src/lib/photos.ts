import { useEffect, useState } from 'react'
import { getJson, withBase } from './fetchJson'
import { slugify } from './slug'

/**
 * Fighter portraits are shown only when public/data/photos.json lists one with its licence and credit. The file ships empty:
 * no portrait is added until its licence has been checked, so a guess can never put the wrong face or an unlicensed image on a card.
 */
export interface Photo {
  url: string
  credit: string
  licence: string
  sourceUrl: string
}

export type PhotoMap = Record<string, Photo>

const isPhoto = (p: unknown): p is Photo => {
  const o = p as Photo
  return typeof p === 'object' && p !== null && /^https:\/\//.test(o.url) && Boolean(o.credit) && Boolean(o.licence) && /^https:\/\//.test(o.sourceUrl)
}

export function parsePhotos(body: unknown): PhotoMap {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {}
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([, v]) => isPhoto(v))) as PhotoMap
}

let cache: Promise<PhotoMap> | null = null
const load = (): Promise<PhotoMap> =>
  (cache ??= getJson(withBase('data/photos.json')).then((r) => (r.ok ? parsePhotos(r.body) : {})).catch(() => ({})))

/** The licensed portrait for a fighter, if the site has one. */
export function usePhoto(name: string): Photo | undefined {
  const [photos, setPhotos] = useState<PhotoMap>({})
  useEffect(() => {
    let alive = true
    void load().then((p) => alive && setPhotos(p))
    return () => { alive = false }
  }, [])
  return photos[slugify(name)]
}
