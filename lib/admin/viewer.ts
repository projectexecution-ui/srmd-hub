// Who is looking at Admin, in the five facts the door gates need.
// Server-only: reads the profile and the permission matrix once per request.

import { getMyProfile, getMyPermissions, isPortalOwner, can } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { GRANT_KEYS } from '@/lib/revamp/people-grants'
import type { Viewer } from './doors'

export interface AdminViewer extends Viewer {
  userId: string | null
  role: string | null
}

export async function adminViewer(): Promise<AdminViewer> {
  const [profile, owner, perms] = await Promise.all([getMyProfile(), isPortalOwner(), getMyPermissions()])
  const admin = owner || profile?.role === 'admin'
  // The one named list a door reads: People › Powers › "Bring in from IN4".
  let intake = admin
  if (!intake && profile) {
    try {
      const supabase = await createClient()
      const { data } = await supabase.from('app_settings').select('value').eq('key', GRANT_KEYS.intake).maybeSingle()
      intake = ((data?.value as string | null) ?? '').split(',').map(s => s.trim()).includes(profile.id)
    } catch { intake = false }
  }
  return {
    admin,
    owner,
    settingsView: admin || can(perms, 'admin-settings', 'view'),
    ccAdmin: admin || can(perms, 'cost-control', 'admin'),
    ccView: admin || can(perms, 'cost-control', 'view'),
    intake,
    userId: profile?.id ?? null,
    role: profile?.role ?? null,
  }
}
