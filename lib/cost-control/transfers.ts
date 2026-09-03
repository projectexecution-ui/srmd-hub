// One vocabulary for a budget transfer, shared by the project screen, the
// approvals inbox and the billing queue — so the same request never gets
// described three different ways.

export type TransferStatus =
  | 'pending_atm'
  | 'pending_trustee'
  | 'awaiting_in4'
  | 'awaiting_sync'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'

export interface ProjectTransfer {
  id: string
  status: TransferStatus
  amount: number
  reason: string
  from_discipline_id: string
  from_sub_skill_id: string
  from_label: string
  to_discipline_id: string
  to_sub_skill_id: string
  to_label: string
  raised_at: string | null
  raised_by_name: string | null
  /** Answered by the database from auth.uid(), not by comparing names. */
  raised_by_me: boolean
  atm_at: string | null
  atm_by_name: string | null
  atm_comment: string | null
  trustee_at: string | null
  trustee_by_name: string | null
  trustee_comment: string | null
  in4_at: string | null
  in4_by_name: string | null
  confirmed_at: string | null
  settle_note: string | null
  closed_at: string | null
  closed_by_name: string | null
  closed_reason: string | null
}

/** Still moving through the chain — worth showing on the line it affects. */
export function isOpen(s: TransferStatus): boolean {
  return s === 'pending_atm' || s === 'pending_trustee'
      || s === 'awaiting_in4' || s === 'awaiting_sync'
}

/** Short label for a row chip. Says whose turn it is, not just where it sits,
 *  because "waiting" alone tells the reader nothing they can act on. */
export function shortLabel(s: TransferStatus): string {
  switch (s) {
    case 'pending_atm':     return 'With the Atm Head'
    case 'pending_trustee': return 'With the Trustee'
    case 'awaiting_in4':    return 'To do in IN4'
    case 'awaiting_sync':   return 'Awaiting IN4 proof'
    case 'confirmed':       return 'Done'
    case 'rejected':        return 'Turned down'
    case 'cancelled':       return 'Withdrawn'
  }
}

/** One sentence explaining what this state means and what happens next. */
export function explain(s: TransferStatus): string {
  switch (s) {
    case 'pending_atm':
      return 'Raised, and waiting for the Atm Head to approve it. No budget has moved.'
    case 'pending_trustee':
      return 'The Atm Head has signed it. Waiting for the Trustee. No budget has moved.'
    case 'awaiting_in4':
      return 'Fully approved. Nothing changes until somebody makes the move in IN4 — CT Hub never writes a budget itself.'
    case 'awaiting_sync':
      return 'Recorded as done in IN4. The next sync checks both lines and closes this once the figures agree.'
    case 'confirmed':
      return 'The sync found both lines moved by the approved amount.'
    case 'rejected':
      return 'Not approved, so no budget moved.'
    case 'cancelled':
      return 'Withdrawn by the person who raised it.'
  }
}

/** Tailwind classes for a chip. Amber while somebody owes an action, blue
 *  while waiting on evidence, green once proved, grey once closed. */
export function chipClasses(s: TransferStatus): string {
  switch (s) {
    case 'pending_atm':
    case 'pending_trustee':
      return 'bg-amber-100 text-amber-900 border-amber-200'
    case 'awaiting_in4':
      return 'bg-orange-100 text-orange-900 border-orange-200'
    case 'awaiting_sync':
      return 'bg-blue-100 text-blue-900 border-blue-200'
    case 'confirmed':
      return 'bg-emerald-100 text-emerald-900 border-emerald-200'
    case 'rejected':
    case 'cancelled':
      return 'bg-gray-100 text-gray-600 border-gray-200'
  }
}

/** A transfer whose figures did not match IN4. It stays open on purpose, and
 *  the note says what actually moved — the case most worth surfacing. */
export function isMismatched(t: { status: TransferStatus; settle_note: string | null }): boolean {
  return t.status === 'awaiting_sync' && (t.settle_note ?? '').startsWith('IN4 does not match')
}
