'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyProfile, getMyPermissions, can } from '@/lib/auth'

// ---------- shared authorization helpers ----------

/** Read the caller's profile + cost-control perms in one go. */
async function whoAmI() {
  const [user, profile, perms] = await Promise.all([getMyUser(), getMyProfile(), getMyPermissions()])
  return {
    user,
    profile,
    isAdmin:    profile?.role === 'admin',
    canView:    can(perms, 'cost-control', 'view'),
    canEdit:    can(perms, 'cost-control', 'edit'),
    canCcAdmin: can(perms, 'cost-control', 'admin'),
  }
}

/** Whether the caller may set / change a WS deadline. Driven by the
 *  approval_rules row module_slug='cost-control', to_stage='deadline_set'.
 *  Admin / Head pass by default; others need an explicit rule via
 *  /admin/approvals. Used by forms + the inline edit button. */
export async function checkCanSetDeadline(): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  return callCanApprove('any', 'deadline_set', null)
}

/** Set or change the deadline on a working sheet. Allowed only when
 *  checkCanSetDeadline() returns true. Pass null to clear. */
export async function setWorkingSheetDeadline(
  wsId: string,
  deadlineDate: string | null,
  deadlineNotes: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }

  const allowed = await callCanApprove('any', 'deadline_set', null)
  if (!allowed) {
    return { ok: false, error: 'Only a Head (or Admin) can set the deadline. Update at /admin/approvals to allow other roles.' }
  }

  if (deadlineDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
    return { ok: false, error: 'Bad date format (expected yyyy-mm-dd)' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_working_sheets')
    .update({
      deadline_date: deadlineDate,
      deadline_notes: deadlineNotes && deadlineNotes.trim() ? deadlineNotes.trim() : null,
    })
    .eq('id', wsId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control')
  return { ok: true }
}

/** Public version of can_approve so server pages can decide which
 *  buttons to render. Mirrors the same RPC used by the actions. */
export async function checkCanApproveWS(wsId: string, toStage: 'approved' | 'returned'): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  const supabase = await createClient()
  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('engineer_id, status, total_amount')
    .eq('id', wsId)
    .single()
  if (!ws) return false
  if (ws.status !== 'submitted') return false
  if (ws.engineer_id === me.user.id && !me.isAdmin) return false
  return callCanApprove('submitted', toStage, Number(ws.total_amount ?? 0))
}

/** Asks the DB whether the caller may move this WS through this stage
 *  transition. Wraps public.can_approve() which already implements the
 *  approval_rules table + admin-always-allowed escape. */
async function callCanApprove(fromStage: string, toStage: string, amount: number | null): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('can_approve', {
    p_module_slug: 'cost-control',
    p_doc_type: 'cc_working_sheet',
    p_from_stage: fromStage,
    p_to_stage: toStage,
    p_amount: amount,
  })
  if (error) return false
  return !!data
}

// ============================================================
// Create a new Working Sheet
// ============================================================

const newWSSchema = z.object({
  project_id: z.string().uuid(),
  discipline_id: z.string().uuid(),
  sub_skill_id: z.string().uuid(),
  line_type: z.enum(['work', 'material']).default('work'),
  deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deadline_notes: z.string().max(500).nullable().optional(),
})

export type NewWSResult =
  | { ok: true; id: string; ws_code: string }
  | { ok: false; error: string }

async function nextWSCode(): Promise<string> {
  const supabase = await createClient()
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('cc_working_sheets')
    .select('id', { count: 'exact', head: true })
  const seq = String((count ?? 0) + 1).padStart(4, '0')
  return `WS-${year}-${seq}`
}

