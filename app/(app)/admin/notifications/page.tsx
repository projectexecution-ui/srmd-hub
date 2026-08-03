import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { ALL_ROLES } from '@/lib/types'
import NotificationRulesClient from './NotificationRulesClient'
import SelfManageAdmin, { type SelfManageUser } from './SelfManageAdmin'

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
  const [{ data: rules }, { data: userRows }, { data: grantRows }] = await Promise.all([
    supabase.from('notification_rules').select('scope, scope_key, event_type, channel, enabled'),
    supabase.from('profiles').select('id, full_name, name, email, role').eq('is_active', true),
    supabase.from('notification_self_manage').select('user_id'),
  ])

  // Non-admin active people (admins always self-manage, so they're not listed).
  const granted = new Set((grantRows ?? []).map(g => (g as { user_id: string }).user_id))
  type ProfRow = { id: string; full_name: string | null; name: string | null; email: string | null; role: string }
  const selfManageUsers: SelfManageUser[] = ((userRows ?? []) as ProfRow[])
    .filter(u => u.role !== 'admin')
    .map(u => ({ id: u.id, name: u.full_name ?? u.name ?? '(unnamed)', email: u.email, role: u.role, granted: granted.has(u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-4">
      <NotificationRulesClient
        initialRules={(rules ?? []) as NotificationRuleRow[]}
        roles={ALL_ROLES}
        roleLabels={roleLabels}
        currentUserId={profile!.id}
      />
      <div className="max-w-4xl mx-auto px-4 md:px-6">
        <SelfManageAdmin users={selfManageUsers} currentUserId={profile!.id} />
      </div>
    </div>
  )
}
