'use server'
// Inline-edit actions for the project detail page (cost-control/projects/[id]).
// Unlike the wizard actions which use replace-all semantics, these patch a
// single row at a time — what the PM clicked on.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

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
