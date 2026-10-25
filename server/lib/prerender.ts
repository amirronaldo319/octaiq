import type { EventPayload } from '../../src/engine/eventTypes.ts'

export const SITE = 'https://amirronaldo319.github.io/octaiq/'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Safe in a JSON-LD script tag: "<" is escaped so the data can never close the tag. */
const jsonLd = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c')

/**
 * A plain, crawlable page for one event: a title, a description, the card with the model's picks, and a link
 * into the app. The app itself uses hash links, which search engines treat as one page.
 */
export function renderEventPage(p: EventPayload): string {
  const url = `${SITE}events/${p.event.id}/`
  const appUrl = `${SITE}#/event/${encodeURIComponent(p.event.id)}`
  const date = new Date(p.event.mainCardStart).toLocaleDateString('en-US', { timeZone: p.event.timeZone ?? 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
  const title = `${p.event.title}: predictions and odds (${date})`
  const description = `Win probabilities, method odds and the betting-market view for every fight on ${p.event.title} at ${p.event.venue}, ${p.event.city}. Picks are saved before the event and graded in public.`
  const bouts = [...p.fights].sort((a, b) => (a.bout?.order ?? 0) - (b.bout?.order ?? 0))
  const items = bouts.map((f) => {
    const r = p.resultsModel.bouts[f.id]
    const pick = r ? (r.probA >= 0.5 ? f.a.name : f.b.name) : null
    const pct = r ? Math.round(Math.max(r.probA, r.probB) * 100) : null
    return `<li><strong>${esc(f.a.name)}</strong> vs <strong>${esc(f.b.name)}</strong> (${esc(f.weightClass)})${pick ? `: model picks ${esc(pick)} at ${pct}%` : ''}</li>`
  }).join('\n      ')
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: p.event.title,
    startDate: p.event.mainCardStart,
    sport: 'Mixed martial arts',
    location: { '@type': 'Place', name: p.event.venue, address: p.event.city },
    url,
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="OctaIQ" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${SITE}og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${jsonLd(ld)}</script>
    <style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5}a{color:#2c5fe0}</style>
  </head>
  <body>
    <main>
      <h1>${esc(p.event.title)}</h1>
      <p>${esc(date)} · ${esc(p.event.venue)}, ${esc(p.event.city)}</p>
      <p><a href="${esc(appUrl)}">Open the interactive card</a> for probabilities, ranges, method odds and the market comparison.</p>
      <ol>
      ${items}
      </ol>
      <p><small>OctaIQ is a research project, not betting advice. In past tests, betting prices were more accurate than this model.</small></p>
    </main>
  </body>
</html>
`
}

export function renderSitemap(eventIds: readonly string[], lastmod: string): string {
  const urls = [SITE, ...eventIds.map((id) => `${SITE}events/${id}/`)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`
}

export const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`
