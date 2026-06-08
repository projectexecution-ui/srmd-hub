import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { ALL_ROLES } from '@/lib/types'
import NotificationRulesClient from './NotificationRulesClient'

export const dynamic = 'force-dynamic'

export interface NotificationRuleRow {
  scope: 'global' | 'role'
  scope_key: string
  event_type: string
  channel: string
  enabled: boolean
}

export default async function AdminNotificationsPage() {
  const [profile, portalOwner, roleLabels] = await Promise.all([
    getMyProfile(),
    isPortalOwner(),
    getRoleLabels(),
  ])
  // Admins + Portal Owners only (portal-wide policy).
  if (!(portalOwner || profile?.role === 'admin')) redirect('/admin')

  const supabase = await createClient()
  const { data: rules } = await supabase
    .from('notification_rules')
    .select('scope, scope_key, event_type, channel, enabled')

  return (
    <NotificationRulesClient
      initialRules={(rules ?? []) as NotificationRuleRow[]}
      roles={ALL_ROLES}
      roleLabels={roleLabels}
      currentUserId={profile!.id}
    />
  )
}
