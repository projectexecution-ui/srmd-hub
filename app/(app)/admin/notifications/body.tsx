import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { ALL_ROLES } from '@/lib/types'
import { personName } from '@/lib/utils'
import NotificationRulesClient, { type NotificationScheduleRow } from './NotificationRulesClient'
import SelfManageAdmin, { type SelfManageUser } from './SelfManageAdmin'

export interface NotificationRuleRow {
  scope: 'global' | 'role'
  scope_key: string
  event_type: string
  channel: string
  enabled: boolean
}

/**
 * Instant alerts — the Messages door's second tab (B1): each alert on or off
 * per channel and role, and who may manage their own. The delivery and job
 * health strips that used to sit above this moved to the Job health tab. The
 * gate is the door's.
 */
export async function AlertsBody() {
  const [profile, roleLabels] = await Promise.all([getMyProfile(), getRoleLabels()])
  const supabase = await createClient()
  const [{ data: rules }, { data: schedules }, { data: userRows }, { data: grantRows }] = await Promise.all([
    supabase.from('notification_rules').select('scope, scope_key, event_type, channel, enabled'),
    supabase.from('notification_schedule').select('scope, scope_key, event_type, mode'),
    supabase.from('profiles').select('id, full_name, name, email, role').eq('is_active', true),
    supabase.from('notification_self_manage').select('user_id'),
  ])

  // Non-admin active people (admins always self-manage, so they're not listed).
  const granted = new Set((grantRows ?? []).map(g => (g as { user_id: string }).user_id))
  type ProfRow = { id: string; full_name: string | null; name: string | null; email: string | null; role: string }
  const selfManageUsers: SelfManageUser[] = ((userRows ?? []) as ProfRow[])
    .filter(u => u.role !== 'admin')
    .map(u => ({ id: u.id, name: personName(u.full_name, u.name, u.email), email: u.email, role: u.role, granted: granted.has(u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-4">
      <NotificationRulesClient
        embedded
        initialRules={(rules ?? []) as NotificationRuleRow[]}
        initialSchedules={(schedules ?? []) as NotificationScheduleRow[]}
        roles={ALL_ROLES}
        roleLabels={roleLabels}
        currentUserId={profile!.id}
      />
      <SelfManageAdmin users={selfManageUsers} currentUserId={profile!.id} />
    </div>
  )
}
