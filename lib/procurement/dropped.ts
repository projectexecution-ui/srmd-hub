// Shared shapes + key helper for the "not ordering" (dropped) list.
// Client-safe. The key is content-based (indent + block + material) so a
// drop survives the next IN4 upload even though line row-ids are positional.

export type DroppedLine = {
  lineKey: string
  indentNo: string
  material: string
  block: string
  reason: string | null
  droppedAt: string
  droppedByName: string | null
}

/** Stable content key for a line, used to remember drops across uploads. */
export function dropKey(ln: { indentNo: string; block: string; material: string }): string {
  return `${ln.indentNo}¦${ln.block ?? ''}¦${ln.material ?? ''}`
}
