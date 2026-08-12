'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyProfile, getMyPermissions, can } from '@/lib/auth'
import { generateSmartWSCode } from './ws-code-action'

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

/** Everything the WS detail page needs to decide which action buttons to
 *  render for THIS viewer on THIS sheet. One round trip, matrix-driven.
 *  The 3-stage chain: submitted →(PH)→ ph_approved →(Atm)→ atm_approved
 *  →(Trustee release)→ partially_approved* → approved. */
export interface WSApprovalContext {
  /** Owner (or admin) may edit + submit — sheet is draft / returned. */
  canSubmit: boolean
  /** The sign-off THIS viewer may perform now, or null. */
  nextSignOff: 'ph_approved' | 'atm_approved' | null
  /** Viewer may release money (Trustee stage) now. */
  canRelease: boolean
  /** Viewer may return the sheet for revision now. */
  canReturn: boolean
}

export async function getWSApprovalContext(wsId: string): Promise<WSApprovalContext> {
  const none: WSApprovalContext = { canSubmit: false, nextSignOff: null, canRelease: false, canReturn: false }
  const me = await whoAmI()
  if (!me.user) return none
  const supabase = await createClient()
  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('engineer_id, status, total_amount, approved_for_erp_amt, project_id')
    .eq('id', wsId)
    .single()
  if (!ws) return none

  const status = ws.status as string
  const isOwner = ws.engineer_id === me.user.id
  const canSubmit = me.canEdit && (isOwner || me.isAdmin) && (status === 'draft' || status === 'returned')

  // Approvals: self-approval blocked unless admin.
  if (isOwner && !me.isAdmin) return { ...none, canSubmit }

  // Phase 2: if this project names its approvers for the current stage,
  // only they (or an admin) may act — hide the buttons for everyone else.
  const projectAllows = await projectApproverAllows(
    (ws as { project_id: string | null }).project_id, status, me.user.id, me.isAdmin,
  )
  if (!projectAllows) return { ...none, canSubmit }

  const total = Number(ws.total_amount ?? 0)
  const already = Number(ws.approved_for_erp_amt ?? 0)
  const remaining = Math.max(total - already, 0)

  // Sign-off stages (full sheet, no money moves → amount null so caps
  // don't bind; the chain has no caps anyway).
  let nextSignOff: 'ph_approved' | 'atm_approved' | null = null
  if (status === 'submitted' && await callCanApprove('submitted', 'ph_approved', null)) {
    nextSignOff = 'ph_approved'
  } else if (status === 'ph_approved' && await callCanApprove('ph_approved', 'atm_approved', null)) {
    nextSignOff = 'atm_approved'
  }

  // Trustee release stage.
  let canRelease = false
  if (status === 'atm_approved' || status === 'partially_approved') {
    const [okPartial, okFull] = await Promise.all([
      callCanApprove(status, 'partially_approved', remaining),
      callCanApprove(status, 'approved', remaining),
    ])
    canRelease = okPartial || okFull
  }

  // Return — from any pending stage the viewer's role covers.
  let canReturn = false
  if (['submitted', 'ph_approved', 'atm_approved', 'partially_approved'].includes(status)) {
    canReturn = await callCanApprove(status, 'returned', total)
  }

  return { canSubmit, nextSignOff, canRelease, canReturn }
}

/** Whether the viewer is Cost Control "management" — i.e. their effective
 *  role appears on ANY active approval rule for the module (or they're
 *  admin). Drives AI-review tools + big-number visibility. Config-driven:
 *  editing /admin/approvals automatically retargets this. */
export async function checkIsCcReviewer(): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  if (me.isAdmin) return true
  const supabase = await createClient()
  const [{ data: eff }, { data: rules }] = await Promise.all([
    supabase.rpc('effective_user_role', { p_user_id: me.user.id, p_module_slug: 'cost-control' }),
    supabase
      .from('approval_rules')
      .select('approver_role, override_role')
      .eq('module_slug', 'cost-control')
      .eq('doc_type', 'cc_working_sheet')
      .eq('is_active', true),
  ])
  const role = (eff as string | null) ?? me.profile?.role ?? null
  if (!role) return false
  // Coordinator = setup/admin + full visibility, but is deliberately NOT in the
  // approval matrix (so it can never approve/release — every approve button is
  // matrix-driven and the DB trigger backstops it). Grant reviewer VISIBILITY
  // explicitly here so a Coordinator sees all sheets + confidential figures.
  if (role === 'coordinator') return true
  return (rules ?? []).some(r => r.approver_role === role || r.override_role === role)
}

