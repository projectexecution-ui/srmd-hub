// Server-side auth + permissions helpers.
// React's cache() dedupes within a single SSR request, so the dashboard
// can call getMyProfile / getMyPermissions multiple times for free.

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, PermissionMap, PermAction } from '@/lib/types'

export const getMyUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const getMyProfile = cache(async (): Promise<Profile | null> => {
  const user = await getMyUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  return (data as Profile) ?? null
})

export const getMyPermissions = cache(async (): Promise<PermissionMap> => {
  const user = await getMyUser()
  if (!user) return {}
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('my_permissions')
  if (error || !data) return {}
  const map: PermissionMap = {}
  for (const row of data as Array<{ module_slug: string; can_view: boolean; can_edit: boolean; can_admin: boolean }>) {
    map[row.module_slug] = {
      view: !!row.can_view,
      edit: !!row.can_edit,
      admin: !!row.can_admin,
    }
  }
  return map
})

export function can(perms: PermissionMap, slug: string, action: PermAction): boolean {
  const p = perms[slug]
  if (!p) return false
  if (action === 'view') return p.view
  if (action === 'edit') return p.edit
  return p.admin
}

/** Require a permission or redirect. Use at top of authed pages. */
export async function requirePermission(slug: string, action: PermAction, redirectTo = '/dashboard') {
  const perms = await getMyPermissions()
  if (!can(perms, slug, action)) redirect(redirectTo)
  return perms
}
