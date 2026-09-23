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
import { kindOf, parentError, kindChangeError, parentKindFor, type ProjectKind } from '@/lib/projects/kind'
import { recodeWs, wsCodeCandidates } from '@/lib/cost-control/ws-code'

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
  // Read the old name first so the audit line says what changed, not just that
  // something did — the name is a match key (BPH links, sub-project matcher).
  const { data: before } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
  // .select() catches a silent RLS no-op (0 rows) — report it, don't
  // pretend the rename happened.
  const { data, error } = await supabase
    .from('projects')
    .update({ name: trimmed })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Rename was blocked — check your permissions' }

  await auditProjectEdit(projectId, 'project_renamed', `Renamed “${before?.name ?? '?'}” → “${trimmed}”`)
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  return { ok: true }
}

/** One audit row in cc_budget_events for a name/code/short-name change — the
 *  same log every other Cost Control edit lands in (/cost-control/audit).
 *  Best-effort: a failed audit write must not undo a saved change. */
async function auditProjectEdit(
  projectId: string,
  eventType: 'project_renamed' | 'project_code_changed' | 'project_short_name',
  remarks: string,
): Promise<void> {
  try {
    const supabase = await createClient()
    const profile = await getMyProfile()
    await supabase.from('cc_budget_events').insert({
      project_id: projectId,
      event_type: eventType,
      delta_amount: 0,
      remarks: remarks.slice(0, 500),
      requested_by: profile?.id ?? null,
    })
  } catch (e) {
    console.error('[cc] audit write failed', eventType, projectId, e)
  }
}

// ============================================================
// Set / clear the PARENT — ADMIN only. Three fixed levels since 23 Sep 2026
// (Aksha, H1): a project may sit under a group or stand alone; a sub-project
// must sit under a project; a group is always top-level. The words and the
// checks are lib/projects/kind.ts; the database trigger holds the same rules.
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
  const { data: me } = await supabase.from('projects').select('project_type').eq('id', projectId).maybeSingle()
  if (!me) return { ok: false, error: 'Project not found' }
  const kind = kindOf(me.project_type as string | null)

  let parent: { kind: ProjectKind } | null = null
  if (parentId != null) {
    const { data: par } = await supabase.from('projects').select('id, project_type').eq('id', parentId).maybeSingle()
    if (!par) return { ok: false, error: 'Parent project not found' }
    parent = { kind: kindOf(par.project_type as string | null) }
  }
  const why = parentError(kind, parent)
  if (why) return { ok: false, error: why }

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
// Change the KIND — Group / Project / Sub-project — ADMIN only. What already
// sits under the row decides what it may become; the parent follows the new
// kind (a group drops its parent; a project keeps a group parent and drops
// any other; a sub-project needs a project picked, so it keeps a project
// parent and otherwise asks).
// ============================================================
export async function setProjectKind(
  projectId: string,
  next: ProjectKind,
): Promise<{ ok: boolean; error?: string; parentId?: string | null }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') return { ok: false, error: 'Only an Admin can change what kind of project this is' }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }

  const supabase = await createClient()
  const [{ data: me }, { data: kids }] = await Promise.all([
    supabase.from('projects').select('project_type, parent_project_id').eq('id', projectId).maybeSingle(),
    supabase.from('projects').select('project_type').eq('parent_project_id', projectId).is('archived_at', null),
  ])
  if (!me) return { ok: false, error: 'Project not found' }
  const blocked = kindChangeError(next, (kids ?? []).map(k => kindOf(k.project_type as string | null)))
  if (blocked) return { ok: false, error: blocked }

  // Does the current parent still fit? Keep it when it does, drop it when a
  // kind allows none, and refuse when the kind needs one that is not there.
  let parentId: string | null = (me.parent_project_id as string | null) ?? null
  if (parentId) {
    const { data: par } = await supabase.from('projects').select('project_type').eq('id', parentId).maybeSingle()
    const parKind = par ? kindOf(par.project_type as string | null) : null
    if (parKind !== parentKindFor(next)) parentId = null
  }
  if (next === 'subproject' && !parentId) {
    return { ok: false, error: 'A sub-project must sit under a project — pick the project first, then change the kind.' }
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ project_type: next, parent_project_id: parentId })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Change was blocked — check your permissions' }

  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true, parentId }
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
/**
 * SHORT NAME — what the chip shows (name layer, Phase 1; Aksha, 10 Sep 2026).
 * Display only: the code underneath is untouched, so Working-Sheet numbers and
 * every matcher carry on exactly as before. Blank clears it and the chip falls
 * back to the code. Need not be unique — two "Infra" chips under different
 * groups read fine in context; the editor tells you when it is shared.
 */
