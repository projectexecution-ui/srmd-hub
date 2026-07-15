'use server'
// Inline-edit actions for the project detail page (cost-control/projects/[id]).
// Unlike the wizard actions which use replace-all semantics, these patch a
// single row at a time — what the PM clicked on.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'

const uuid = z.string().uuid()
const isoDateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()

type Result = { ok: true } | { ok: false; error: string }

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
// Rename a project — ADMIN only. The name shows on every module
// (dashboard groups, sheets, reports), so renaming is kept above
// management level. Code stays fixed — it's baked into WS codes.
// ============================================================
export async function renameProject(
  projectId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getMyProfile()
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an Admin can rename a project' }
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