/** Only the Trustee (founder) or an Admin may accept/reject the management
 *  Internal Estimate. Kept narrower than checkIsCcReviewer (which also
 *  includes Project Head / Atm Head). */
export async function checkCanDecideInternalEstimate(): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  if (me.isAdmin) return true
  const supabase = await createClient()
  const { data: eff } = await supabase.rpc('effective_user_role', { p_user_id: me.user.id, p_module_slug: 'cost-control' })
  const role = (eff as string | null) ?? me.profile?.role ?? null
  return role === 'founder' // Trustee
}

/** Atm Head (head) / Project Head / Admin — may request an Internal Estimate
 *  reopen and upload the revised sheet. (Trustee decides, via
 *  checkCanDecideInternalEstimate.) */
export async function checkCanRequestIeRevision(): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  if (me.isAdmin) return true
  const supabase = await createClient()
  const { data: eff } = await supabase.rpc('effective_user_role', { p_user_id: me.user.id, p_module_slug: 'cost-control' })
  const role = (eff as string | null) ?? me.profile?.role ?? null
  return role === 'head' || role === 'project_head'
}

/** Trustee/Admin accept, reject, or clear the Internal Estimate baseline for
 *  a (project, sub-skill). Role is re-checked inside the SECURITY DEFINER RPC. */
export async function setInternalEstimateDecision(input: {
  project_id: string
  discipline_id: string
  sub_skill_id: string
  decision: 'accept' | 'reject' | 'clear'
  amount?: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_set_internal_estimate', {
    p_project: input.project_id,
    p_discipline: input.discipline_id,
    p_sub_skill: input.sub_skill_id,
    p_decision: input.decision,
    p_amount: input.amount ?? null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${input.project_id}`)
  return { ok: true }
}

/** Assign (or clear, with engineer_id null) the single engineer responsible
 *  for a sub-skill's budget working. Reviewer/Admin only — re-checked in the
 *  SECURITY DEFINER RPC. */
export async function assignSubSkillEngineer(input: {
  project_id: string
  sub_skill_id: string
  engineer_id: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_set_subskill_engineer', {
    p_project: input.project_id,
    p_sub_skill: input.sub_skill_id,
    p_engineer: input.engineer_id,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${input.project_id}`)
  revalidatePath('/cost-control')
  return { ok: true }
}

/** Owner engineer asks the chain to release the balance of a partly
 *  released sheet. The RPC re-checks ownership + status and flips the sheet
 *  back to 'submitted' so it walks the SAME PH → Atm → Trustee chain. */
export async function requestBalanceRelease(
  wsId: string, note: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = (note ?? '').trim()
  // Mandatory — the approver needs to know why the balance is being asked for
  // now. Recorded on the approval timeline (p_note) AND posted to the comment
  // thread by the caller, so it shows on the engineer's page.
  if (trimmed.length < 3) return { ok: false, error: 'Add a short note on why the balance is needed' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_request_release', { p_ws: wsId, p_note: trimmed })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control')
  return { ok: true }
}

/** The engineer who OWNS a draft (or an admin) can delete it — e.g. it was
 *  raised in the wrong sub-category. Draft-only; the RPC re-checks owner +
 *  status. Best-effort cleans up the uploaded files from storage after. */
export async function deleteDraftWorkingSheet(wsId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  // Grab storage paths BEFORE the delete (children cascade away with the row).
  const [wsRes, attRes] = await Promise.all([
    supabase.from('cc_working_sheets').select('source_excel_url, summary_image_url').eq('id', wsId).maybeSingle(),
    supabase.from('cc_ws_attachments').select('path').eq('working_sheet_id', wsId),
  ])
  const { error } = await supabase.rpc('cc_delete_draft', { p_ws: wsId })
  if (error) return { ok: false, error: error.message }
  // Orphaned files are harmless, so removal is best-effort — the row is gone.
  const paths = [
    wsRes.data?.source_excel_url, wsRes.data?.summary_image_url,
    ...((attRes.data ?? []).map(a => (a as { path: string }).path)),
  ].filter((p): p is string => !!p)
  if (paths.length) { try { await supabase.storage.from('cc-sheets').remove(paths) } catch { /* ignore */ } }
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control')
  return { ok: true }
}

/** Admin, or a user the admin granted via the cc_archive_users setting, may
 *  archive / restore working sheets. Delete stays admin-only (in the RPC). */
export async function checkCanArchiveWs(): Promise<boolean> {
  const me = await whoAmI()
  if (!me.user) return false
  if (me.isAdmin) return true
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'cc_archive_users')
    .maybeSingle()
  return ((data?.value as string | null) ?? '').includes(me.user.id)
}