export async function setProjectShortName(
  projectId: string,
  shortName: string,
): Promise<{ ok: boolean; error?: string; sharedWith?: string[] }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can change the short name' }
  }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }
  const trimmed = shortName.trim()
  if (trimmed.length > 30) return { ok: false, error: 'Short name must be 30 characters or fewer' }

  const supabase = await createClient()
  const { data: before } = await supabase.from('projects').select('short_name, code').eq('id', projectId).maybeSingle()
  const { data, error } = await supabase
    .from('projects')
    .update({ short_name: trimmed || null })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Change was blocked — check your permissions' }

  // Not a rule, a heads-up: which other projects already show this chip.
  let sharedWith: string[] = []
  if (trimmed) {
    const { data: same } = await supabase
      .from('projects').select('name').ilike('short_name', trimmed).neq('id', projectId).is('archived_at', null).limit(5)
    sharedWith = (same ?? []).map(r => r.name as string)
  }

  await auditProjectEdit(projectId, 'project_short_name',
    trimmed ? `Short name “${before?.short_name ?? '(none)'}” → “${trimmed}” (code ${before?.code ?? '?'} unchanged)` : `Short name cleared — chip shows code ${before?.code ?? '?'} again`)
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  revalidatePath(`/project/${projectId}`)
  return { ok: true, sharedWith }
}

/**
 * CODE — the real one. Kept editable, admin-only, behind an explicit control
 * with a warning, because it IS a key: the prefix on every new Working-Sheet
 * number and the last-resort match in the IN4 sub-project matcher. Existing
 * sheet codes are stored strings and keep their old prefix. Must stay unique.
 * Logged to the audit like any other Cost Control edit.
 */
export async function setProjectCode(
  projectId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can change the project code' }
  }
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Bad project id' }
  const trimmed = code.trim()
  if (trimmed.length < 1 || trimmed.length > 20) {
    return { ok: false, error: 'Code must be 1–20 characters' }
  }

  const supabase = await createClient()
  const { data: clash } = await supabase
    .from('projects')
    .select('id')
    .ilike('code', trimmed)
    .neq('id', projectId)
    .limit(1)
    .maybeSingle()
  if (clash) return { ok: false, error: `Another project already uses the code "${trimmed}"` }

  const { data: before } = await supabase.from('projects').select('code').eq('id', projectId).maybeSingle()
  const { data, error } = await supabase
    .from('projects')
    .update({ code: trimmed })
    .eq('id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'Change was blocked — check your permissions' }

  await auditProjectEdit(projectId, 'project_code_changed', `Code “${before?.code ?? '?'}” → “${trimmed}” — new Working Sheets take the new prefix; existing sheet codes keep the old one`)
  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  revalidatePath(`/project/${projectId}`)
  return { ok: true }
}

/** @deprecated The "alias" was the code. Kept so nothing that still imports
 *  it breaks; it now does what its name always implied and sets the SHORT NAME. */
