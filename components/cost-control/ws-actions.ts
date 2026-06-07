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
  // The missing `await` here was silently returning a Promise, which
  // coerces to truthy — i.e. anyone could set / change a deadline. Now
  // properly resolved against the approval matrix.
  return await callCanApprove('any', 'deadline_set', null)
}

/** Whether the caller may set / change an Internal Estimate. */
export async function checkCanSetEstimate(): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('can_approve', {
    p_module_slug: 'cost-control',
    p_doc_type: 'cc_budget_line',
    p_from_stage: 'any',
    p_to_stage: 'estimate_set',
    p_amount: null,
  })
  if (error) return false
  return !!data
}

/** Upsert the Internal Estimate (HOD planning ceiling) on the budget
 *  line identified by (project, discipline, sub_skill, line_type).
 *  Creates the row when none exists, leaving ERP columns at zero. */
export async function setInternalEstimate(input: {
  projectId: string
  disciplineId: string
  subSkillId: string
  lineType: 'work' | 'material'
  amount: number | null
  notes?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }

  const allowed = await checkCanSetEstimate()
  if (!allowed) {
    return { ok: false, error: 'Only Head (or Admin) can set the Internal Estimate. Update at /admin/approvals to allow other roles.' }
  }

  if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0)) {
    return { ok: false, error: 'Estimate must be a non-negative number (or empty to clear)' }
  }

  const supabase = await createClient()
  // Find existing budget line for this (project, discipline, sub-skill, line_type).
  // Note: cc_budget_lines.sub_skill_id is nullable — for sub-skill rows we always
  // expect a non-null value here.
  const { data: existing } = await supabase
    .from('cc_budget_lines')
    .select('id')
    .eq('project_id', input.projectId)
    .eq('discipline_id', input.disciplineId)
    .eq('sub_skill_id', input.subSkillId)
    .eq('line_type', input.lineType)
    .maybeSingle()

  const payload = {
    internal_estimate_amt: input.amount,
    internal_estimate_notes: input.notes?.trim() ? input.notes.trim() : null,
  }

  let opErr: { message: string } | null = null
  if (existing?.id) {
    const { error } = await supabase.from('cc_budget_lines').update(payload).eq('id', existing.id)
    opErr = error
  } else {
    const { error } = await supabase.from('cc_budget_lines').insert({
      project_id: input.projectId,
      discipline_id: input.disciplineId,
      sub_skill_id: input.subSkillId,
      line_type: input.lineType,
      current_budget_amt: 0,
      current_wo_committed_amt: 0,
      current_paid_amt: 0,
      current_advance_amt: 0,
      ...payload,
    })
    opErr = error
  }
  if (opErr) return { ok: false, error: opErr.message }

  revalidatePath(`/cost-control/projects/${input.projectId}`)
  revalidatePath('/cost-control')
  return { ok: true }
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
 *  buttons to render. Mirrors the same RPC used by the actions.
 *  For 'approved' we check both the full and partial transitions —
 *  HOD can approve a release (status → partially_approved) OR finalise
 *  (status → approved). Either yes = the Approve button is allowed. */
export async function checkCanApproveWS(wsId: string, toStage: 'approved' | 'returned'): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  const supabase = await createClient()
  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('engineer_id, status, total_amount, approved_for_erp_amt')
    .eq('id', wsId)
    .single()
  if (!ws) return false
  if (ws.engineer_id === me.user.id && !me.isAdmin) return false

  const total = Number(ws.total_amount ?? 0)
  const already = Number(ws.approved_for_erp_amt ?? 0)
  const remaining = Math.max(total - already, 0)

  if (toStage === 'returned') {
    if (ws.status !== 'submitted' && ws.status !== 'partially_approved') return false
    return callCanApprove(ws.status, 'returned', total)
  }

  // Approve path — allow when sheet is submitted or already partially released.
  if (ws.status !== 'submitted' && ws.status !== 'partially_approved') return false

  // The button shows if EITHER a partial release or a full finalise is
  // allowed for this user at any amount up to remaining.
  const fromStage = ws.status as 'submitted' | 'partially_approved'
  const [okPartial, okFull] = await Promise.all([
    callCanApprove(fromStage, 'partially_approved', remaining),
    callCanApprove(fromStage, 'approved', remaining),
  ])
  return okPartial || okFull
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

/** Approve a working sheet. Two modes:
 *  - release: pass `trancheAmount` to release just a part of the total.
 *    Adds to the running approved_for_erp_amt. Status becomes
 *    'partially_approved' while cumulative < total, or 'approved' once
 *    cumulative reaches total. (Param name kept as trancheAmount for
 *    backwards compat with any external callers; UI says "release".)
 *  - full:    pass nothing — backwards compatible. Approves the full
 *    remaining amount in one go.
 */
