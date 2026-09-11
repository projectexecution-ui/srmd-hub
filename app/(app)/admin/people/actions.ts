'use server'
// Writes behind the People grids (Admin → People). Every action is admin /
// Portal Owner only and touches exactly one cell's worth of data, so a tap is
// always small and always reversible by tapping again.

import { revalidatePath } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { GRANT_KEYS, type GrantKey, type Result } from '@/lib/revamp/people-grants'


async function guard(): Promise<{ id: string } | null> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) return null
  return { id: profile.id }
}
const denied: Result = { ok: false, message: 'Only an admin can change this.' }
const fail = (e: { code?: string; message: string }): Result => ({ ok: false, message: e.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : e.message })

export async function setGrant(grant: GrantKey, userId: string, on: boolean): Promise<Result> {
  if (!(await guard())) return denied
  const key = GRANT_KEYS[grant]
  if (!key) return { ok: false, message: 'Unknown grant.' }
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  const ids = new Set(((data?.value as string | null) ?? '').match(/[0-9a-f-]{36}/gi) ?? [])
  if (on) ids.add(userId); else ids.delete(userId)
  const { error } = await supabase.from('app_settings').upsert({ key, value: [...ids].join(',') }, { onConflict: 'key' })
  if (error) return fail(error)
  revalidatePath('/admin/people'); revalidatePath('/cost-control/settings'); revalidatePath('/admin/manual-upload')
  return { ok: true }
}

/** Approvers go through the SECURITY DEFINER RPC the setup page uses; the table itself has no write policy. */
export async function setApprover(projectId: string, role: 'project_head' | 'head' | 'founder', userId: string, on: boolean): Promise<Result> {
  if (!(await guard())) return denied
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_set_project_approver', { p_project: projectId, p_role: role, p_user: userId, p_add: on })
  if (error) return fail(error)
  revalidatePath('/admin/people'); revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true }
}

export async function setAssignment(userId: string, projectId: string, on: boolean): Promise<Result> {
  const me = await guard(); if (!me) return denied
  const supabase = await createClient()
  const { error } = on
    // role is NOT NULL; every assignment today is 'engineer' and the project page reads role='engineer'
    ? await supabase.from('project_assignments').insert({ user_id: userId, project_id: projectId, role: 'engineer', assigned_by: me.id })
    : await supabase.from('project_assignments').delete().eq('user_id', userId).eq('project_id', projectId)
  if (error && error.code !== '23505') return fail(error)
  revalidatePath('/admin/people'); revalidatePath(`/cost-control/projects/${projectId}/setup`)
  return { ok: true }
}

/** A row in procurement_user_project_visibility HIDES that project from that person. */
export async function setIndentHidden(userId: string, projectName: string, hidden: boolean): Promise<Result> {
  const me = await guard(); if (!me) return denied
  const supabase = await createClient()
  const { error } = hidden
    ? await supabase.from('procurement_user_project_visibility').upsert({ user_id: userId, project_name: projectName, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id,project_name' })
    : await supabase.from('procurement_user_project_visibility').delete().eq('user_id', userId).eq('project_name', projectName)
  if (error) return fail(error)
  revalidatePath('/admin/people'); revalidatePath('/procurement-tracker/admin')
  return { ok: true }
}

export async function setBillsAssignment(userId: string, code: string, on: boolean): Promise<Result> {
  if (!(await guard())) return denied
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'bills_digest_assignments').maybeSingle()
  let map: Record<string, string[]> = {}
  try { const p = JSON.parse((data?.value as string | null) ?? '{}'); if (p && typeof p === 'object' && !Array.isArray(p)) map = p } catch { /* start clean */ }
  const cur = new Set(Array.isArray(map[userId]) ? map[userId] : [])
  if (on) cur.add(code); else cur.delete(code)
  if (cur.size) map[userId] = [...cur]; else delete map[userId]
  const { error } = await supabase.from('app_settings').upsert({ key: 'bills_digest_assignments', value: JSON.stringify(map) }, { onConflict: 'key' })
  if (error) return fail(error)
  revalidatePath('/admin/people'); revalidatePath('/bills-pipeline/digest-settings'); revalidatePath('/admin/email')
  return { ok: true }
}

/** One role per person (AGENTS.md). Admins change it here or on Users & roles; never your own, so you cannot lock yourself out. */
export async function setRole(userId: string, role: string): Promise<Result> {
  const me = await guard(); if (!me) return denied
  if (userId === me.id) return { ok: false, message: 'Change your own role from Users & roles, with another admin present.' }
  if (!(role in (await getRoleLabels()))) return { ok: false, message: 'Unknown role.' }
  const supabase = await createClient()
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
  if (error) return fail(error)
  revalidatePath('/admin/people'); revalidatePath('/admin/projects'); revalidatePath('/admin/users')
  return { ok: true }
}

/** notification_preferences is RLS'd to the person themself, so an admin writes it with the service role. */
export async function setChannel(userId: string, channel: 'in_app' | 'email' | 'web_push', on: boolean): Promise<Result> {
  if (!(await guard())) return denied
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { ok: false, message: 'The server has no service key set.' }
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data: existing } = await svc.from('notification_preferences').select('user_id').eq('user_id', userId).maybeSingle()
  const row: Record<string, unknown> = existing
    ? { user_id: userId, [channel]: on, updated_at: new Date().toISOString() }
    : { user_id: userId, in_app: true, email: true, web_push: false, telegram: false, [channel]: on, updated_at: new Date().toISOString() }
  const { error } = await svc.from('notification_preferences').upsert(row, { onConflict: 'user_id' })
  if (error) return fail(error)
  revalidatePath('/admin/people')
  return { ok: true }
}