export async function setProjectAlias(projectId: string, alias: string): Promise<{ ok: boolean; error?: string }> {
  const r = await setProjectShortName(projectId, alias)
  return { ok: r.ok, error: r.error }
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

// ============================================================
// Move an imported Internal Estimate to another sub-category.
// ============================================================
// Aksha, 21 Sep 2026: the 90.9 L on NGH A's 801 High Side belonged under 804
// SW & CP Fittings. There was no way to do it — the only routes were a full
// revised-Internal-Budget upload (which archives every [IB] sheet on the
// project to move one line) or a hand-written database change. This is the
// third way, and it does exactly one thing.
//
// WHAT IT MOVES. The imported [IB…] baseline sheets that carry the estimate —
// not budgets, not approvals, not the engineer's ask. Nothing about the money
// changes: the sheet keeps its amount, its status and its history, and only
// the sub-category it is filed under changes.
//
// THE RULES, each a refusal rather than a silent surprise:
//   · same work category only, so a category total can never move;
//   · the target must be switched on for the project;
//   · the target must not already hold an imported estimate, or the two would
//     add up and the project would quietly gain money;
//   · not while a revised Internal Budget is waiting for the Trustee, because
//     approving that re-imports everything and would undo this unnoticed;
//   · a reason is required, and both old and new values are stamped into
//     cc_working_sheet_edits — the sheet's own history, where anyone looking
//     at it later will find them.

type MoveResult =
  | { ok: true; moved: number; amount: number; newCodes: string[] }
  | { ok: false; error: string }

/** The first code for the target sub-skill that the unique index will accept.
 *  The naming rule itself lives in lib/cost-control/ws-code.ts, where it is
 *  tested; this only walks the candidates against the table. */
async function freeWsCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  current: string, fromCode: string, toCode: string,
): Promise<string> {
  const candidates = wsCodeCandidates(recodeWs(current, fromCode, toCode))
  for (const candidate of candidates) {
    const { data } = await supabase.from('cc_working_sheets').select('id').eq('ws_code', candidate).maybeSingle()
    if (!data) return candidate
  }
  return candidates[candidates.length - 1]
}

