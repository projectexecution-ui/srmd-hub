/** Material requests, and the approval rule that decides how far one travels
 *  before a keeper may act on it.
 *
 *  Everything here is pure. The point of putting the approval dial in a tested
 *  function rather than inside the action is that "who has to say yes, and when"
 *  is the part somebody will argue about six months from now.
 *
 *  The one non-obvious rule: the dial is READ ONCE, when the request is raised,
 *  and frozen onto it. If the admin later changes the setting, a request already
 *  in flight keeps the rule it was judged under. A pending request that silently
 *  changes its own requirements is unauditable.
 */

export type RequestStatus =
  | 'pending' | 'approved' | 'rejected' | 'part_issued' | 'issued' | 'cancelled'

/** How much approval a request needs. */
export type ApprovalRule =
  /** Nobody approves. The keeper sees it and issues it. */
  | 'off'
  /** Every request waits for an Atm Head. */
  | 'always'
  /** Only requests worth more than the threshold wait. */
  | 'above_value'

export type ApprovalConfig = {
  rule: ApprovalRule
  /** Rupees. Only meaningful for `above_value`. */
  threshold: number
  /** 1 = an Atm Head. 2 = an Atm Head, then a Trustee. */
  stages: 1 | 2
}

export const DEFAULT_APPROVAL: ApprovalConfig = { rule: 'off', threshold: 0, stages: 1 }

export const RULE_LABEL: Record<ApprovalRule, string> = {
  off: 'No approval — the storekeeper issues it',
  always: 'Every request needs approval',
  above_value: 'Only requests above a value need approval',
}

/** What a request is worth, for the threshold. Uses each item's last known
 *  rate, so it is indicative — and a line with no rate contributes nothing
 *  rather than silently counting as free material. */
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

/** How many approvals THIS request needs, decided once at raise time.
 *
 *  A request under an `above_value` rule whose value cannot be estimated at all
 *  is treated as needing approval. The alternative is letting an unpriced
 *  request skip the gate, which is exactly the hole somebody would find. */
export function stagesNeeded(
  cfg: ApprovalConfig,
  est: { value: number; partial: boolean },
  anyLinePriced: boolean,
): number {
  if (cfg.rule === 'off') return 0
  if (cfg.rule === 'always') return cfg.stages
  if (!anyLinePriced) return cfg.stages
  return est.value > cfg.threshold ? cfg.stages : 0
}

/** In one sentence, why this request is or is not waiting — shown to the person
 *  raising it BEFORE they submit, so approval is never a surprise. */
export function approvalPreview(
  cfg: ApprovalConfig,
  est: { value: number; partial: boolean },
  anyLinePriced: boolean,
  money: (n: number) => string,
): string {
  const stages = stagesNeeded(cfg, est, anyLinePriced)
  if (stages === 0) {
    return cfg.rule === 'above_value'
      ? `Goes straight to the storekeeper — under the ${money(cfg.threshold)} approval limit.`
      : 'Goes straight to the storekeeper. No approval needed.'
  }
  const who = stages === 2 ? 'an Atm Head and then a Trustee' : 'an Atm Head'
  if (cfg.rule === 'always') return `Waits for ${who} before the storekeeper can issue it.`
  if (!anyLinePriced) {
    return `Waits for ${who}: no item here has a known rate, so it cannot be shown to be under the `
      + `${money(cfg.threshold)} limit.`
  }
  return `Waits for ${who} — about ${money(est.value)}${est.partial ? '+' : ''}, over the `
    + `${money(cfg.threshold)} limit.`
}

// ===========================================================================
// Raising one
// ===========================================================================

export type RequestLineInput = {
  itemId: string
  qty: number
  note?: string | null
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

/** Why this approval is refused, or null to record it.
 *
 *  Two rules carry the weight. A requester cannot approve his own request —
 *  that is the whole point of the stage. And in a two-stage chain the same
 *  person cannot fill both, or "Atm Head then Trustee" is one signature
 *  wearing two hats. */
export function approveBlocker(
  r: RequestState,
  actorId: string | null,
  canApprove: boolean,
): string | null {
  if (r.status === 'cancelled') return `${r.reqNo} was cancelled.`
  if (r.status === 'rejected') return `${r.reqNo} was already rejected.`
  if (r.status !== 'pending') {
    return `${r.reqNo} is not waiting for approval — it is already ${STATUS_LABEL[r.status].toLowerCase()}.`
  }
  if (r.stagesNeeded === 0) return `${r.reqNo} does not need approval.`
  if (r.stagesDone >= r.stagesNeeded) return `${r.reqNo} already has every approval it needs.`
  if (!canApprove) return 'Only an admin or Atm Head can approve a request.'
  if (actorId && r.requestedBy === actorId) {
    return 'You raised this request, so you cannot approve it. That is the point of the approval.'
  }
  if (actorId && r.approvers.includes(actorId)) {
    return 'You have already approved this request. The second approval has to be somebody else.'
  }
  return null
}

/** The status a request lands in once an approval is recorded. */
export function statusAfterApproval(r: RequestState): RequestStatus {
  return r.stagesDone + 1 >= r.stagesNeeded ? 'approved' : 'pending'
}

export const REJECT_REASON_MIN = 6

export function rejectBlocker(
  r: RequestState,
  reason: string,
  canApprove: boolean,
): string | null {
  if (r.status !== 'pending') {
    return `${r.reqNo} is not waiting for approval — it is already ${STATUS_LABEL[r.status].toLowerCase()}.`
  }
  if (!canApprove) return 'Only an admin or Atm Head can reject a request.'
  if (reason.trim().length < REJECT_REASON_MIN) {
    return 'Give a reason. A rejection the requester cannot act on just gets raised again tomorrow.'
  }
  return null
}

/** Can the keeper issue against this request yet? */
export function issuableBlocker(r: RequestState): string | null {
  if (r.status === 'pending') {
    const left = r.stagesNeeded - r.stagesDone
    return `${r.reqNo} is still waiting for ${left} ${left === 1 ? 'approval' : 'approvals'}. `
      + 'Nothing can be issued against it yet.'
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
  approved: 'With the storekeeper',
  rejected: 'Rejected',
  part_issued: 'Part issued',
  issued: 'Issued',
  cancelled: 'Cancelled',
}

export const STATUS_TONE: Record<RequestStatus, 'wait' | 'go' | 'bad' | 'part' | 'done' | 'dead'> = {
  pending: 'wait',
  approved: 'go',
  rejected: 'bad',
  part_issued: 'part',
  issued: 'done',
  cancelled: 'dead',
}

/** Requests still needing something from somebody. */
export function isOpen(s: RequestStatus): boolean {
  return s === 'pending' || s === 'approved' || s === 'part_issued'
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
