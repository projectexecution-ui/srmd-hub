import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyProfile, isPortalOwner } from '@/lib/auth'

/**
 * May the current user open + change their OWN notification settings?
 * Admins + Portal Owners always can. Everyone else only if an admin has
 * granted them self-management (a row in public.notification_self_manage).
 * Default is OFF — notifications are the admin's to set until delegated.
 */
export async function canManageOwnNotifications(): Promise<boolean> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (owner || profile?.role === 'admin') return true
  const user = await getMyUser()
  if (!user) return false
  const supabase = await createClient()
  const { data } = await supabase
    .from('notification_self_manage')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  return !!data
}
