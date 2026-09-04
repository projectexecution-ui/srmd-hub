'use server'
// Decide what another system's project name means: one of our projects, or
// "not ours" with a reason. Admin-only through the matrix; written with the
// service role so RLS on project_aliases stays admin-only for everyone else.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getMyProfile, getMyUser } from '@/lib/auth'
import type { AliasSource } from '@/lib/aliases'

function svc() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function setAlias(input: { source: AliasSource; alias: string; projectId: string | null; why?: string; remove?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const [profile, user] = await Promise.all([getMyProfile(), getMyUser()])
  if (!user || !profile || (profile.role !== 'admin' && !profile.is_portal_owner)) return { ok: false, error: 'Only an admin can change the mapping.' }
  const sb = svc()
  const alias = input.alias.trim()
  if (!alias) return { ok: false, error: 'Empty name.' }
  if (input.remove) {
    const { error } = await sb.from('project_aliases').delete().eq('source', input.source).eq('alias', alias)
    if (error) return { ok: false, error: error.message }
  } else {
    // Upsert on the normalised alias: the generated column is what the unique
    // key uses, so delete-then-insert keeps one row per (source, spelling).
    const norm = alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const { error: delErr } = await sb.from('project_aliases').delete().eq('source', input.source).eq('alias_norm', norm)
    if (delErr) return { ok: false, error: delErr.message }
    const { error } = await sb.from('project_aliases').insert({
      source: input.source, alias, project_id: input.projectId, confidence: 'certain',
      why: input.why?.trim() || (input.projectId ? 'Confirmed on the Mapping screen' : 'Marked not ours on the Mapping screen'),
      confirmed_by: user.id, confirmed_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath('/admin/masters/mapping')
  return { ok: true }
}
