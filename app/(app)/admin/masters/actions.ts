'use server'
// The two writes the Masters screens make. Both admin-only through the
// permission matrix; both leave the hub's own lists untouched except where a
// person explicitly asks to copy one IN4 figure across.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can, getMyUser, getMyProfile } from '@/lib/auth'

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const perms = await getMyPermissions()
  const profile = await getMyProfile()
  if (!can(perms, 'admin-settings', 'view') || !profile || (profile.role !== 'admin' && !profile.is_portal_owner)) return { ok: false, error: 'Only an admin can change this.' }
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  return { ok: true, userId: user.id }
}

/** Pin a hub record to an IN4 master record (or unpin with in4Key = null). */
export async function linkMaster(kind: 'party' | 'material' | 'store', hubTable: string, hubId: string, in4Key: string | null, note?: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  const sb = await createClient()
  if (!in4Key) {
    const { error } = await sb.from('master_links').delete().eq('kind', kind).eq('hub_table', hubTable).eq('hub_id', hubId)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await sb.from('master_links').upsert({ kind, hub_table: hubTable, hub_id: hubId, in4_key: in4Key, note: note ?? null, linked_by: gate.userId, linked_at: new Date().toISOString() }, { onConflict: 'kind,hub_table,hub_id' })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath('/admin/masters', 'layout')
  return { ok: true }
}

/** Copy IN4's construction area onto a hub project that has none. */
export async function useIn4Area(projectId: string, sft: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  if (!Number.isFinite(sft) || sft <= 0) return { ok: false, error: 'IN4 has no area for this project.' }
  const sb = await createClient()
  const { error } = await sb.from('projects').update({ built_up_sft: Math.round(sft) }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/masters/projects')
  return { ok: true }
}
