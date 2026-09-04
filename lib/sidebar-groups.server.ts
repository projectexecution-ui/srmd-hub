// Server-only read for the admin-defined sidebar groups. Kept apart from the
// pure helpers in `sidebar-groups.ts` so client components can import those
// without pulling in the Supabase server client (next/headers).

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { SIDEBAR_GROUPS_KEY, parseSidebarGroups, type SidebarGroup } from '@/lib/sidebar-groups'
import { getShell } from '@/lib/shell'

/** Cached server read. Empty list = no grouping (sidebar stays flat). */
export const getSidebarGroups = cache(async (): Promise<SidebarGroup[]> => {
  try {
    const shell = await getShell()
    if (shell) return shell.sidebarGroups
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', SIDEBAR_GROUPS_KEY).maybeSingle()
    if (error || !data?.value) return []
    return parseSidebarGroups(data.value)
  } catch {
    return []
  }
})
