'use server'
// Admin actions for the IN4 budget sync screen: the live switch and the
// sub-project ↔ Budget-Hub project links. Both are admin-only through the
// permission matrix (budget-vs-actual admin) and written with the service role
// so the RLS on the link table stays admin-only for everyone else.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getMyPermissions, can, getMyUser } from '@/lib/auth'
import { IN4_LIVE_KEY } from '@/lib/in4/sync'

function svc() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const perms = await getMyPermissions()
  if (!can(perms, 'budget-vs-actual', 'admin') && !can(perms, 'cost-control', 'admin')) return { ok: false, error: 'Only a Budget admin can change this.' }
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  return { ok: true, userId: user.id }
}

export async function setIn4Live(live: boolean): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  const { error } = await svc().from('app_settings').upsert({ key: IN4_LIVE_KEY, value: live ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/budget/in4'); revalidatePath('/budget')
  return { ok: true }
}

export async function linkSubproject(subprojectId: number, bphProjectId: string | null, note?: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  const sb = svc()
  if (!bphProjectId) {
    const { error } = await sb.from('in4_subproject_links').delete().eq('subproject_id', subprojectId)
    if (error) return { ok: false, error: error.message }
  } else {
    // One Budget-Hub project can belong to one IN4 sub-project only.
    const { error: clearErr } = await sb.from('in4_subproject_links').delete().eq('bph_project_id', bphProjectId).neq('subproject_id', subprojectId)
    if (clearErr) return { ok: false, error: clearErr.message }
    const { error } = await sb.from('in4_subproject_links').upsert({
      subproject_id: subprojectId, bph_project_id: bphProjectId, source: 'manual',
      confirmed_by: gate.userId, confirmed_at: new Date().toISOString(), note: note ?? null,
    }, { onConflict: 'subproject_id' })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath('/budget/in4')
  return { ok: true }
}