export async function moveEstimateToSubSkill(
  projectId: string,
  fromSubSkillId: string,
  toSubSkillId: string,
  reason: string,
): Promise<MoveResult> {
  await requirePermission('cost-control', 'edit')
  // The same standing the row menu itself needs — the Internal Estimate is
  // management-confidential, and this re-files it.
  if (!(await checkIsCcReviewer())) {
    return { ok: false, error: 'Only a Cost Control reviewer can move an estimate.' }
  }

  const parsed = z.object({
    project_id: uuid,
    from_sub_skill_id: uuid,
    to_sub_skill_id: uuid,
    reason: z.string().trim().min(3, 'Say why it is moving — this goes on the record.').max(300),
  }).safeParse({
    project_id: projectId, from_sub_skill_id: fromSubSkillId,
    to_sub_skill_id: toSubSkillId, reason,
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  if (fromSubSkillId === toSubSkillId) return { ok: false, error: 'That is the sub-category it is already on.' }

  const supabase = await createClient()

  // A revised Internal Budget awaiting the Trustee re-imports the whole
  // estimate on approval, which would quietly undo this.
  const { data: lock } = await supabase.rpc('cc_ie_lock_state', { p_project: projectId })
  if (lock === 'revision_submitted') {
    return { ok: false, error: 'A revised Internal Budget is waiting for the Trustee. Approving it re-imports the whole estimate, so settle that first — otherwise this move would be undone without anyone noticing.' }
  }

  const { data: subsRaw } = await supabase
    .from('cc_sub_skills').select('id, code, name, discipline_id')
    .in('id', [fromSubSkillId, toSubSkillId])
  const subs = (subsRaw ?? []) as Array<{ id: string; code: string; name: string; discipline_id: string }>
  const from = subs.find(s => s.id === fromSubSkillId)
  const to = subs.find(s => s.id === toSubSkillId)
  if (!from || !to) return { ok: false, error: 'That sub-category no longer exists.' }
  if (from.discipline_id !== to.discipline_id) {
    return { ok: false, error: 'An estimate can only move within the same work category, so that no category total changes. Across categories is a revised Internal Budget, not a re-filing.' }
  }

  const { data: onProject } = await supabase
    .from('cc_project_sub_skills').select('is_enabled')
    .eq('project_id', projectId).eq('sub_skill_id', toSubSkillId).maybeSingle()
  if (!onProject?.is_enabled) {
    return { ok: false, error: `${to.code} ${to.name} is not switched on for this project. Add it in setup first.` }
  }

  const { data: sheetsRaw } = await supabase
    .from('cc_working_sheets').select('id, ws_code, total_amount')
    .eq('project_id', projectId).eq('sub_skill_id', fromSubSkillId)
    .is('archived_at', null).like('summary_notes', '[IB%')
  const sheets = (sheetsRaw ?? []) as Array<{ id: string; ws_code: string; total_amount: number | null }>
  if (sheets.length === 0) {
    return { ok: false, error: `${from.code} ${from.name} has no imported estimate to move.` }
  }

  const { data: taken } = await supabase
    .from('cc_working_sheets').select('ws_code')
    .eq('project_id', projectId).eq('sub_skill_id', toSubSkillId)
    .is('archived_at', null).like('summary_notes', '[IB%').limit(1)
  if (taken && taken.length > 0) {
    const held = (taken[0] as { ws_code: string }).ws_code
    return { ok: false, error: `${to.code} ${to.name} already carries an imported estimate (${held}). Two would add together — move that one out first, or choose another sub-category.` }
  }

  // The trap this closes: where a sub-skill's estimate is MAINTAINED (it
  // follows the ERP budget — cc_budget_lines.internal_estimate_set_at), the
  // maintained figure wins over the imported baseline on the page. Moving a
  // baseline onto such a row would save correctly and then show nothing: the
  // amount would be masked and look lost. Refuse, and say which figure is in
  // the way.
  const { data: maintained } = await supabase
    .from('cc_budget_lines').select('internal_estimate_amt, internal_estimate_set_at')
    .eq('project_id', projectId).eq('sub_skill_id', toSubSkillId).maybeSingle()
  if (maintained?.internal_estimate_set_at) {
    const held = maintained.internal_estimate_amt != null ? formatINR(Number(maintained.internal_estimate_amt)) : 'a maintained figure'
    return { ok: false, error: `${to.code} ${to.name} already has a maintained estimate (${held}), which takes precedence over an imported one. Moving it there would hide the amount rather than show it — clear that estimate first, or choose another sub-category.` }
  }

  const me = await getMyProfile()
  const note = `Internal Estimate moved from ${from.code} ${from.name} to ${to.code} ${to.name} — ${parsed.data.reason}`
  const newCodes: string[] = []
  let amount = 0

  for (const ws of sheets) {
    const newCode = await freeWsCode(supabase, ws.ws_code, from.code, to.code)
    const { error } = await supabase
      .from('cc_working_sheets')
      .update({ sub_skill_id: toSubSkillId, ws_code: newCode })
      .eq('id', ws.id)
      .eq('sub_skill_id', fromSubSkillId) // nobody moved it while we looked
    if (error) {
      return {
        ok: false,
        error: newCodes.length
          ? `${newCodes.length} sheet(s) moved, then this one failed: ${error.message}`
          : error.message,
      }
    }
    newCodes.push(newCode)
    amount += Number(ws.total_amount) || 0

    // The trail. Best-effort: a sheet that moved but whose note failed to
    // write is better than failing the move and leaving it half done.
    await supabase.from('cc_working_sheet_edits').insert([
      { working_sheet_id: ws.id, edited_by: me?.id ?? null, field_name: 'sub_skill_id', old_value: fromSubSkillId, new_value: toSubSkillId, reason: note },
      { working_sheet_id: ws.id, edited_by: me?.id ?? null, field_name: 'ws_code', old_value: ws.ws_code, new_value: newCode, reason: note },
    ])
  }

  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath(`/project/${projectId}`)
  return { ok: true, moved: sheets.length, amount, newCodes }
}
