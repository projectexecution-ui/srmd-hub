// The app shell — who you are, what you may open, which modules are on, what
// they are called, how the sidebar is grouped — read ONCE per request and
// cached for a minute per user.
//
// Before this, every navigation paid six database round-trips before the page
// could start (profile, my_permissions(), module_visibility, module_labels,
// sidebar groups, portal owner), and most pages then asked for two or three
// of them again. On Vercel that was the single largest fixed cost per view.
//
// The cache is keyed by user id and tagged, so an admin change (a permission,
// a module switch, a rename) can expire everyone's shell at once via
// revalidateShell() — the 60 s TTL is only the backstop.

import { cache } from 'react'
import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyUser } from '@/lib/auth-user'
import type { Profile, PermissionMap } from '@/lib/types'
import { parseSidebarGroups, type SidebarGroup } from '@/lib/sidebar-groups'
import { DEFAULT_MODULE_LABELS, type ModuleLabelMap } from '@/lib/module-labels'
import type { FlatProject } from '@/lib/project-tree'

export const SHELL_TAG = 'shell'

export interface Shell {
  profile: Profile | null
  permissions: PermissionMap
  disabled: Set<string>
  labels: ModuleLabelMap
  sidebarGroups: SidebarGroup[]
  /** Live Internal Estimate projects, for the sidebar tree. */
  projects: FlatProject[]
}

interface RawShell {
  profile: Profile | null
  permissions: Record<string, { view: boolean; edit: boolean; admin: boolean }> | null
  disabled: string[] | null
  labels: Record<string, { label: string; description: string | null }> | null
  sidebar_groups: string | null
  projects: FlatProject[] | null
}

async function fetchShell(userId: string): Promise<RawShell | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const sb = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc('shell_for', { p_user: userId })
  if (error) { console.error('[shell] shell_for failed', error); return null }
  return (data ?? null) as RawShell | null
}

const cachedShell = unstable_cache(
  async (userId: string) => fetchShell(userId),
  ['shell'],
  { tags: [SHELL_TAG], revalidate: 60 },
)

function hydrate(raw: RawShell): Shell {
  const labels: ModuleLabelMap = { ...DEFAULT_MODULE_LABELS }
  for (const [slug, l] of Object.entries(raw.labels ?? {})) {
    labels[slug] = { label: l.label, description: l.description ?? DEFAULT_MODULE_LABELS[slug]?.description ?? '' }
  }
  const permissions: PermissionMap = {}
  for (const [slug, p] of Object.entries(raw.permissions ?? {})) permissions[slug] = { view: !!p.view, edit: !!p.edit, admin: !!p.admin }
  return {
    profile: raw.profile,
    permissions,
    disabled: new Set(raw.disabled ?? []),
    labels,
    sidebarGroups: parseSidebarGroups(raw.sidebar_groups),
    projects: Array.isArray(raw.projects) ? raw.projects : [],
  }
}

/** The current user's shell, or null when signed out (or when the service key
 *  is missing — callers fall back to the per-query path in that case). */
export const getShell = cache(async (): Promise<Shell | null> => {
  const user = await getMyUser()
  if (!user) return null
  const raw = await cachedShell(user.id)
  return raw ? hydrate(raw) : null
})

/** Call after ANY write that changes what a shell contains: role_permissions,
 *  module_visibility, module_labels, user_module_roles / blocks, sidebar
 *  groups, a profile's role or is_active. Expires every user's cached shell. */
export function revalidateShell(): void {
  revalidateTag(SHELL_TAG, { expire: 0 })
}