export async function createWorkingSheet(input: {
  project_id: string
  discipline_id: string
  sub_skill_id: string
  line_type?: 'work' | 'material'
  deadline_date?: string | null
  deadline_notes?: string | null
}): Promise<NewWSResult> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = newWSSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Validation failed' }

  const supabase = await createClient()
  const ws_code = await nextWSCode()

  // Deadlines are gated behind the 'deadline_set' approval rule. If
  // the caller can't set one, silently drop the fields from the
  // payload — the UI hides them too, but defence in depth.
  let safeDeadlineDate = parsed.data.deadline_date ?? null
  let safeDeadlineNotes = parsed.data.deadline_notes ?? null
  if (safeDeadlineDate || safeDeadlineNotes) {
    const mayDeadline = await callCanApprove('any', 'deadline_set', null)
    if (!mayDeadline) { safeDeadlineDate = null; safeDeadlineNotes = null }
  }

  // Snapshot past approved spend at creation time for the past-spend strip
  const { data: past } = await supabase
    .from('cc_working_sheets')
    .select('total_amount')
    .eq('project_id', parsed.data.project_id)
    .eq('sub_skill_id', parsed.data.sub_skill_id)
    .in('status', ['approved', 'wo_issued', 'paid'])
  const pastSnapshot = (past ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0)

  const { data, error } = await supabase
    .from('cc_working_sheets')
    .insert({
      ...parsed.data,
      ws_code,
      status: 'draft',
      engineer_id: user.id,
      total_amount: 0,
      past_approved_in_subskill: pastSnapshot,
      deadline_date:  safeDeadlineDate,
      deadline_notes: safeDeadlineNotes,
    })
    .select('id, ws_code')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed' }

  revalidatePath('/cost-control/working-sheets')
  revalidatePath(`/cost-control/projects/${parsed.data.project_id}`)
  return { ok: true, id: data.id, ws_code: data.ws_code }
}

// ============================================================
// Update header (vendor/location not on header for now; status transitions
// handled via submitWorkingSheet / approve / return). Item upserts below.
// ============================================================

export async function upsertWorkingSheetItem(item: {
  id?: string
  working_sheet_id: string
  sr_no: number
  description: string
  uom: string
  qty: number
  rate: number
  gst_pct: number
  vendor_id?: string | null
  location_tag?: string | null
  remark?: string | null
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  // Refuse if WS is not in draft (only engineer or head edits, but for v1 we
  // only allow item edits when status='draft'; head edits will come later).
  const supabase = await createClient()
  const { data: ws, error: wsErr } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, total_amount')
    .eq('id', item.working_sheet_id)
    .single()
  if (wsErr || !ws) return { ok: false, error: 'Working Sheet not found' }
  if (ws.status !== 'draft') return { ok: false, error: 'Sheet is locked (not in draft)' }

  const payload = {
    working_sheet_id: item.working_sheet_id,
    sr_no: item.sr_no,
    description: item.description,
    uom: item.uom,
    qty: item.qty,
    rate: item.rate,
    gst_pct: item.gst_pct,
    vendor_id: item.vendor_id ?? null,
    location_tag: item.location_tag ?? null,
    remark: item.remark ?? null,
  }

  let savedId: string | undefined
  if (item.id) {
    const { error } = await supabase.from('cc_working_sheet_items').update(payload).eq('id', item.id)
    if (error) return { ok: false, error: error.message }
    savedId = item.id
  } else {
    const { data, error } = await supabase.from('cc_working_sheet_items').insert(payload).select('id').single()
    if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed' }
    savedId = data.id
  }

  await recalculateWSTotal(item.working_sheet_id)
  revalidatePath(`/cost-control/working-sheets/${item.working_sheet_id}`)
  return { ok: true, id: savedId }
}

export async function deleteWorkingSheetItem(itemId: string, wsId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const supabase = await createClient()
  const { data: ws } = await supabase.from('cc_working_sheets').select('status').eq('id', wsId).single()
  if (!ws || ws.status !== 'draft') return { ok: false, error: 'Sheet is locked' }

  const { error } = await supabase.from('cc_working_sheet_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: error.message }

  await recalculateWSTotal(wsId)
  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  return { ok: true }
}

async function recalculateWSTotal(wsId: string) {
  const supabase = await createClient()
  const { data: items } = await supabase
    .from('cc_working_sheet_items')
    .select('total_amount')
    .eq('working_sheet_id', wsId)
  const sum = (items ?? []).reduce((s, r) => s + Number((r as { total_amount: number | null }).total_amount ?? 0), 0)
  await supabase.from('cc_working_sheets').update({ total_amount: sum }).eq('id', wsId)
}

// ============================================================
// State transitions
// ============================================================

export async function submitWorkingSheet(wsId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canEdit) return { ok: false, error: 'You do not have edit permission on Cost Control' }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, total_amount')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }
  if (ws.status !== 'draft' && ws.status !== 'returned') return { ok: false, error: 'Only drafts can be submitted' }
  if (!ws.total_amount || ws.total_amount <= 0) return { ok: false, error: 'Add at least one item with amount > 0 before submitting' }

  // Only the engineer who raised it (or an admin) can submit it.
  if (ws.engineer_id !== me.user.id && !me.isAdmin) {
    return { ok: false, error: 'Only the sheet owner can submit it for approval' }
  }

  const { error: updErr } = await supabase
    .from('cc_working_sheets')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), locked_at: new Date().toISOString(), locked_by: me.user.id })
    .eq('id', wsId)
  if (updErr) return { ok: false, error: updErr.message }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  return { ok: true }
}

