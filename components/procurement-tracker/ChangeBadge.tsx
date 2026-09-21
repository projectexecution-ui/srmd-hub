'use client'
// Small pill rendered inside table rows to flag what's changed
// since the previous upload.
//
//   ● NEW       — line didn't exist in the prior upload (truly new
//                 material request, fresh indent etc.)
//   ● Updated   — line existed before but its status or pending qty
//                 has changed (got a PO, partial receipt landed, etc.)
//
// Deliberately small and quiet so the table stays scannable. The
// colour cues (emerald vs amber) tell the story before the eye
// even reads the label.

interface Props {
  /** Set of line ids that are new since the last upload. */
  newLineIds?: Set<string>
  /** Set of line ids that existed before but have changed. */
  changedLineIds?: Set<string>
  /** The line id to look up. */
  id: string
}

export function ChangeBadge({ newLineIds, changedLineIds, id }: Props) {
  if (newLineIds?.has(id)) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap align-middle"
        title="New since your last upload"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        New
      </span>
    )
  }
  if (changedLineIds?.has(id)) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 whitespace-nowrap align-middle"
        title="Status or pending qty changed since your last upload"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
        Updated
      </span>
    )
  }
  return null
}
