'use server'
// Inline-edit actions for the project detail page (cost-control/projects/[id]).
// Unlike the wizard actions which use replace-all semantics, these patch a
// single row at a time — what the PM clicked on.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, getMyPermissions, can } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { canMarkComplete } from '@/lib/cost-control/completion'
import { formatINR } from '@/lib/utils'

const uuid = z.string().uuid()
const isoDateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()

type Result = { ok: true; touched?: number } | { ok: false; error: string }

// ============================================================
// Plan deadline on a discipline row
// ============================================================
export async function setDisciplineDeadline(
  projectId: string,
  disciplineId: string,
  deadline: string | null,
): Promise<Result> {
  // Editing setup of an existing project requires cost-control edit perms.
  await requirePermission('cost-control', 'edit')

  const parsed = z.object({
    project_id: uuid,
    discipline_id: uuid,
    deadline: isoDateOrNull,
  }).safeParse({ project_id: projectId, discipline_id: disciplineId, deadline })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_project_disciplines')
    .update({ target_deadline: deadline })
    .eq('project_id', projectId)
    .eq('discipline_id', disciplineId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

// ============================================================
// Plan deadline on a sub-skill row
// ============================================================
export async function setSubSkillDeadline(
  projectId: string,
  subSkillId: string,
  deadline: string | null,
): Promise<Result> {
  await requirePermission('cost-control', 'edit')

  const parsed = z.object({
    project_id: uuid,
    sub_skill_id: uuid,
    deadline: isoDateOrNull,
  }).safeParse({ project_id: projectId, sub_skill_id: subSkillId, deadline })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_project_sub_skills')
    .update({ target_deadline: deadline })
    .eq('project_id', projectId)
    .eq('sub_skill_id', subSkillId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

// ============================================================
// Disable a discipline on this project (soft — sets is_enabled=false).
// Past working sheets / budget lines stay intact; the row just stops
// appearing in the project detail table. Re-enable from the wizard or
// resumable setup screen.
// ============================================================
export async function setDisciplineEnabled(
  projectId: string,
  disciplineId: string,
  enabled: boolean,
): Promise<Result> {
  await requirePermission('cost-control', 'edit')

  const parsed = z.object({
    project_id: uuid,
    discipline_id: uuid,
    enabled: z.boolean(),
  }).safeParse({ project_id: projectId, discipline_id: disciplineId, enabled })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_project_disciplines')
    .update({ is_enabled: enabled })
    .eq('project_id', projectId)
    .eq('discipline_id', disciplineId)
  if (error) return { ok: false, error: error.message }

  // Also flip every sub-skill under this discipline so they don't linger
  // as orphans on the detail page. Re-enabling the discipline does NOT
  // automatically re-enable its sub-skills (resume wizard handles that).
  if (!enabled) {
    // Fetch sub-skill ids belonging to this discipline first
    const { data: subs } = await supabase
      .from('cc_sub_skills')
      .select('id')
      .eq('discipline_id', disciplineId)
    const subIds = (subs ?? []).map(s => s.id as string)
    if (subIds.length > 0) {
      await supabase
        .from('cc_project_sub_skills')
        .update({ is_enabled: false })
        .eq('project_id', projectId)
        .in('sub_skill_id', subIds)
    }
  }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

// ============================================================
// Disable a sub-skill on this project (soft).
// ============================================================
export async function setSubSkillEnabled(
  projectId: string,
  subSkillId: string,
  enabled: boolean,
): Promise<Result> {
  await requirePermission('cost-control', 'edit')

  const parsed = z.object({
    project_id: uuid,
    sub_skill_id: uuid,
    enabled: z.boolean(),
  }).safeParse({ project_id: projectId, sub_skill_id: subSkillId, enabled })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_project_sub_skills')
    .update({ is_enabled: enabled })
    .eq('project_id', projectId)
    .eq('sub_skill_id', subSkillId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

// ============================================================
// Estimation mode + thumbrule rate on a sub-skill row.
// Pass mode=null to clear the override and inherit from the discipline.
// ============================================================
export async function setSubSkillEstimationMode(
  projectId: string,
  subSkillId: string,
  mode: 'detailed' | 'thumbrule' | null,
  rate: number | null,
  notes: string | null,
): Promise<Result> {
  await requirePermission('cost-control', 'edit')

  const parsed = z.object({
    project_id: uuid,
    sub_skill_id: uuid,
    mode: z.enum(['detailed', 'thumbrule']).nullable(),
    rate: z.number().nullable(),
    notes: z.string().nullable(),
  }).safeParse({ project_id: projectId, sub_skill_id: subSkillId, mode, rate, notes })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_project_sub_skills')
    .update({
      estimation_mode: mode,
      // Only carry rate/notes when mode is thumbrule; clear them otherwise
      // to avoid stale numbers showing up after a back-and-forth toggle.
      thumbrule_rate_per_sft: mode === 'thumbrule' ? rate : null,
      thumbrule_notes:        mode === 'thumbrule' ? notes : null,
    })
    .eq('project_id', projectId)
    .eq('sub_skill_id', subSkillId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

/** Set / correct the project's built-up area (sft). Goes through the
 *  cc_set_project_area definer RPC because the projects table's UPDATE
 *  RLS is admin/uploader-only while this page serves all CC management. */
export async function setProjectArea(
  projectId: string,
  sft: number | null,
): Promise<{ ok: boolean; error?: string }> {
  if (sft != null && (!Number.isFinite(sft) || sft < 0 || sft > 100_000_000)) {
    return { ok: false, error: 'Area must be a positive number of sft' }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_set_project_area', {
    p_project_id: projectId,
    p_sft: sft,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  return { ok: true }
}

// ============================================================
// Rename a project — Cost-Control ADMIN permission (real admins + CC
// coordinators, e.g. Parimal). The name shows on every module (dashboard
// groups, sheets, reports), so renaming stays an admin/coordinator action,
// not something every reviewer can do. Code stays fixed — it's baked into
// WS codes (change the alias separately, still admin-only).
// ============================================================
export async function renameProject(
  projectId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return { ok: false, error: 'Only a Cost Control admin or coordinator can rename a project' }
  }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 120) {
    return { ok: false, error: 'Name must be 2–120 characters' }
  }

  const supabase = await createClient()
  // .select() catches a silent RLS no-op (0 rows) — report it, don't
  // pretend the rename happened.
  const { data, error } = await supabase
    .from('projects')
    .update({ name: trimmed })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Rename was blocked — check your permissions' }

  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  return { ok: true }
}

// ============================================================
// Set / clear the PARENT project (grouping) — ADMIN only. Keeps the
// hierarchy exactly one level deep: the chosen parent must itself be
// top-level, and a project that already has sub-projects can't be demoted
// into a child. Clearing (null) makes the project top-level again.
// ============================================================
export async function setProjectParent(
  projectId: string,
  parentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can change a project’s parent' }
  }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }
  if (parentId != null && !uuid.safeParse(parentId).success) return { ok: false, error: 'Bad parent id' }
  if (parentId === projectId) return { ok: false, error: 'A project can’t be its own parent' }

  const supabase = await createClient()

  if (parentId != null) {
    // Chosen parent must be top-level — we keep grouping one level deep.
    const { data: par } = await supabase
      .from('projects').select('id, parent_project_id').eq('id', parentId).maybeSingle()
    if (!par) return { ok: false, error: 'Parent project not found' }
    if (par.parent_project_id) {
      return { ok: false, error: 'Pick a top-level project as the parent — that one is itself a sub-project' }
    }
    // This project must not already have its own sub-projects.
    const { data: kids } = await supabase
      .from('projects').select('id').eq('parent_project_id', projectId).limit(1)
    if (kids && kids.length > 0) {
      return { ok: false, error: 'This project has sub-projects — move them out first before making it a sub-project' }
    }
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ parent_project_id: parentId })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Change was blocked — check your permissions' }

  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true }
}

// ============================================================
// Set / clear a project GROUP label — ADMIN only. Shown on the dashboard
// group band for the PARENT project; blank → the band falls back to the
// parent's short code. Purely a display label.
// ============================================================
export async function setProjectGroupLabel(
  projectId: string,
  label: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can rename a group' }
  }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }
  const trimmed = (label ?? '').trim()
  if (trimmed.length > 60) return { ok: false, error: 'Group name must be 60 characters or fewer' }
  const value = trimmed === '' ? null : trimmed

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update({ group_label: value })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Change was blocked — check your permissions' }

  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

// ============================================================
// Bulk sub-skill assignment helpers (Phase 5 — faster assignment). Both
// reuse the reviewer-gated cc_set_subskill_engineer RPC per sub-skill.
// ============================================================

/** Assign every enabled sub-skill under one discipline to a single engineer
 *  (engineer_id null clears them). Reviewer/Admin only. */
export async function bulkAssignDisciplineEngineer(input: {
  project_id: string
  discipline_id: string
  engineer_id: string | null
}): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!uuid.safeParse(input.project_id).success || !uuid.safeParse(input.discipline_id).success) {
    return { ok: false, error: 'Bad id' }
  }
  if (!(await checkIsCcReviewer())) return { ok: false, error: 'Only Cost Control management can assign engineers' }
  const supabase = await createClient()
  const [{ data: enabled }, { data: discSubs }] = await Promise.all([
    supabase.from('cc_project_sub_skills').select('sub_skill_id').eq('project_id', input.project_id).eq('is_enabled', true),
    supabase.from('cc_sub_skills').select('id').eq('discipline_id', input.discipline_id),
  ])
  const inDisc = new Set((discSubs ?? []).map(r => r.id as string))
  const targets = (enabled ?? []).map(r => r.sub_skill_id as string).filter(id => inDisc.has(id))
  let count = 0
  for (const subId of targets) {
    const { error } = await supabase.rpc('cc_set_subskill_engineer', {
      p_project: input.project_id, p_sub_skill: subId, p_engineer: input.engineer_id,
    })
    if (error) return { ok: false, error: error.message, count }
    count++
  }
  revalidatePath(`/cost-control/projects/${input.project_id}`)
  revalidatePath('/cost-control')
  return { ok: true, count }
}

/** Copy sub-skill → engineer assignments from another project into this one
 *  (only where the same sub-skill is enabled here). Reviewer/Admin only. */
export async function copySubSkillAssignments(input: {
  project_id: string
  from_project_id: string
}): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!uuid.safeParse(input.project_id).success || !uuid.safeParse(input.from_project_id).success) {
    return { ok: false, error: 'Bad id' }
  }
  if (input.project_id === input.from_project_id) return { ok: false, error: 'Pick a different project to copy from' }
  if (!(await checkIsCcReviewer())) return { ok: false, error: 'Only Cost Control management can assign engineers' }
  const supabase = await createClient()
  const [{ data: src }, { data: enabled }] = await Promise.all([
    supabase.from('cc_subskill_assignments').select('sub_skill_id, engineer_id').eq('project_id', input.from_project_id),
    supabase.from('cc_project_sub_skills').select('sub_skill_id').eq('project_id', input.project_id).eq('is_enabled', true),
  ])
  const enabledHere = new Set((enabled ?? []).map(r => r.sub_skill_id as string))
  const rows = (src ?? []).filter(r => enabledHere.has(r.sub_skill_id as string))
  let count = 0
  for (const r of rows) {
    const { error } = await supabase.rpc('cc_set_subskill_engineer', {
      p_project: input.project_id, p_sub_skill: r.sub_skill_id, p_engineer: r.engineer_id,
    })
    if (error) return { ok: false, error: error.message, count }
    count++
  }
  revalidatePath(`/cost-control/projects/${input.project_id}`)
  revalidatePath('/cost-control')
  return { ok: true, count }
}

