'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'

// ============================================================
// Step 1 — Project basics (FULLY WIRED)
// ============================================================

const basicsSchema = z.object({
  name: z.string().min(2, 'Project name required'),
  code: z.string().min(1, 'Short code required'),
  parent_project_id: z.string().uuid().nullable().optional(),
  built_up_sft: z.coerce.number().nonnegative().nullable().optional(),
  pm_user_id: z.string().uuid().nullable().optional(),
  start_date: z.string().nullable().optional(),
  target_completion: z.string().nullable().optional(),
})

export type CreateProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

/**
 * Step 1 of the shared Project Setup Wizard.
 * Creates a project row in public.projects with cc_status='setup_incomplete'.
 * Reused by any module that needs a "new project" flow.
 */
export async function createProjectBasics(formData: FormData): Promise<CreateProjectResult> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = basicsSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code'),
    parent_project_id: (formData.get('parent_project_id') as string) || null,
    built_up_sft: formData.get('built_up_sft') || null,
    pm_user_id: (formData.get('pm_user_id') as string) || null,
    start_date: (formData.get('start_date') as string) || null,
    target_completion: (formData.get('target_completion') as string) || null,
  })

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()

  // setup_progress_pct = 20 after step 1 (basics done, 4 steps total).
  const { data, error } = await supabase
    .from('projects')
    .insert({
      ...parsed.data,
      cc_status: 'setup_incomplete',
      setup_progress_pct: 20,
    })
    .select('id')
    .single()

  if (error || !data) {
    // Postgres unique_violation on projects.code
    if (error?.code === '23505') {
      return {
        ok: false,
        error: 'A project with this code already exists. Pick a different short code.',
        fieldErrors: { code: ['Already taken'] },
      }
    }
    return { ok: false, error: error?.message ?? 'Could not create project' }
  }

  revalidatePath('/cost-control')
  return { ok: true, projectId: data.id }
}

// ============================================================
// Step 2 — Toggle disciplines for a project (FULLY WIRED)
// ============================================================

const togglDisciplinesSchema = z.object({
  project_id: z.string().uuid(),
  discipline_ids: z.array(z.string().uuid()),
})

export async function setProjectDisciplines(
  projectId: string,
  disciplineIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = togglDisciplinesSchema.safeParse({
    project_id: projectId,
    discipline_ids: disciplineIds,
  })
  if (!parsed.success) return { ok: false, error: 'Validation failed' }

  const supabase = await createClient()

  // Replace strategy: delete existing assignments for this project then insert chosen.
  // Simple + correct for the wizard. Inline-add buttons elsewhere will use upsert instead.
  const { error: delErr } = await supabase
    .from('cc_project_disciplines')
    .delete()
    .eq('project_id', projectId)
  if (delErr) return { ok: false, error: delErr.message }

  if (disciplineIds.length > 0) {
    const rows = disciplineIds.map(did => ({
      project_id: projectId,
      discipline_id: did,
      enabled_by: user.id,
    }))
    const { error: insErr } = await supabase.from('cc_project_disciplines').insert(rows)
    if (insErr) return { ok: false, error: insErr.message }
  }

  // Bump progress to 50% (steps 1+2 done).
  await supabase.from('projects').update({ setup_progress_pct: 50 }).eq('id', projectId)

  revalidatePath(`/cost-control/projects/${projectId}`)
  revalidatePath('/cost-control')
  return { ok: true }
}

// ============================================================
// Step 3 — Sub-skills (STUB — wire fully in next session)
// ============================================================

export async function setProjectSubSkills(
  projectId: string,
  subSkillIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  // TODO: replace cc_project_sub_skills for this project; bump progress to 80%.
  // Same shape as setProjectDisciplines above. Left as stub to keep this
  // session bounded — wired in the next Cost Control session.
  void projectId
  void subSkillIds
  return { ok: false, error: 'Sub-skill configuration: coming next session' }
}

// ============================================================
// Step 4 — Engineer assignments (STUB)
// ============================================================

export async function assignProjectEngineers(
  projectId: string,
  assignments: Array<{ user_id: string; discipline_ids: string[] }>,
): Promise<{ ok: boolean; error?: string }> {
  // TODO: write to public.project_assignments with role='engineer'.
  // Then mark setup_progress_pct = 100 and cc_status = 'active'.
  void projectId
  void assignments
  return { ok: false, error: 'Engineer assignment: coming next session' }
}

// ============================================================
// Finalize — mark setup complete and go to project page
// ============================================================

export async function finalizeProjectSetup(projectId: string) {
  const supabase = await createClient()
  await supabase
    .from('projects')
    .update({ setup_progress_pct: 100, cc_status: 'active' })
    .eq('id', projectId)
  revalidatePath('/cost-control')
  redirect(`/cost-control/projects/${projectId}`)
}
