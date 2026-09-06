'use server'
// Admin actions for the IN4 sync screen: the per-feed live switches and the
// sub-project ↔ Budget-Hub project links. Admin-only through the permission
// matrix and written with the service role so the RLS on the link table stays
// admin-only for everyone else.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getMyPermissions, can, getMyUser } from '@/lib/auth'
import { FEED_LIVE_KEY, type Feed } from '@/lib/in4/feeds'

function svc() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const perms = await getMyPermissions()
  if (!can(perms, 'admin-settings', 'view') && !can(perms, 'budget-vs-actual', 'admin') && !can(perms, 'cost-control', 'admin')) return { ok: false, error: 'Only an admin can change this.' }
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  return { ok: true, userId: user.id }
}

export async function setFeedLive(feed: Feed, live: boolean): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  const key = FEED_LIVE_KEY[feed]
  if (!key) return { ok: false, error: 'This feed has no live switch.' }
  const { error } = await svc().from('app_settings').upsert({ key, value: live ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/in4'); revalidatePath('/budget'); revalidatePath('/procurement-tracker'); revalidatePath('/contractor-report'); revalidatePath('/supplier-report')
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
  revalidatePath('/admin/in4')
  return { ok: true }
}
