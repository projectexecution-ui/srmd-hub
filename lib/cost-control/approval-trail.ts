// Reading an approval trail entry back apart.
//
// A sign-off stores the checked figure INSIDE the comment —
// "Checked ₹51,27,656 — Ok to go ahead have checked the Working" — because
// approval_events has no amount column. Displayed raw, that reads as our
// bookkeeping welded to the front of somebody's sentence, and when the
// approver also types the figure himself (they usually do) the same number
// appears twice in one line.
//
// So: pull the two apart, and let the caller decide whether the number still
// needs showing.

export interface SplitComment {
  /** The person's own words, or null if they only left the amount. */
  comment: string | null
  /** The figure they typed at sign-off, or null if this is not a sign-off. */
  checked: number | null
}

export function splitCheckedComment(raw: string | null | undefined): SplitComment {
  if (!raw) return { comment: null, checked: null }
  const m = raw.match(/^\s*Checked\s+₹\s*([\d,]+(?:\.\d+)?)\s*(?:[—-]\s*([\s\S]*))?$/)
  if (!m) return { comment: raw, checked: null }
  const checked = Number(m[1].replace(/,/g, ''))
  const rest = (m[2] ?? '').trim()
  return { comment: rest || null, checked: Number.isFinite(checked) ? checked : null }
}

/** Did the approver already state this figure in their own remark? If so the
 *  trail should not print it a second time. Compares digits only, so
 *  "51,27,656/-" and "₹51,27,656" count as the same number. */
export function remarkRepeatsAmount(comment: string | null, checked: number | null): boolean {
  if (checked == null || !comment) return false
  return comment.replace(/[^0-9]/g, '').includes(String(Math.round(checked)))
}
