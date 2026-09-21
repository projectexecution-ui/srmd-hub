// Shared shapes + tiny helpers for per-indent chase notes. Client-safe
// (no server imports) so both the API route and the browser components use
// the same type.

export type ChaseNote = {
  indentNo: string
  note: string
  lastChasedAt: string | null
  updatedByName: string | null
  updatedAt: string
}

/** Whole days since an ISO timestamp, or null if unparseable. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return Math.floor((Date.now() - ms) / 86_400_000)
}

/** "today" / "1 day ago" / "5 days ago" from an ISO timestamp. */
export function chasedLabel(iso: string | null | undefined): string | null {
  const d = daysSince(iso)
  if (d == null) return null
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

/** Compact form: "today" / "5d". */
export function chasedLabelShort(iso: string | null | undefined): string | null {
  const d = daysSince(iso)
  if (d == null) return null
  return d <= 0 ? 'today' : `${d}d`
}

/**
 * How fresh the last follow-up is, so the UI can nudge a re-chase instead of
 * flashing a reassuring green tick on a week-old follow-up:
 *   recent = followed up in the last 3 days   (green — handled)
 *   aging  = 4–7 days ago                      (amber — keep an eye)
 *   stale  = over a week ago                   (rose — follow up again)
 */
export type ChaseTier = 'recent' | 'aging' | 'stale'
export function chaseTier(iso: string | null | undefined): ChaseTier | null {
  const d = daysSince(iso)
  if (d == null) return null
  if (d <= 3) return 'recent'
  if (d <= 7) return 'aging'
  return 'stale'
}
