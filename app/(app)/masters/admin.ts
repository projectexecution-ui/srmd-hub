import { getMyPermissions, can, getMyProfile } from '@/lib/auth'

/** Whether the signed-in person may make the two writes the Masters screens
 *  offer — pin a hub record to an IN4 record, copy an IN4 area, decide a
 *  project name. Reading is for everyone with cost-control; deciding is for
 *  an admin or the Portal Owner, the same gate the server actions enforce. */
export async function canEditMasters(): Promise<boolean> {
  const [perms, profile] = await Promise.all([getMyPermissions(), getMyProfile()])
  return can(perms, 'admin-settings', 'view') && !!profile && (profile.role === 'admin' || !!profile.is_portal_owner)
}
