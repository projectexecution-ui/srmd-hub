/** Material requests: raising one, and tracking how far it has been fulfilled.
 *
 *  WHO approves and WHEN is not here — that moved to `approval-matrix.ts`, on
 *  top of the hub's shared `approval_rules` table, so Aksha edits the chain at
 *  /admin/approvals instead of asking me. This file keeps only what is not
 *  configurable: what makes a request valid, what it is worth, and how much of
 *  it has actually been issued.
 *
 *  Everything here is pure.
 */

/** The stages a request can sit in.
 *
 *  `checked` is what makes an arbitrary chain expressible in approval_rules
 *  rows alone: pending → checked → approved is a two-stage chain, and a
 *  pending → approved row with an amount cap is "this role alone, up to here". */
export type RequestStatus =
  | 'pending' | 'checked' | 'approved' | 'rejected' | 'part_issued' | 'issued' | 'cancelled'

/** What a request is worth, so the approval matrix has a number to compare
 *  against its amount caps. Each item's last known rate, so indicative only —
 *  and a line with no rate contributes NOTHING rather than silently counting as
 *  free material. Frozen onto the request at raise time: the value is a fact
 *  about the request, unlike the chain, which is live configuration. */
export function estimateValue(
  lines: Array<{ qty: number; lastRate: number | null }>,
): { value: number; partial: boolean } {
  let value = 0
  let partial = false
  for (const l of lines) {
    if (l.lastRate == null) { partial = true; continue }
    value += l.qty * l.lastRate
  }
  return { value, partial }
}

// ===========================================================================
// Raising one
// ===========================================================================

export type RequestLineInput = {
  itemId: string
  qty: number
  note?: string | null
  /** A tool or formwork that has to come back, ticked per LINE — one pour
   *  routinely mixes cement that gets consumed with plates that do not. */
  isReturnable?: boolean
}

export type RaiseInput = {
  fromLocationId: string
  toLocationId: string | null
  projectId: string | null
  purpose: string
  needBy: string | null
  lines: RequestLineInput[]
}

export const PURPOSE_MIN = 4

/** Why this request cannot be raised, as a sentence — or null to go ahead. */
export function raiseBlocker(input: RaiseInput, today: string): string | null {
  if (!input.fromLocationId) return 'Pick the store you are asking.'
  if (input.toLocationId && input.toLocationId === input.fromLocationId) {
    return 'The store you are asking and the store it should go to are the same — nothing would move.'
  }
  if (input.purpose.trim().length < PURPOSE_MIN) {
    return 'Say what it is for in a few words. The storekeeper decides what to hand over from this.'
  }
  const lines = input.lines.filter(l => l.itemId && l.qty > 0)
  if (lines.length === 0) return 'Add at least one item with a quantity.'
  const ids = new Set(lines.map(l => l.itemId))
  if (ids.size !== lines.length) {
    return 'The same item is on this request twice. Put the whole quantity on one line.'
  }
  if (input.needBy && input.needBy < today) {
    return 'The date needed is in the past. Pick today or later.'
  }
  return null
}

/** Stock at the store being asked, so the requester is told BEFORE submitting
 *  that half of what he wants is not there. Never a refusal — asking for
 *  material a store has not got is how the store learns to order it. */
export type ShortLine = { itemName: string; wanted: number; available: number; unit: string }

export function shortfalls(
  lines: RequestLineInput[],
  onHand: Map<string, { qty: number; itemName: string; unit: string }>,
): ShortLine[] {
  const out: ShortLine[] = []
  for (const l of lines) {
    if (!l.itemId || l.qty <= 0) continue
    const have = onHand.get(l.itemId)
    const available = have?.qty ?? 0
    if (l.qty > available) {
      out.push({
        itemName: have?.itemName ?? 'that item',
        wanted: l.qty,
        available,
        unit: have?.unit ?? '',
      })
    }
  }
  return out
}

// ===========================================================================
// Moving one along
// ===========================================================================

export type RequestState = {
  reqNo: string
  status: RequestStatus
  stagesNeeded: number
  stagesDone: number
  requestedBy: string | null
  /** Who has already approved, so one person cannot fill two stages. */
  approvers: Array<string | null>
}

/** Can the keeper issue against this request yet? */
export function issuableBlocker(r: RequestState): string | null {
  if (r.status === 'pending' || r.status === 'checked') {
    return `${r.reqNo} has not finished the approval chain yet. `
      + 'Nothing can be issued against it until it reaches the storekeeper.'
  }
  if (r.status === 'rejected') return `${r.reqNo} was rejected.`
  if (r.status === 'cancelled') return `${r.reqNo} was cancelled.`
  if (r.status === 'issued') return `${r.reqNo} is fully issued. Nothing is outstanding.`
  return null
}

export type FulfilLine = { qty: number; issuedQty: number }

export function outstanding(l: FulfilLine): number {
  return Math.max(0, l.qty - l.issuedQty)
}

/** Where a request stands once an issue has been recorded against it. */
export function statusAfterIssue(lines: FulfilLine[]): RequestStatus {
  const anyIssued = lines.some(l => l.issuedQty > 0)
  const allDone = lines.every(l => outstanding(l) === 0)
  if (allDone) return 'issued'
  return anyIssued ? 'part_issued' : 'approved'
}

/** How complete a request is, 0-100, for the list and the report. */
export function fulfilledPct(lines: FulfilLine[]): number {
  const want = lines.reduce((s, l) => s + l.qty, 0)
  if (want <= 0) return 0
  const got = lines.reduce((s, l) => s + Math.min(l.qty, l.issuedQty), 0)
  return Math.round((got / want) * 100)
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for approval',
  checked: 'Checked, waiting for release',
  approved: 'With the storekeeper',
  rejected: 'Rejected',
  part_issued: 'Part issued',
  issued: 'Issued',
  cancelled: 'Cancelled',
}

export const STATUS_TONE: Record<RequestStatus, 'wait' | 'go' | 'bad' | 'part' | 'done' | 'dead'> = {
  pending: 'wait',
  checked: 'wait',
  approved: 'go',
  rejected: 'bad',
  part_issued: 'part',
  issued: 'done',
  cancelled: 'dead',
}

/** Requests still needing something from somebody. */
export function isOpen(s: RequestStatus): boolean {
  return s === 'pending' || s === 'checked' || s === 'approved' || s === 'part_issued'
}

/** How long a request has been waiting, in days. Ageing is what makes a
 *  request queue self-policing: nobody argues with "8 days". */
export function ageDays(requestDate: string, today: string): number {
  const a = Date.parse(`${requestDate}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export const STALE_REQUEST_DAYS = 3

export function isStale(requestDate: string, today: string, status: RequestStatus): boolean {
  return isOpen(status) && ageDays(requestDate, today) >= STALE_REQUEST_DAYS
}
