// Server side of the name layer: read the cthub_names rows once per request,
// and decide who may hold the pencil. The pure resolution lives in lib/names.ts.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { nameIndex, type NameRow } from './names'

/** Every scoped name, indexed. Cached per request — the table is small (it is
 *  the handful of things people chose to rename, not a catalogue). A read that
 *  fails yields an empty index: screens then show IN4's text, never an error. */
export const loadNameIndex = cache(async (): Promise<Map<string, NameRow[]>> => {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('cthub_names')
      .select('kind, key, scope, scope_id, display_name, note, set_by, set_at')
    return nameIndex((data ?? []) as NameRow[])
  } catch {
    return new Map()
  }
})

/** Admin, Portal Owner, or a user granted through app_settings.cthub_namers
 *  (Parimal, per Aksha 10 Sep 2026). The RPC re-checks the same rule, so this
 *  only decides whether the pencil is drawn. */
export const canName = cache(async (): Promise<boolean> => {
  const profile = await getMyProfile()
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (await isPortalOwner()) return true
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'cthub_namers').maybeSingle()
    return ((data?.value as string | null) ?? '').includes(profile.id)
  } catch {
    return false
  }
})