/** Archive / restore / permanently delete a working sheet. All permission
 *  checks re-run inside the SECURITY DEFINER RPC (delete = admin only, and
 *  only after the sheet is archived). */
export async function archiveWorkingSheet(
  wsId: string,
  action: 'archive' | 'restore' | 'delete',
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_archive_ws', { p_ws: wsId, p_action: action })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/cost-control/working-sheets')
  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  return { ok: true }
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

// Which per-project approver role covers a sheet at a given status.
function coveringApproverRole(status: string): 'project_head' | 'head' | 'founder' | null {
  switch (status) {
    case 'submitted':          return 'project_head'
    case 'ph_approved':        return 'head'
    case 'atm_approved':
    case 'partially_approved': return 'founder'
    default:                   return null
  }
}

/** Phase 2 gate, layered ON TOP of role-based can_approve: when this project
 *  has NAMED approvers for the stage's covering role, only they (or an admin)
 *  may act — so other projects' Heads aren't in the loop. When a stage has no
 *  named approver, it falls back to the role-wide behaviour (non-breaking).
 *  Fails open to role-wide on a query error. */
async function projectApproverAllows(
  projectId: string | null, status: string, userId: string, isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true
  const role = coveringApproverRole(status)
  if (!role || !projectId) return true
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cc_project_approvers')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('role', role)
  if (error) return true
  const list = (data ?? []) as Array<{ user_id: string }>
  if (list.length === 0) return true       // no named approvers → role-wide fallback
  return list.some(r => r.user_id === userId)
}

// ============================================================
// Create a new Working Sheet
// ============================================================

const newWSSchema = z.object({
  project_id: z.string().uuid(),
  discipline_id: z.string().uuid(),
  sub_skill_id: z.string().uuid(),
  line_type: z.enum(['work', 'material', 'combined']).default('work'),
  deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deadline_notes: z.string().max(500).nullable().optional(),
})

export type NewWSResult =
  | { ok: true; id: string; ws_code: string }
  | { ok: false; error: string }

export async function createWorkingSheet(input: {
  project_id: string
  discipline_id: string
  sub_skill_id: string
  line_type?: 'work' | 'material' | 'combined'
  deadline_date?: string | null
  deadline_notes?: string | null
}): Promise<NewWSResult> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = newWSSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Validation failed' }

  const supabase = await createClient()
  // Smart code: <ProjectCode>-<SubSkillCode>-W<seq> (W = full Working sheet
  // mode). Falls back to a timestamp-based code if the helper errors —
  // ws_code has a NOT NULL constraint we don't want to trip on a partial
  // input.
  let ws_code: string
  try {
    ws_code = await generateSmartWSCode({
      project_id: parsed.data.project_id,
      sub_skill_id: parsed.data.sub_skill_id,
      entry_mode: 'line_items',
    })
  } catch {
    ws_code = `WS-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`
  }

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
  const { data: items, error } = await supabase
    .from('cc_working_sheet_items')
    .select('total_amount')
    .eq('working_sheet_id', wsId)
  // A failed read yields no rows — bail out rather than overwrite the
  // sheet's stored total with 0 on a transient error.
  if (error) return
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

  // Go through the SECURITY DEFINER RPC: the engineer's row-level UPDATE
  // policy pins them to status='draft', so a direct write to 'submitted' is
  // rejected by RLS. The RPC re-checks ownership + state and performs the
  // transition. (See migration 20260722_cc_submit_rpc.)
  const { error: updErr } = await supabase.rpc('cc_submit_working_sheet', { p_ws_id: wsId })
  if (updErr) return { ok: false, error: updErr.message }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  return { ok: true }
}

/** Full-sheet sign-off — stages 1 + 2 of the chain. The target stage is
 *  derived SERVER-side from the sheet's current status (submitted →
 *  ph_approved by the Project Head; ph_approved → atm_approved by the Atm
 *  Head), so a stale client can never skip a stage. Every sign-off must
 *  carry the CHECKED AMOUNT the approver typed themselves — deliberately
 *  not prefilled, and never compared to the sheet total: the independent
 *  figure is the point. Stored per stage (ph_checked_* / atm_checked_*).
 *  No money is released here — that happens at the Trustee stage via
 *  cc_approve_release. */
