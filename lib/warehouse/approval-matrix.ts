/** Warehouse requests, governed by the hub's shared approval matrix.
 *
 *  This replaces a private three-position dial I had built. The hub already had
 *  a full engine — `approval_rules` rows, `can_approve()`, and a trigger that
 *  refuses an unauthorised transition IN THE DATABASE — and Aksha already drives
 *  it for Cost Control, Indents, JMR and the old inventory module. A second,
 *  weaker config system beside it was the wrong call: it meant the one thing he
 *  asked for, changing the flow himself, needed me.
 *
 *  What the matrix owns: which ROLE may move a request from one stage to the
 *  next, up to what value, whether a remark is compulsory, who may override.
 *  All of it editable at /admin/approvals.
 *
 *  What this module still owns, because the matrix has no concept of it:
 *    • the requester may never approve his own request
 *    • one person may never fill two stages of the same chain
 *  Those are facts about a PERSON, not about a role, so no row could express
 *  them. Everything else is configuration.
 */

export const MODULE = 'warehouse'
export const DOC_TYPE = 'wh_request'

/** One editable hop in the chain. */
export type Rule = {
  fromStage: string
  toStage: string
  approverRole: string
  overrideRole: string | null
  /** Null means no ceiling. */
  amountCapMax: number | null
  requiresRemarks: boolean
  notes: string | null
}

/** A move this person can actually make on this request, right now. */
export type Move = {
  toStage: string
  /** True when the matrix insists on a remark for this hop. */
  needsRemarks: boolean
  /** The rule that permits it, for explaining the decision. */
  via: Rule
}

/** Every hop out of `fromStage` that this role may take at this value.
 *
 *  Mirrors `can_approve()` deliberately: same role-or-override test, same cap
 *  test, same admin bypass. The database is the authority — this exists so the
 *  screen can show the right buttons instead of offering one and then failing. */
export function movesFor(
  rules: Rule[],
  fromStage: string,
  role: string | null,
  amount: number | null,
): Move[] {
  if (!role) return []
  const out: Move[] = []
  for (const r of rules) {
    if (r.fromStage !== fromStage) continue
    // An admin is allowed every configured hop, exactly as can_approve() has it.
    const roleOk = role === 'admin' || role === r.approverRole || role === r.overrideRole
    if (!roleOk) continue
    // A cap only bites when we know the amount. An unpriced request is not
    // silently treated as free — see `needsApproval` below.
    if (r.amountCapMax != null && amount != null && amount > r.amountCapMax) continue
    if (out.some(m => m.toStage === r.toStage)) continue
    out.push({ toStage: r.toStage, needsRemarks: r.requiresRemarks, via: r })
  }
  return out
}

/** Does a request at this stage need anybody's approval at all?
 *
 *  False when no active rule leads anywhere except an issue stage — which is how
 *  "no approval, the keeper just issues it" is expressed now: an admin deletes
 *  or deactivates the pending→approved rules and adds pending→approved for
 *  whoever should hold it, or none at all. */
export function needsApproval(rules: Rule[], fromStage: string): boolean {
  return rules.some(r =>
    r.fromStage === fromStage
    && r.toStage !== 'part_issued' && r.toStage !== 'issued'
    && r.toStage !== 'cancelled')
}

/** The chain as a sentence, for the requester and for Settings.
 *
 *  Reads the rules rather than describing a hard-coded design, so it cannot go
 *  stale the moment somebody edits a row — which is exactly what happened to the
 *  copy that claimed the registers grouped by trade. */
export function describeChain(
  rules: Rule[],
  roleLabel: (role: string) => string,
  money: (n: number) => string,
): string[] {
  const active = rules.filter(r => r.toStage !== 'rejected' && r.toStage !== 'cancelled')
  if (active.length === 0) return ['No approval is configured — a request goes straight to the storekeeper.']

  const lines: string[] = []
  const byFrom = new Map<string, Rule[]>()
  for (const r of active) {
    if (!byFrom.has(r.fromStage)) byFrom.set(r.fromStage, [])
    byFrom.get(r.fromStage)!.push(r)
  }
  const ORDER = ['pending', 'checked', 'approved', 'part_issued']
  for (const from of ORDER) {
    for (const r of byFrom.get(from) ?? []) {
      const cap = r.amountCapMax != null ? ` up to ${money(r.amountCapMax)}` : ''
      lines.push(`${STAGE_LABEL[from] ?? from} → ${STAGE_LABEL[r.toStage] ?? r.toStage}: `
        + `${roleLabel(r.approverRole)}${cap}`
        + `${r.overrideRole ? `, or ${roleLabel(r.overrideRole)}` : ''}`
        + `${r.requiresRemarks ? ' · a remark is compulsory' : ''}`)
    }
  }
  return lines
}

/** What a request at this stage is waiting for, in one line, for the requester.
 *
 *  Names the ROLE from the rules rather than a hard-coded "Atm Head", so the
 *  sentence follows whatever chain the admin has configured. */
export function waitingOn(
  rules: Rule[],
  fromStage: string,
  amount: number | null,
  roleLabel: (role: string) => string,
  money: (n: number) => string,
): string {
  const next = rules.filter(r =>
    r.fromStage === fromStage && r.toStage !== 'rejected' && r.toStage !== 'cancelled'
    && r.toStage !== 'part_issued' && r.toStage !== 'issued')
  if (next.length === 0) return 'Goes straight to the storekeeper. No approval is configured.'

  // Which hop actually applies at this value? A cap that the request exceeds
  // rules that hop out, which is how "over two lakh needs a Trustee too" works
  // without anybody writing a threshold into code.
  const applies = next.filter(r =>
    r.amountCapMax == null || amount == null || amount <= r.amountCapMax)
  const chosen = applies.length > 0 ? applies : next

  const roles = [...new Set(chosen.map(r => roleLabel(r.approverRole)))]
  const capped = chosen.find(r => r.amountCapMax != null && amount != null && amount <= r.amountCapMax)

  const who = roles.length === 1 ? roles[0] : roles.slice(0, -1).join(', ') + ' or ' + roles.at(-1)
  if (capped && amount != null) {
    return `Waits for ${who} — about ${money(amount)}, within their ${money(capped.amountCapMax!)} limit.`
  }
  if (amount != null && next.some(r => r.amountCapMax != null && amount > r.amountCapMax)) {
    return `Waits for ${who} — about ${money(amount)}, over the limit one approval alone can release.`
  }
  return `Waits for ${who} before the storekeeper can issue it.`
}

export const STAGE_LABEL: Record<string, string> = {
  pending: 'Waiting for approval',
  checked: 'Checked, waiting for release',
  approved: 'With the storekeeper',
  rejected: 'Rejected',
  part_issued: 'Part issued',
  issued: 'Issued',
  cancelled: 'Cancelled',
}

/** Facts about the PERSON that no rule row could express. Kept separate from
 *  the matrix on purpose: these are not configuration and must not become
 *  editable, or the approval means nothing. */
export function personBlocker(
  actorId: string | null,
  requestedBy: string | null,
  previousApprovers: Array<string | null>,
): string | null {
  if (actorId && requestedBy === actorId) {
    return 'You raised this request, so you cannot approve it. That is the point of the approval.'
  }
  if (actorId && previousApprovers.includes(actorId)) {
    return 'You have already approved this request. The next stage has to be somebody else.'
  }
  return null
}