export async function approveWorkingSheet(wsId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canView) return { ok: false, error: 'You do not have access to Cost Control' }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, project_id, discipline_id, sub_skill_id, line_type, total_amount')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }
  if (ws.status !== 'submitted') return { ok: false, error: 'Only submitted sheets can be approved' }

  // Self-approval is blocked unless the caller is an admin (escape hatch
  // for single-approver teams during rollout).
  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot approve a sheet you raised yourself' }
  }

  // The approval matrix says which role(s) may move submitted → approved
  // at this amount. Admin always passes inside can_approve().
  const allowed = await callCanApprove('submitted', 'approved', Number(ws.total_amount ?? 0))
  if (!allowed) {
    return { ok: false, error: 'Your role is not configured to approve this transition. Check /admin/approvals.' }
  }

  // Best-effort: find a matching budget line so we can write an event against it.
  // If none exists, write the event with budget_line_id=null but project_id set.
  const { data: bl } = await supabase
    .from('cc_budget_lines')
    .select('id')
    .eq('project_id', ws.project_id)
    .eq('discipline_id', ws.discipline_id)
    .eq('sub_skill_id', ws.sub_skill_id)
    .eq('line_type', ws.line_type)
    .maybeSingle()

  const { error: updErr } = await supabase
    .from('cc_working_sheets')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: me.user.id })
    .eq('id', wsId)
  if (updErr) return { ok: false, error: updErr.message }

  await supabase.from('cc_budget_events').insert({
    budget_line_id: bl?.id ?? null,
    project_id: ws.project_id,
    event_type: 'ws_approved',
    delta_amount: ws.total_amount ?? 0,
    related_ws_id: wsId,
    remarks: 'Working Sheet approved',
    requested_by: me.user.id,
    approved_by: me.user.id,
    approval_status: 'approved',
  })

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control')
  return { ok: true }
}

export async function returnWorkingSheet(wsId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canView) return { ok: false, error: 'You do not have access to Cost Control' }
  if (!reason || reason.trim().length < 5) return { ok: false, error: 'Return reason required (min 5 chars)' }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, project_id, total_amount')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }
  if (ws.status !== 'submitted') return { ok: false, error: 'Only submitted sheets can be returned' }

  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot return a sheet you raised yourself' }
  }

  const allowed = await callCanApprove('submitted', 'returned', Number(ws.total_amount ?? 0))
  if (!allowed) {
    return { ok: false, error: 'Your role is not configured to return this sheet. Check /admin/approvals.' }
  }

  const { error: updErr } = await supabase
    .from('cc_working_sheets')
    .update({
      status: 'returned',
      returned_at: new Date().toISOString(),
      returned_by: me.user.id,
      return_reason: reason.trim(),
      locked_at: null,
      locked_by: null,
    })
    .eq('id', wsId)
  if (updErr) return { ok: false, error: updErr.message }

  await supabase.from('cc_budget_events').insert({
    project_id: ws.project_id,
    event_type: 'ws_returned',
    delta_amount: 0,
    related_ws_id: wsId,
    remarks: reason.trim(),
    requested_by: me.user.id,
  })

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  return { ok: true }
}
