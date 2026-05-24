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

/** Slugs the Portal Owner has explicitly disabled. Missing slug = enabled.
 *  Read by every authenticated user (RLS-public select). */
export const getDisabledModuleSlugs = cache(async (): Promise<Set<string>> => {
  const user = await getMyUser()
  if (!user) return new Set()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('module_visibility')
    .select('slug, enabled')
  if (error || !data) return new Set()
  return new Set(
    (data as Array<{ slug: string; enabled: boolean }>)
      .filter(r => !r.enabled)
      .map(r => r.slug),
  )
})

/** True when the module is enabled portal-wide (or the viewer is the
 *  Portal Owner — they always see everything so they can manage). */
export async function isModuleEnabled(slug: string): Promise<boolean> {
  if (await isPortalOwner()) return true
  const disabled = await getDisabledModuleSlugs()
  return !disabled.has(slug)
}

/** Require a permission or redirect. Use at top of authed pages.
 *  Also enforces the Portal Owner's module on/off switch. */
export async function requirePermission(slug: string, action: PermAction, redirectTo = '/dashboard') {
  const perms = await getMyPermissions()
  if (!can(perms, slug, action)) redirect(redirectTo)
  if (!(await isModuleEnabled(slug))) redirect(redirectTo)
  return perms
}

/** True if the current user is a Portal Owner (additive super-power on top
 *  of admin — can promote/demote other admins to Portal Owner, edit
 *  portal-wide settings/layouts). */
export const isPortalOwner = cache(async (): Promise<boolean> => {
  const profile = await getMyProfile()
  return !!profile?.is_portal_owner
})

/** Page guard: must be a Portal Owner or redirect. */
export async function requirePortalOwner(redirectTo = '/dashboard') {
  if (!(await isPortalOwner())) redirect(redirectTo)
}

/** Page guard for inventory sub-sections. Slug is one of the values in
 *  INVENTORY_SECTIONS. Portal Owner bypasses the check (so they can
 *  always manage). Everyone else gets redirected when the section has
 *  been turned off via /admin/dashboard-modules. */
export async function requireInventorySection(slug: string, redirectTo = '/inventory') {
  if (await isPortalOwner()) return
  const disabled = await getDisabledModuleSlugs()
  if (disabled.has(slug)) redirect(redirectTo)
}
