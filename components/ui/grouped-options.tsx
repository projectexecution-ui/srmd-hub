/**
 * <option>s for a native <select> whose rows already carry a `group`, wrapped
 * in an <optgroup> per heading.
 *
 * Native <optgroup> on purpose: it costs nothing, it needs no library, and iOS
 * shows the headings inside its own picker wheel, which a custom dropdown
 * would have to reinvent badly. For a list long enough to need typing rather
 * than scrolling — items at 659 — reach for SearchableSelect instead.
 *
 * Rows must arrive with their groups contiguous (groupProjects sorts them that
 * way); a repeated heading opens a second box rather than merging.
 */
import { Fragment } from 'react'

export interface GroupedRow {
  id: string
  name: string
  group: string
  /** Shown after the name when two rows would otherwise read alike. */
  code?: string | null
}

export function GroupedOptions({
  rows, showCode = false,
}: {
  rows: ReadonlyArray<GroupedRow>
  showCode?: boolean
}) {
  const groups: Array<{ label: string; rows: GroupedRow[] }> = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.label === r.group) last.rows.push(r)
    else groups.push({ label: r.group, rows: [r] })
  }
  return (
    <>
      {groups.map((g, i) => (
        <Fragment key={`${g.label}-${i}`}>
          <optgroup label={g.label}>
            {g.rows.map(r => (
              <option key={r.id} value={r.id}>
                {showCode && r.code ? `${r.code} — ${r.name}` : r.name}
              </option>
            ))}
          </optgroup>
        </Fragment>
      ))}
    </>
  )
}
