/**
 * What a SearchableSelect actually shows, and in what order.
 *
 * Split out of the component because this is the part that can be wrong in a
 * way nobody notices: a pinned item listed twice, a heading opening a second
 * time halfway down, a filter that hides the row that is already selected.
 * The JSX around it is a loop. This is testable; that is why it is here.
 */

export interface SelectOption {
  id: string
  label: string
  hint?: string
  /** Heading this option sits under. Options must arrive grouped. */
  group?: string
}

export interface ArrangedRow {
  o: SelectOption
  /** The heading above this row, or undefined for no heading. */
  band?: string
}

/** Case-insensitive match on the label or the hint. */
export function filterOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...options]
  return options.filter(o =>
    o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
  )
}

/**
 * Pinned rows first under their own heading, then everything else under the
 * headings the options carry.
 *
 * A pinned option is NOT repeated below — one row means one place to tap, and
 * a list where the same item appears twice makes a storekeeper wonder which
 * one is the real one. Pinned ids that the filter has removed simply do not
 * appear: "recent" should never resurrect a row the search excluded.
 */
export function arrangeOptions(
  filtered: readonly SelectOption[],
  pinned: readonly string[] = [],
  pinnedLabel = 'Used here lately',
): ArrangedRow[] {
  if (pinned.length === 0) return filtered.map(o => ({ o, band: o.group }))

  const byId = new Map(filtered.map(o => [o.id, o]))
  const top: SelectOption[] = []
  for (const id of pinned) {
    const hit = byId.get(id)
    // Guard against a duplicated id in `pinned` as well as one missing.
    if (hit && !top.some(t => t.id === id)) top.push(hit)
  }
  const topIds = new Set(top.map(o => o.id))

  return [
    ...top.map(o => ({ o, band: pinnedLabel })),
    ...filtered.filter(o => !topIds.has(o.id)).map(o => ({ o, band: o.group })),
  ]
}

/** Whether a row should print its heading — true when it starts a new band. */
export function startsBand(rows: readonly ArrangedRow[], i: number): boolean {
  const band = rows[i]?.band
  return band != null && band !== rows[i - 1]?.band
}
