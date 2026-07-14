'use server'
// Internal Estimate revision workflow transitions. All role checks re-run
// inside the SECURITY DEFINER RPCs; these wrappers just call them + revalidate.
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type R = { ok: boolean; error?: string }

export async function requestIeReopen(projectId: string, note: string | null): Promise<R> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_ie_request_reopen', { p_project: projectId, p_note: note })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

export async function decideIeReopen(projectId: string, revisionId: string, approve: boolean, note: string | null): Promise<R> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_ie_decide_reopen', { p_revision: revisionId, p_approve: approve, p_note: note })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

export async function submitIeRevision(projectId: string, revisionId: string, url: string, name: string): Promise<R> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_ie_submit_revision', { p_revision: revisionId, p_url: url, p_name: name })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

export async function rejectIeRevision(projectId: string, revisionId: string, note: string | null): Promise<R> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_ie_decide_revision', { p_revision: revisionId, p_note: note })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}
