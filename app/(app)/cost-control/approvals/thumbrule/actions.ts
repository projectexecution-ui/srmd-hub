'use server'
// Server action: bulk-approve thumbrule Working Sheets.
//
// Loops through the selected WSes and calls the existing single-WS
// approval flow for each (approveWorkingSheet + record_approval_event).
// This preserves all the per-row matrix checks, audit logging, and budget-
// line side-effects — bulk is just a UX wrapper over N normal approvals.
//
// Returns a per-row outcome list so the UI can show "8 approved, 2
// blocked by matrix" without aborting the whole batch on the first
// failure.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { approveWorkingSheet } from '@/components/cost-control/ws-actions'

const schema = z.object({
  ws_ids: z.array(z.string().uuid()).min(1, 'Tick at least one sheet').max(50, 'Approve max 50 at a time'),
  comment: z.string().max(2000).nullable(),
})

export interface BulkApprovalResult {
  ws_id: string
  ws_code: string
  ok: boolean
  error?: string
}

export type BulkOutcome =
  | { ok: true; results: BulkApprovalResult[] }
  | { ok: false; error: string }

export async function bulkApproveThumbrule(input: {
  ws_ids: string[]
  comment: string | null
}): Promise<BulkOutcome> {
  await requirePermission('cost-control', 'edit')
  const me = await getMyUser()
  if (!me) return { ok: false, error: 'Not signed in' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  // Snapshot the WSes up front so we can capture ws_code + amount for the
  // event log even if approveWorkingSheet later changes status.
  const { data: wsRows } = await supabase
    .from('cc_working_sheets')
    .select('id, ws_code, total_amount, approved_for_erp_amt, status, entry_mode')
    .in('id', parsed.data.ws_ids)
  const snap = new Map((wsRows ?? []).map(w => [w.id, w]))

  const results: BulkApprovalResult[] = []
  for (const wsId of parsed.data.ws_ids) {
    const ws = snap.get(wsId)
    if (!ws) {
      results.push({ ws_id: wsId, ws_code: '?', ok: false, error: 'Not found' })
      continue
    }
    if (ws.entry_mode !== 'thumbrule') {
      results.push({ ws_id: wsId, ws_code: ws.ws_code, ok: false, error: 'Not a thumbrule sheet' })
      continue
    }
    if (ws.status !== 'submitted' && ws.status !== 'partially_approved') {
      results.push({ ws_id: wsId, ws_code: ws.ws_code, ok: false, error: `Status is ${ws.status} — can't approve` })
      continue
    }

    // Approve the FULL remaining amount in one shot — bulk path doesn't
    // try to support partial releases (the user can still do that per-row
    // from the WS detail page if they want).
    const r = await approveWorkingSheet(wsId, null)
    if (!r.ok) {
      results.push({ ws_id: wsId, ws_code: ws.ws_code, ok: false, error: r.error ?? 'Approve failed' })
      continue
    }

    // Log into approval_events so the audit trail is identical to a
    // single-row approval. The shared comment is attached to each event.
    const total = Number(ws.total_amount ?? 0)
    const already = Number(ws.approved_for_erp_amt ?? 0)
    const releasedNow = Math.max(total - already, 0)
    const { error: recErr } = await supabase.rpc('record_approval_event', {
      p_module_slug: 'cost-control',
      p_doc_type:    'cc_working_sheet',
      p_doc_table:   'cc_working_sheets',
      p_doc_id:      wsId,
      p_from_stage:  ws.status,
      p_to_stage:    'approved',
      p_decision:    'approved',
      p_comment:     parsed.data.comment,
      p_attachments: [],
      p_amount:      releasedNow,
    })
    if (recErr) {
      results.push({ ws_id: wsId, ws_code: ws.ws_code, ok: true, error: `Approved but event log failed: ${recErr.message}` })
      continue
    }
    results.push({ ws_id: wsId, ws_code: ws.ws_code, ok: true })
  }

  revalidatePath('/cost-control/approvals')
  revalidatePath('/cost-control/approvals/thumbrule')
  revalidatePath('/cost-control/working-sheets')
  return { ok: true, results }
}
