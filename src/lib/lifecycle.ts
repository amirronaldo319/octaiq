export type Stage = 'published' | 'updated' | 'locked' | 'graded'

export interface StageInfo {
  stage: Stage
  label: string
  /** One sentence for the visitor */
  detail: string
}

interface LedgerLike {
  lockedAt: string
  entries: number
  status: 'upcoming' | 'awaiting-results' | 'graded'
}

/**
 * Where a card's saved forecast stands: Published (saved, can still be replaced by a newer version), Updated
 * (replaced at least once), Locked (the event has begun, so the saved forecast is final), Graded (results are in).
 */
export function stageOf(e: LedgerLike, now: number): StageInfo {
  if (e.status === 'graded') return { stage: 'graded', label: 'Graded', detail: 'The fights are in the results data and each saved pick has been scored.' }
  if (now >= Date.parse(e.lockedAt)) {
    return {
      stage: 'locked',
      label: 'Locked',
      detail: e.status === 'awaiting-results' ? 'The event is over. Waiting for the results data to include it.' : 'The event has started, so the saved forecast is final.',
    }
  }
  return e.entries > 1
    ? { stage: 'updated', label: 'Updated', detail: 'Saved more than once. The latest version counts until the event starts.' }
    : { stage: 'published', label: 'Published', detail: 'Saved. A newer version replaces it if the card or the data changes, until the event starts.' }
}

export const STAGES: readonly Stage[] = ['published', 'updated', 'locked', 'graded']