export async function signOffWorkingSheet(
  wsId: string,
  checkedAmt: number,
  comment?: string | null,
): Promise<{ ok: boolean; error?: string; new_status?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canView) return { ok: false, error: 'You do not have access to Cost Control' }

  if (!Number.isFinite(checkedAmt) || checkedAmt <= 0) {
    return { ok: false, error: 'Type the amount you checked before signing off' }
  }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, project_id, total_amount')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }

  const toStage =
    ws.status === 'submitted' ? 'ph_approved'
    : ws.status === 'ph_approved' ? 'atm_approved'
    : null
  if (!toStage) {
    return { ok: false, error: 'This sheet is not waiting for a sign-off at your stage' }
  }

  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot sign off a sheet you raised yourself' }
  }

  const allowed = await callCanApprove(ws.status as string, toStage, null)
  if (!allowed) {
    return { ok: false, error: 'Your role is not configured for this sign-off. Check /admin/approvals.' }
  }
  if (!(await projectApproverAllows(ws.project_id as string | null, ws.status as string, me.user.id, me.isAdmin))) {
    return { ok: false, error: 'This stage is assigned to a specific approver for this project — it is not with you.' }
  }

  const now = new Date().toISOString()
  const checkedCols = toStage === 'ph_approved'
    ? { ph_checked_amt: checkedAmt, ph_checked_at: now, ph_checked_by: me.user.id }
    : { atm_checked_amt: checkedAmt, atm_checked_at: now, atm_checked_by: me.user.id }

  const { data: updRows, error: updErr } = await supabase
    .from('cc_working_sheets')
    .update({ status: toStage, ...checkedCols })
    .eq('id', wsId)
    .eq('status', ws.status) // optimistic: someone else may have acted meanwhile
    .select('id')
  if (updErr) return { ok: false, error: updErr.message }
  // A 0-row update means RLS filtered the row out (not an authorized approver
  // for this sheet) OR someone else already moved it. Fail LOUDLY — never fall
  // through to log a phantom "approved" event while the sheet stays put.
  if (!updRows || updRows.length === 0) {
    return { ok: false, error: 'Could not sign off — the sheet may have already moved, or this stage is not assigned to you. No change was made.' }
  }

  // Log the sign-off so the approval trail names the stage + person. The
  // checked amount rides in the comment (approval_events has no amount
  // column) — the sheet columns hold the latest cycle, the trail keeps
  // every cycle. record_approval_event re-checks can_approve.
  const eventComment = `Checked ₹${Math.round(checkedAmt).toLocaleString('en-IN')}${comment?.trim() ? ` — ${comment.trim()}` : ''}`
  const { error: recErr } = await supabase.rpc('record_approval_event', {
    p_module_slug: 'cost-control',
    p_doc_type:    'cc_working_sheet',
    p_doc_table:   'cc_working_sheets',
    p_doc_id:      wsId,
    p_from_stage:  ws.status,
    p_to_stage:    toStage,
    p_decision:    'approved',
    p_comment:     eventComment,
    p_attachments: [],
    p_amount:      null,
  })

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control/approvals')
  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${ws.project_id}`)
  if (recErr) {
    return { ok: true, new_status: toStage, error: `Signed off, but event log failed: ${recErr.message}` }
  }
  return { ok: true, new_status: toStage }
}

/** Approve a working sheet. Two modes:
 *  - release: pass `trancheAmount` to release just a part of the total.
 *    Adds to the running approved_for_erp_amt. Status becomes
 *    'partially_approved' while cumulative < total, or 'approved' once
 *    cumulative reaches total. (Param name kept as trancheAmount for
 *    backwards compat with any external callers; UI says "release".)
 *  - full:    pass nothing — backwards compatible. Approves the full
 *    remaining amount in one go.
 *
 *  The amount validation, approval-matrix gate, status update and audit
 *  event all happen inside public.cc_approve_release in ONE transaction
 *  with a row lock — so two HODs releasing at the same moment can't both
 *  read the same approved_for_erp_amt and overshoot the estimate.
 */
export async function approveWorkingSheet(
  wsId: string,
  trancheAmount?: number | null,
): Promise<{ ok: boolean; error?: string; new_status?: string; approved_so_far?: number; released?: number; prior_status?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canView) return { ok: false, error: 'You do not have access to Cost Control' }

  const supabase = await createClient()
  // Lightweight pre-read: powers the friendly status / self-approval
  // failures below and gives us project_id for revalidation. The RPC
  // re-checks everything atomically; this is just for fast feedback.
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, project_id')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }
  if (ws.status !== 'atm_approved' && ws.status !== 'partially_approved') {
    return { ok: false, error: 'Only sheets signed off by the Atm Head (or already partially released) can be released into ERP' }
  }

  // Self-approval is blocked unless the caller is an admin (escape hatch
  // for single-approver teams during rollout).
  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot approve a sheet you raised yourself' }
  }
  if (!(await projectApproverAllows(ws.project_id as string | null, ws.status as string, me.user.id, me.isAdmin))) {
    return { ok: false, error: "This project's release is assigned to a specific Trustee — it is not with you." }
  }

  const { data, error: rpcErr } = await supabase.rpc('cc_approve_release', {
    p_ws_id: wsId,
    p_tranche: trancheAmount ?? null,
  })
  // The RPC raises human-readable messages (bad amount, matrix denial,
  // concurrent state change), so its message is safe to show as-is.
  if (rpcErr) return { ok: false, error: rpcErr.message }

  const result = data as { ok: boolean; new_status: string; approved_so_far: number; released: number }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${ws.project_id}`)
  // prior_status = the stage the sheet was in when this release happened —
  // the audit event must record the REAL transition (a release that
  // completes a partially-approved sheet is partially_approved → approved,
  // not submitted → approved).
  return { ok: true, new_status: result.new_status, approved_so_far: result.approved_so_far, released: result.released, prior_status: ws.status as string }
}

