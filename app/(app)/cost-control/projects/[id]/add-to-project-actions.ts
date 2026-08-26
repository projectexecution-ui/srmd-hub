'use server'
// Add a work category / sub-category to a project, from the project view itself
// — the HOD's point 6.
//
// Creating a CODE is admin-only (admin / Trustee / coordinator), and that is a
// deliberate call rather than an oversight: cc_disciplines and cc_sub_skills are
// ONE master list shared by every project, so a new code appears in all 33
// projects' pickers. Atm Heads hold can_edit but not can_admin, so they cannot
// mint codes — an admin adds it for them.
//
// Each action takes either an existing master id (just switch it on for this
// project) or a code + name to create first. Re-enabling something that was
// switched off earlier is an UPDATE, not an insert: the (project, item) row
// already exists and inserting again would collide.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'

const uuid = z.string().uuid()
type Result = { ok: true } | { ok: false; error: string }

const codeName = z.object({
  code: z.string().trim().min(1, 'Code is required').max(20, 'Code is too long'),
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
})

/** Enable an existing work category on this project, or create one and enable it. */
export async function addDisciplineToProject(
  projectId: string,
  existingId: string | null,
  newCode: string | null,
  newName: string | null,
): Promise<Result> {
  await requirePermission('cost-control', 'admin')
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Invalid project' }

  const supabase = await createClient()
  let disciplineId = existingId

  if (!disciplineId) {
    const parsed = codeName.safeParse({ code: newCode, name: newName })
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    const { code, name } = parsed.data

    // Two projects meaning different things by "12" is exactly how a shared
    // master list rots. Reuse a code that already exists instead of duplicating.
    const { data: clash } = await supabase
      .from('cc_disciplines').select('id').ilike('code', code).limit(1).maybeSingle()
    if (clash) {
      disciplineId = clash.id as string
    } else {
      // display_order from the leading number in the code, matching
      // lib/cost-control/discipline-order.ts, so a new category sorts where a
      // reader expects instead of floating to the top on 0 (the HOD's point 1).
      const order = Number.parseInt(code.replace(/\D.*$/, ''), 10)
      const { data: created, error: cErr } = await supabase
        .from('cc_disciplines')
        .insert({ code, name, display_order: Number.isFinite(order) && order > 0 ? order : 0 })
        .select('id').single()
      if (cErr || !created) return { ok: false, error: cErr?.message ?? 'Could not create the work category' }
      disciplineId = created.id as string
    }
  }

  const profile = await getMyProfile()
  const { data: existing } = await supabase
    .from('cc_project_disciplines').select('id, is_enabled')
    .eq('project_id', projectId).eq('discipline_id', disciplineId).maybeSingle()

  if (existing) {
    if (existing.is_enabled) return { ok: false, error: 'That work category is already on this project' }
    const { data, error } = await supabase
      .from('cc_project_disciplines')
      .update({ is_enabled: true, enabled_at: new Date().toISOString(), enabled_by: profile?.id ?? null })
      .eq('id', existing.id).select('id')
    if (error) return { ok: false, error: error.message }
    // An RLS refusal comes back as 200 with zero rows, never an error.
    if (!data?.length) return { ok: false, error: 'Change was blocked — check your permissions' }
  } else {
    const { data, error } = await supabase
      .from('cc_project_disciplines')
      .insert({
        project_id: projectId, discipline_id: disciplineId, is_enabled: true,
        enabled_at: new Date().toISOString(), enabled_by: profile?.id ?? null,
      })
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: 'Change was blocked — check your permissions' }
  }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

/** Enable an existing sub-category under a work category, or create one and enable it. */
export async function addSubSkillToProject(
  projectId: string,
  disciplineId: string,
  existingId: string | null,
  newCode: string | null,
  newName: string | null,
): Promise<Result> {
  await requirePermission('cost-control', 'admin')
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(disciplineId).success) {
    return { ok: false, error: 'Invalid project or work category' }
  }

  const supabase = await createClient()
  let subSkillId = existingId

  if (!subSkillId) {
    const parsed = codeName.safeParse({ code: newCode, name: newName })
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    const { code, name } = parsed.data

    const { data: clash } = await supabase
      .from('cc_sub_skills').select('id, discipline_id').ilike('code', code).limit(1).maybeSingle()
    if (clash) {
      // The same code under a DIFFERENT category is a real conflict, not a
      // reuse — say so rather than silently attaching it somewhere unexpected.
      if ((clash.discipline_id as string) !== disciplineId) {
        return { ok: false, error: `Code ${code} already exists under a different work category` }
      }
      subSkillId = clash.id as string
    } else {
      const { data: created, error: cErr } = await supabase
        .from('cc_sub_skills')
        .insert({ discipline_id: disciplineId, code, name })
        .select('id').single()
      if (cErr || !created) return { ok: false, error: cErr?.message ?? 'Could not create the sub-category' }
      subSkillId = created.id as string
    }
  }

  // A sub-category is meaningless while its category is off for this project.
  const { data: parent } = await supabase
    .from('cc_project_disciplines').select('is_enabled')
    .eq('project_id', projectId).eq('discipline_id', disciplineId).maybeSingle()
  if (!parent?.is_enabled) return { ok: false, error: 'Add the work category to this project first' }

  const profile = await getMyProfile()
  const { data: existing } = await supabase
    .from('cc_project_sub_skills').select('id, is_enabled')
    .eq('project_id', projectId).eq('sub_skill_id', subSkillId).maybeSingle()

  if (existing) {
    if (existing.is_enabled) return { ok: false, error: 'That sub-category is already on this project' }
    const { data, error } = await supabase
      .from('cc_project_sub_skills')
      .update({ is_enabled: true, enabled_at: new Date().toISOString(), enabled_by: profile?.id ?? null })
      .eq('id', existing.id).select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: 'Change was blocked — check your permissions' }
  } else {
    const { data, error } = await supabase
      .from('cc_project_sub_skills')
      .insert({
        project_id: projectId, sub_skill_id: subSkillId, is_enabled: true,
        enabled_at: new Date().toISOString(), enabled_by: profile?.id ?? null,
      })
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: 'Change was blocked — check your permissions' }
  }

  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}
