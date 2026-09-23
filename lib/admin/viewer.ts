// Who is looking at Admin, in the five facts the door gates need.
// Server-only: reads the profile and the permission matrix once per request.

import { getMyProfile, getMyPermissions, isPortalOwner, can } from '@/lib/auth'
import type { Viewer } from './doors'

export interface AdminViewer extends Viewer {
  userId: string | null
  role: string | null
}

export async function adminViewer(): Promise<AdminViewer> {
  const [profile, owner, perms] = await Promise.all([getMyProfile(), isPortalOwner(), getMyPermissions()])
  const admin = owner || profile?.role === 'admin'
  return {
    admin,
    owner,
    settingsView: admin || can(perms, 'admin-settings', 'view'),
    ccAdmin: admin || can(perms, 'cost-control', 'admin'),
    ccView: admin || can(perms, 'cost-control', 'view'),
    userId: profile?.id ?? null,
    role: profile?.role ?? null,
  }
}
