'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { capability, type CapabilityId } from '@/lib/revamp/project-people'

export interface PeopleResult { ok: boolean; message: string }

/**
 * Grant or revoke ONE capability for ONE person on ONE project.
 *
 * Six tables hide behind this, and each keeps its own shape. Routing every
 * change through a single action means the panel does not need to know which
 * table it is touching, and means the eventual merge into one table changes
 * this file only.
 *
 * Everything is gated on Cost Control reviewer standing — the same gate the
 * Setup page itself uses, so this cannot become a way round it.
 */
async function guard(): Promise<{ userId: string } | { error: string }> {
  const user = await getMyUser()
  if (!user) return { error: 'Not signed in.' }
  if (!(await checkIsCcReviewer())) return { error: 'Only Cost Control reviewers can change this.' }
  return { userId: user.id }
}

function demo(error: { code?: string; message: string }): PeopleResult {
  if (error.code === 'DEMO_READ_ONLY') {
    return { ok: false, message: 'This is the trial site — nothing is saved here.' }
  }
  return { ok: false, message: error.message }
}

export async function setCapability(
  projectId: string,
  userId: string,
  capId: CapabilityId,
  on: boolean,
  variant?: string,
): Promise<PeopleResult> {
  const g = await guard()
  if ('error' in g) return { ok: false, message: g.error }

  const cap = capability(capId)
  const supabase = await createClient()

  // The project's name is needed only for the one capability keyed on text.
  let projectName: string | null = null
  if (cap.keyedBy === 'name') {
    const { data } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
    projectName = (data as { name?: string } | null)?.name ?? null
    if (!projectName) return { ok: false, message: 'That project has no name to match on.' }
  }

  if (!on) {
    const del = supabase.from(cap.table).delete().eq('user_id', userId)
    const { error } = cap.keyedBy === 'name'
      ? await del.eq('project_name', projectName!)
      : await del.eq('project_id', projectId)
    if (error) return demo(error)
    revalidatePath(`/cost-control/projects/${projectId}/setup`)
    return { ok: true, message: `${cap.label} removed.` }
  }

  // Each table takes a different row shape — this is the only place that knows.
  const row: Record<string, unknown> =
    cap.keyedBy === 'name'
      ? { user_id: userId, project_name: projectName, updated_by: g.userId, updated_at: new Date().toISOString() }
      : { user_id: userId, project_id: projectId }

  if (capId === 'approver') {
    row.role = variant && cap.variants?.includes(variant) ? variant : 'head'
    row.assigned_by = g.userId
  }
  if (capId === 'works_on') row.assigned_by = g.userId
  if (capId === 'jmr_log') row.granted_by = g.userId
  if (capId === 'bill_desk') {
    if (!variant?.trim()) return { ok: false, message: 'Pick which desk they work.' }
    row.desk = variant.trim()
    row.updated_by = g.userId
  }

  const { error } = await supabase.from(cap.table).insert(row)
  if (error) {
    // Already granted — treat as success rather than showing a database error.
    if (error.code === '23505') {
      return { ok: true, message: 'Already set.' }
    }
    return demo(error)
  }

  revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true, message: `${cap.label} added.` }
}

/** Change the approver's level, or which desk someone works, without removing
 *  and re-adding — the two capabilities that carry a value. */
export async function setVariant(
  projectId: string,
  userId: string,
  capId: CapabilityId,
  variant: string,
): Promise<PeopleResult> {
  const g = await guard()
  if ('error' in g) return { ok: false, message: g.error }

  const cap = capability(capId)
  if (!cap.variants && capId !== 'bill_desk') {
    return { ok: false, message: `${cap.label} does not carry a value.` }
  }
  if (cap.variants && !cap.variants.includes(variant)) {
    return { ok: false, message: `"${variant}" is not one of the choices.` }
  }

  const supabase = await createClient()
  const column = capId === 'approver' ? 'role' : 'desk'
  const { error } = await supabase
    .from(cap.table)
    .update({ [column]: variant })
    .eq('user_id', userId)
    .eq('project_id', projectId)

  if (error) return demo(error)
  revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true, message: 'Changed.' }
}