export async function approveWorkingSheet(
  wsId: string,
  trancheAmount?: number | null,
): Promise<{ ok: boolean; error?: string; new_status?: string; approved_so_far?: number }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canView) return { ok: false, error: 'You do not have access to Cost Control' }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, project_id, discipline_id, sub_skill_id, line_type, total_amount, approved_for_erp_amt')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }
  if (ws.status !== 'submitted' && ws.status !== 'partially_approved') {
    return { ok: false, error: 'Only submitted or partially-approved sheets can be approved further' }
  }

  // Self-approval is blocked unless the caller is an admin (escape hatch
  // for single-approver teams during rollout).
  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot approve a sheet you raised yourself' }
  }

  const total = Number(ws.total_amount ?? 0)
  const alreadyApproved = Number(ws.approved_for_erp_amt ?? 0)
  const remaining = total - alreadyApproved

  // Decide release amount. If trancheAmount is provided, use it; otherwise
  // approve the rest in one shot.
  let tranche = trancheAmount == null || !Number.isFinite(trancheAmount)
    ? remaining
    : Number(trancheAmount)

  if (tranche <= 0) return { ok: false, error: 'Release amount must be greater than zero' }
  if (tranche > remaining + 1) {
    // 1 ₹ floating-point tolerance for the "approve all remaining" path
    return { ok: false, error: `Release ${formatRupees(tranche)} exceeds remaining ${formatRupees(remaining)}` }
  }
  // Clamp to remaining so the running total never overshoots.
  if (tranche > remaining) tranche = remaining

  const cumulative = alreadyApproved + tranche
  const willBeFull = cumulative >= total - 0.5
  const toStage: 'partially_approved' | 'approved' = willBeFull ? 'approved' : 'partially_approved'
  const fromStage = ws.status as 'submitted' | 'partially_approved'

  // Approval matrix gate — passes the RELEASE amount so amount_cap_max
  // rules apply per release (head ≤ ₹2L per release).
  const allowed = await callCanApprove(fromStage, toStage, tranche)
  if (!allowed) {
    return { ok: false, error: `Your role can't approve a ${formatRupees(tranche)} release on this sheet. Check /admin/approvals.` }
  }

  // Find the matching budget line. Each release directly bumps
  // current_budget_amt — CT Hub is the source of truth for what HOD has
  // released into ERP. Excel import is only used for one-time backfill
  // of legacy data; new approvals don't need to round-trip through Excel.
  const { data: bl } = await supabase
    .from('cc_budget_lines')
    .select('id, current_budget_amt')
    .eq('project_id', ws.project_id)
    .eq('discipline_id', ws.discipline_id)
    .eq('sub_skill_id', ws.sub_skill_id)
    .eq('line_type', ws.line_type)
    .maybeSingle()

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    status: toStage,
    approved_for_erp_amt: cumulative,
    approved_for_erp_at: now,
    approved_for_erp_by: me.user.id,
  }
  // Only set approved_at / approved_by when fully approved, so we
  // preserve the "first release" vs "fully signed off" distinction.
  if (willBeFull) {
    update.approved_at = now
    update.approved_by = me.user.id
  }

  const { error: updErr } = await supabase.from('cc_working_sheets').update(update).eq('id', wsId)
  if (updErr) return { ok: false, error: updErr.message }

  // Bump the ERP-approved budget by this release. Upsert: if no budget
  // line exists yet (no Excel import was done), create one with the
  // release as its initial current_budget_amt. Else increment.
  let budgetLineId = bl?.id ?? null
  if (bl) {
    const newAmt = Number(bl.current_budget_amt ?? 0) + tranche
    const { error: blErr } = await supabase
      .from('cc_budget_lines')
      .update({ current_budget_amt: newAmt })
      .eq('id', bl.id)
    if (blErr) return { ok: false, error: `Budget update failed: ${blErr.message}` }
  } else {
    const { data: newBl, error: insErr } = await supabase
      .from('cc_budget_lines')
      .insert({
        project_id: ws.project_id,
        discipline_id: ws.discipline_id,
        sub_skill_id: ws.sub_skill_id,
        line_type: ws.line_type,
        current_budget_amt: tranche,
        current_wo_committed_amt: 0,
        current_paid_amt: 0,
        current_advance_amt: 0,
      })
      .select('id')
      .single()
    if (insErr) return { ok: false, error: `Budget create failed: ${insErr.message}` }
    budgetLineId = newBl?.id ?? null
  }

  await supabase.from('cc_budget_events').insert({
    budget_line_id: budgetLineId,
    project_id: ws.project_id,
    event_type: 'ws_approved',
    delta_amount: tranche,
    related_ws_id: wsId,
    remarks: willBeFull
      ? `WS fully approved — final release ${formatRupees(tranche)} (budget bumped)`
      : `WS release approved ${formatRupees(tranche)} (cumulative ${formatRupees(cumulative)} of ${formatRupees(total)} · budget bumped)`,
    requested_by: me.user.id,
    approved_by: me.user.id,
    approval_status: 'approved',
  })

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${ws.project_id}`)
  return { ok: true, new_status: toStage, approved_so_far: cumulative }
}

function formatRupees(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
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
  if (ws.status !== 'submitted' && ws.status !== 'partially_approved') {
    return { ok: false, error: 'Only submitted or partially-approved sheets can be returned' }
  }

  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot return a sheet you raised yourself' }
  }

  const allowed = await callCanApprove(ws.status as 'submitted' | 'partially_approved', 'returned', Number(ws.total_amount ?? 0))
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