// ============================================================
// Add / remove a per-project approver (Project Head / Atm Head / Trustee).
// Reviewer/Admin only — re-checked in the SECURITY DEFINER RPC.
// ============================================================
export async function setProjectApprover(input: {
  project_id: string
  role: 'project_head' | 'head' | 'founder'
  user_id: string
  add: boolean
}): Promise<{ ok: boolean; error?: string }> {
  if (!uuid.safeParse(input.project_id).success || !uuid.safeParse(input.user_id).success) {
    return { ok: false, error: 'Bad id' }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_set_project_approver', {
    p_project: input.project_id,
    p_role: input.role,
    p_user: input.user_id,
    p_add: input.add,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${input.project_id}`)
  return { ok: true }
}

// ============================================================
// Archive (soft) / restore a project. Archive = a Coordinator can tuck away a
// mistaken project; restore = admin only. Permanent delete stays on the
// /api/projects/[id] endpoint (admin-gated). The RPC enforces the roles.
// ============================================================
export async function setProjectArchived(
  projectId: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad id' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('project_set_archived', { p_project: projectId, p_archived: archived })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true }
}

// ============================================================
// Change the project ALIAS (the short `code` badge) — ADMIN only.
// It's the short label shown everywhere + the prefix on NEW Working-Sheet
// codes. Existing sheet codes are stored strings and keep their old prefix
// (we don't rewrite history). Must stay unique across projects.
// ============================================================
export async function setProjectAlias(
  projectId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can change the project alias' }
  }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }
  const trimmed = code.trim()
  if (trimmed.length < 1 || trimmed.length > 20) {
    return { ok: false, error: 'Alias must be 1–20 characters' }
  }

  const supabase = await createClient()
  // Alias must stay unique — it's the short label + WS-code prefix.
  const { data: clash } = await supabase
    .from('projects')
    .select('id')
    .ilike('code', trimmed)
    .neq('id', projectId)
    .limit(1)
    .maybeSingle()
  if (clash) return { ok: false, error: `Another project already uses the alias "${trimmed}"` }

  const { data, error } = await supabase
    .from('projects')
    .update({ code: trimmed })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Change was blocked — check your permissions' }

  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  return { ok: true }
}

// ============================================================
// Close a sub-category once WO/PO committed == Paid  (HOD #3)
// ============================================================
/** Mark a sub-category complete, or reopen it.
 *
 *  The button only appears where WO equals Paid (see lib/cost-control/completion.ts),
 *  but eligibility is re-checked HERE against the live budget line — a stale page
 *  or a hand-made request must not be able to close a line that still owes money.
 *
 *  Nothing is written to cc_budget_lines: those figures belong to the IN4/BPH
 *  sync. The leftover budget is derived for display. */
export async function setSubSkillCompleted(
  projectId: string,
  subSkillId: string,
  disciplineId: string,
  complete: boolean,
  note: string | null,
): Promise<Result> {
  return runCompletion({ projectId, disciplineId, subSkillId, complete, note })
}

/** Close a whole work category, or reopen it. Closing cascades to every
 *  sub-category under it that is closable; reopening reopens the lot. The
 *  cascade lives in the DB so one click is one transaction — a half-closed
 *  category would refuse requests on some rows and not others. */
export async function setDisciplineCompleted(
  projectId: string,
  disciplineId: string,
  complete: boolean,
  note: string | null,
): Promise<Result> {
  return runCompletion({ projectId, disciplineId, subSkillId: null, complete, note })
}

async function runCompletion({
  projectId, disciplineId, subSkillId, complete, note,
}: {
  projectId: string; disciplineId: string; subSkillId: string | null
  complete: boolean; note: string | null
}): Promise<Result> {
  await requirePermission('cost-control', 'edit')
  // Closing a line is a management judgement, not an engineer’s.
  if (!(await checkIsCcReviewer())) {
    return { ok: false, error: 'Only Cost Control management can close work' }
  }
  const parsed = z.object({
    project_id: uuid,
    discipline_id: uuid,
    sub_skill_id: uuid.nullable(),
    complete: z.boolean(),
    note: z.string().max(300).nullable(),
  }).safeParse({
    project_id: projectId, discipline_id: disciplineId,
    sub_skill_id: subSkillId, complete, note,
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // The RPC re-checks eligibility against what IN4 says right now, writes the
  // audit row, and — for a category — cascades. A stale page cannot close a
  // line that still owes money, because the rule is enforced there, not here.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cc_set_completion', {
    p_project: projectId,
    p_discipline: disciplineId,
    p_sub_skill: subSkillId,
    p_complete: complete,
    p_note: note,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control/billing')
  const touched = Number((data as { sub_skills_touched?: number } | null)?.sub_skills_touched ?? 0)
  return { ok: true, touched }
}

// ============================================================
// “The ERP budget has been reduced too”  (Billing / Coordinator)
// ============================================================
/** Closing a line does not take the leftover money out of IN4 — a person has
 *  to do that by hand. This records that they did. Permission is deliberately
 *  NOT the management one: the people who key IN4 are the ones who can say it
 *  happened, and the DB function is what enforces that. */
export async function setErpReduced(
  projectId: string,
  disciplineId: string,
  subSkillId: string,
  reduced: boolean,
  note: string | null,
): Promise<Result> {
  await requirePermission('cost-control', 'view')
  const parsed = z.object({
    project_id: uuid, discipline_id: uuid, sub_skill_id: uuid,
    reduced: z.boolean(), note: z.string().max(300).nullable(),
  }).safeParse({
    project_id: projectId, discipline_id: disciplineId, sub_skill_id: subSkillId, reduced, note,
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_set_erp_reduced', {
    p_project: projectId,
    p_discipline: disciplineId,
    p_sub_skill: subSkillId,
    p_reduced: reduced,
    p_note: note,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control/billing')
  return { ok: true }
}
