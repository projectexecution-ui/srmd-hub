/** What is still genuinely to come on a purchase order.
 *
 *  The trap this exists to close: IN4 has been running for years, and 1,122 of
 *  the 1,316 POs in the tracker were fully delivered before this system existed.
 *  The import brought across `ordered_qty` and threw IN4's received quantity
 *  away, so every imported line presented its FULL ordered quantity as still to
 *  come — 1,373,374 units of material that had already arrived and been largely
 *  consumed. A keeper working down that list at the gate would have booked all
 *  of it in a second time, on top of the opening balance that is the truth.
 *
 *  So a PO line carries THREE numbers, not two:
 *    ordered        — what the order said
 *    receivedBefore — what IN4 had already received when this PO was imported
 *    receivedAtGate — what has since arrived through our own gate
 *
 *  `receivedBefore` is a FROZEN SNAPSHOT taken at import. It must never be
 *  refreshed from a later IN4 upload: once a PO is in this system, deliveries
 *  against it are recorded at the gate, and re-reading IN4 would subtract the
 *  same delivery twice.
 */

export type PoLineNumbers = {
  ordered: number
  /** IN4's already-received quantity, frozen at import. */
  receivedBefore: number
  /** Received through our own gate since. */
  receivedAtGate: number
}

/** Everything received, from either side of the cutover. What a keeper means
 *  when he asks "how much of this has come". */
export function totalReceived(n: PoLineNumbers): number {
  return n.receivedBefore + n.receivedAtGate
}

/** Still to come. Floored at zero: over-delivery is a real thing and it is
 *  reported by the over-receipt control report, but it is never a NEGATIVE
 *  amount still to come. */
export function linePending(n: PoLineNumbers): number {
  const left = n.ordered - totalReceived(n)
  return left > 0 ? left : 0
}

/** Has this line got anything left worth a trip to the gate? */
export function lineDone(n: PoLineNumbers): boolean {
  return linePending(n) <= 0
}

export type PoStatus = 'open' | 'partly_received' | 'fully_received' | 'short_closed'

/** The status a PO's own numbers imply.
 *
 *  `short_closed` is never returned: that is a human decision to stop waiting
 *  for material that will not come, and no arithmetic can infer it. Callers must
 *  leave a short-closed PO alone — see `nextStatus`. */
export function derivedStatus(lines: PoLineNumbers[]): Exclude<PoStatus, 'short_closed'> {
  if (lines.length === 0) return 'open'
  const pending = lines.reduce((s, l) => s + linePending(l), 0)
  if (pending <= 0) return 'fully_received'
  const received = lines.reduce((s, l) => s + totalReceived(l), 0)
  return received > 0 ? 'partly_received' : 'open'
}

/** The status to store, respecting a decision a person already made.
 *
 *  A short-closed PO stays short-closed even if a late delivery turns up: the
 *  person who closed it is the one who reopens it. */
export function nextStatus(current: PoStatus | null, lines: PoLineNumbers[]): PoStatus {
  if (current === 'short_closed') return 'short_closed'
  return derivedStatus(lines)
}

/** Does this PO belong in the gate's picker at all?
 *
 *  Only orders with material genuinely still to come. A completed order that
 *  stays selectable is an invitation to book a delivery twice — and the whole
 *  point here is to make that mistake impossible rather than merely visible. */
export function offerAtGate(status: PoStatus, lines: PoLineNumbers[]): boolean {
  if (status === 'short_closed' || status === 'fully_received') return false
  return lines.length === 0 || lines.some(l => !lineDone(l))
}
