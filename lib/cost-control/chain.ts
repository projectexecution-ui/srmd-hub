// The 3-stage approval chain's brain — pure functions, no DB, fully unit
// tested (chain.test.ts). Every working sheet, regardless of amount, walks:
//
//   draft ─submit→ submitted ─PH→ ph_approved ─AtmHead→ atm_approved
//         ─Trustee→ (partially_approved)* → approved → wo_issued → paid
//
// with `returned` reachable from any pending stage (resubmit restarts at
// stage 1). Sign-offs (Project Head, Atm Head) are full-sheet; money moves
// only at the Trustee stage via cc_approve_release (tranches allowed).
//
// The DB's approval_rules matrix + enforce_approval_via_matrix trigger is
// the real gate — these helpers only drive UI decisions and pre-checks.

export type ChainStatus =
  | 'draft'
  | 'draft_blocked'
  | 'submitted'
  | 'ph_approved'
  | 'atm_approved'
  | 'partially_approved'
  | 'approved'
  | 'returned'
  | 'wo_issued'
  | 'paid'
  | 'cancelled'

/** Statuses that count as "waiting on someone in the chain". */
export const PENDING_STATUSES = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved'] as const
export type PendingStatus = (typeof PENDING_STATUSES)[number]

export function isPendingStatus(status: string): status is PendingStatus {
  return (PENDING_STATUSES as readonly string[]).includes(status)
}

/** Which stage a pending sheet is waiting on — drives inbox grouping. */
export function awaitingLabel(status: string): 'Project Head' | 'Atm Head' | 'Trustee' | null {
  switch (status) {
    case 'submitted':           return 'Project Head'
    case 'ph_approved':         return 'Atm Head'
    case 'atm_approved':
    case 'partially_approved':  return 'Trustee'
    default:                    return null
  }
}

/** The next SIGN-OFF transition for a sheet, or null when the next step is
 *  not a sign-off (Trustee release, or the sheet isn't in a sign-off stage). */
export function nextSignOffStage(status: string): 'ph_approved' | 'atm_approved' | null {
  if (status === 'submitted') return 'ph_approved'
  if (status === 'ph_approved') return 'atm_approved'
  return null
}

/** Whether the Trustee release (cc_approve_release) applies at this status. */
export function canReleaseFrom(status: string): boolean {
  return status === 'atm_approved' || status === 'partially_approved'
}

/** Whether a return-for-revision is possible from this status. */
export function canReturnFrom(status: string): boolean {
  return isPendingStatus(status)
}

/** Whether the engineer can edit + submit at this status. */
export function canSubmitFrom(status: string): boolean {
  return status === 'draft' || status === 'returned'
}

// ─── Stepper ────────────────────────────────────────────────────────────
// Visual: Submitted → Project Head → Atm Head → Trustee. stageIndexFor
// returns how many steps are DONE (0-4); -1 = not in the chain (cancelled).

export const CHAIN_STEPS = ['Submitted', 'Project Head', 'Atm Head', 'Trustee'] as const

export function stageIndexFor(status: string): number {
  switch (status) {
    case 'draft':
    case 'draft_blocked':
    case 'returned':            return 0  // nothing signed yet
    case 'submitted':           return 1  // submitted done, waiting on PH
    case 'ph_approved':         return 2  // PH done, waiting on Atm Head
    case 'atm_approved':        return 3  // Atm done, waiting on Trustee
    case 'partially_approved':  return 3  // Trustee mid-release
    case 'approved':
    case 'wo_issued':
    case 'paid':                return 4  // full chain complete
    case 'cancelled':           return -1
    default:                    return 0  // unknown → degrade safely
  }
}

/** Plain-word status for laymen — no raw enum values in the UI. */
export function plainStatusLabel(status: string): string {
  switch (status) {
    case 'draft':               return 'Being prepared — not sent yet'
    case 'draft_blocked':       return 'Draft on hold'
    case 'submitted':           return 'Waiting for the Project Head to check'
    case 'ph_approved':         return 'Project Head signed off — waiting for the Atm Head'
    case 'atm_approved':        return 'Atm Head signed off — waiting for the Trustee'
    case 'partially_approved':  return 'Trustee has released part of the amount'
    case 'approved':            return 'Fully approved — ready to enter in IN4'
    case 'returned':            return 'Sent back for changes'
    case 'wo_issued':           return 'Work order issued'
    case 'paid':                return 'Paid'
    case 'cancelled':           return 'Cancelled'
    default:                    return status.replace(/_/g, ' ')
  }
}

// ─── Management / reviewer predicate ────────────────────────────────────
// Someone is "management" (sees big numbers + AI review tools) when their
// effective cost-control role appears on ANY active approval rule for the
// module — or they're admin. Config-driven: editing /admin/approvals
// automatically retargets who counts as management.

export interface RuleLite {
  approver_role: string | null
  override_role?: string | null
}

export function isManagementRole(role: string | null | undefined, activeRules: RuleLite[]): boolean {
  if (!role) return false
  if (role === 'admin') return true
  return activeRules.some(r => r.approver_role === role || r.override_role === role)
}

// ── Trustee stage: one figure walks the chain ──────────────────────────────
//
// Aksha, 7 Oct 2026 (SRAH-1302-Q02): "the amount checked by Project head n
// Atm head is same and Chirag Shah amt is different … this cannot happen" and
// "Previous approved adjusted in this Approval - that is not right". So the
// Trustee approves the SAME figure the Atm Head checked: never more (a
// round-up belongs at the Atm Head's check), and money approved on earlier
// versions is not netted into it. Mirrors cc_approve_release's cap.

export interface TrusteeApproval {
  /** What is still to approve on THIS sheet: checked minus approved so far. */
  balance: number
  /** Why the typed amount cannot go — shown inline, never a silent block. */
  error: string | null
  /** True when the typed amount is less than the balance (sheet stays partly approved). */
  partial: boolean
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

export function trusteeApproval(checked: number, approvedSoFar: number, amount: number | null | undefined): TrusteeApproval {
  const cap = Number.isFinite(checked) ? checked : 0
  const already = Number.isFinite(approvedSoFar) ? Math.max(approvedSoFar, 0) : 0
  const balance = Math.max(cap - already, 0)
  if (balance <= 0.5) {
    return { balance: 0, error: `Nothing left to approve — the Atm Head's ${inr(cap)} is already approved on this sheet.`, partial: false }
  }
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return { balance, error: 'Enter an amount greater than zero.', partial: false }
  }
  if (amount > balance + 0.5) {
    return {
      balance,
      error: `${inr(amount)} is more than the Atm Head checked. The Trustee approves the same figure (${inr(cap)}); ${inr(balance)} is still to approve. A round-up belongs at the Atm Head's check.`,
      partial: false,
    }
  }
  return { balance, error: null, partial: amount < balance - 0.5 }
}
