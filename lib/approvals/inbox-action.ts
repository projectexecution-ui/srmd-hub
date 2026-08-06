// One shared, layman-friendly phrasing for an approval-inbox badge.
//
// An inbox item is waiting on THIS viewer, so the badge should name the action
// they take — an imperative to-do — not the destination stage. Showing the
// stage ("Final approval", or worse the raw code "atm_approved → approved")
// reads like a status: it's ambiguous whether the item is done or still needs
// you. A verb ("Approve", "Send back") removes that doubt.
//
// `next_stage` is where the item moves once the viewer acts; we map it to the
// action that gets it there. Unknown stages fall back to a readable Title Case
// of the code so nothing ever renders as a broken snippet.

const NEXT_STAGE_ACTION: Record<string, string> = {
  // Cost Control / Internal Estimate + Indents
  approved: 'Approve (final)',
  ph_approved: 'Approve',
  atm_approved: 'Approve',
  partially_approved: 'Release part',
  returned: 'Send back',
  submitted: 'Submit',
  deadline_set: 'Set deadline',
  verify: 'Verify',
  // Common across modules
  rejected: 'Reject',
  declined: 'Reject',
  issued: 'Issue',
  received: 'Receive',
}

export function inboxActionLabel(nextStage: string | null | undefined): string {
  if (!nextStage) return 'Open'
  const hit = NEXT_STAGE_ACTION[nextStage]
  if (hit) return hit
  return nextStage.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
}
