import { useCallback, useState } from 'react'

export const TZ_OPTIONS: { id: string; label: string }[] = [
  { id: 'venue', label: 'Venue time' },
  { id: 'America/New_York', label: 'US Eastern' },
  { id: 'America/Chicago', label: 'US Central' },
  { id: 'America/Los_Angeles', label: 'US Pacific' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Central Europe' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'device', label: 'My device' },
  { id: 'UTC', label: 'UTC' },
]

const KEY = 'octaiq.tz'

/** The IANA zone to format in: the venue's, the device's, or a named one. */
export function resolveZone(choice: string, venueZone: string): string {
  if (choice === 'venue') return venueZone
  if (choice === 'device') {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || venueZone
    } catch {
      return venueZone
    }
  }
  return TZ_OPTIONS.some((o) => o.id === choice) ? choice : venueZone
}

export function loadZoneChoice(): string {
  try {
    const v = localStorage.getItem(KEY)
    return v && TZ_OPTIONS.some((o) => o.id === v) ? v : 'venue'
  } catch {
    return 'venue'
  }
}

/** The visitor's chosen display time zone, remembered in this browser. */
export function useZoneChoice(): [string, (id: string) => void] {
  const [choice, setChoice] = useState(loadZoneChoice)
  const set = useCallback((id: string) => {
    setChoice(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* Not remembered. */
    }
  }, [])
  return [choice, set]
}