export async function returnWorkingSheet(wsId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const me = await whoAmI()
  if (!me.user) return { ok: false, error: 'Not signed in' }
  if (!me.canView) return { ok: false, error: 'You do not have access to Cost Control' }
  if (!reason || reason.trim().length < 5) return { ok: false, error: 'Return reason required (min 5 chars)' }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id, project_id, total_amount, ws_code')
    .eq('id', wsId)
    .single()
  if (error || !ws) return { ok: false, error: 'Working Sheet not found' }
  const PENDING = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']
  if (!PENDING.includes(ws.status as string)) {
    return { ok: false, error: 'Only sheets waiting in the approval chain can be returned' }
  }

  if (ws.engineer_id === me.user.id && !me.isAdmin) {
    return { ok: false, error: 'You cannot return a sheet you raised yourself' }
  }

  const allowed = await callCanApprove(ws.status as string, 'returned', Number(ws.total_amount ?? 0))
  if (!allowed) {
    return { ok: false, error: 'Your role is not configured to return this sheet. Check /admin/approvals.' }
  }
  if (!(await projectApproverAllows(ws.project_id as string | null, ws.status as string, me.user.id, me.isAdmin))) {
    return { ok: false, error: 'This stage is assigned to a specific approver for this project — it is not with you.' }
  }

  const { data: retRows, error: updErr } = await supabase
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
    .select('id')
  if (updErr) return { ok: false, error: updErr.message }
  // 0 rows = RLS filtered it out (not an authorized approver here) or it
  // already moved. Fail loudly rather than logging a phantom return event.
  if (!retRows || retRows.length === 0) {
    return { ok: false, error: 'Could not return the sheet — it may have already moved, or this stage is not assigned to you. No change was made.' }
  }

  await supabase.from('cc_budget_events').insert({
    project_id: ws.project_id,
    event_type: 'ws_returned',
    delta_amount: 0,
    related_ws_id: wsId,
    remarks: reason.trim(),
    requested_by: me.user.id,
  })

  // Log into the approval trail too, so the timeline shows WHICH stage
  // returned the sheet (PH vs Atm Head vs Trustee).
  await supabase.rpc('record_approval_event', {
    p_module_slug: 'cost-control',
    p_doc_type:    'cc_working_sheet',
    p_doc_table:   'cc_working_sheets',
    p_doc_id:      wsId,
    p_from_stage:  ws.status,
    p_to_stage:    'returned',
    p_decision:    'returned',
    p_comment:     reason.trim(),
    p_attachments: [],
    p_amount:      null,
  })

  // Tell the engineer their sheet was sent back — with the reason — so they can
  // act on it (they were NOT being notified before). notify_user is SECURITY
  // DEFINER, so it posts to the engineer's inbox + rides their channel prefs.
  // Best-effort: a notify hiccup must never fail the return itself.
  if (ws.engineer_id && ws.engineer_id !== me.user.id) {
    await supabase.rpc('notify_user', {
      p_user_id: ws.engineer_id,
      p_type: 'cc_ws_returned',
      p_title: `Working sheet returned${ws.ws_code ? ` · ${ws.ws_code}` : ''}`,
      p_body: `Your working sheet was sent back for changes. Reason: ${reason.trim()}`,
      p_url: `/cost-control/working-sheets/${wsId}`,
      p_module_slug: 'cost-control',
      p_doc_table: 'cc_working_sheets',
      p_doc_id: wsId,
    })
  }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  revalidatePath('/cost-control/approvals')
  return { ok: true }
}
