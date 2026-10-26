/**
 * The named forecast horizons, by hours before the main card. A forecast is saved when a card enters a new horizon even if its
 * probabilities have not moved, so each horizon can be graded on its own: early (announced), 30 days, 14 days, 7 days, 72 hours,
 * 24 hours, and the final lock window (the last six hours before the lock).
 */
export const HORIZONS: { id: string; label: string; maxHours: number }[] = [
  { id: 'early', label: 'Early (more than 30 days out)', maxHours: Infinity },
  { id: '30d', label: '30 days before', maxHours: 30 * 24 },
  { id: '14d', label: '14 days before', maxHours: 14 * 24 },
  { id: '7d', label: '7 days before', maxHours: 7 * 24 },
  { id: '72h', label: '72 hours before', maxHours: 72 },
  { id: '24h', label: '24 hours before', maxHours: 24 },
  { id: 'final', label: 'Final pre-fight window', maxHours: 6 },
]

export function horizonOf(recordedAt: string, mainCardStart: string): string {
  const hours = (Date.parse(mainCardStart) - Date.parse(recordedAt)) / 3_600_000
  let id = HORIZONS[0].id
  for (const h of HORIZONS) if (hours <= h.maxHours) id = h.id
  return id
}
