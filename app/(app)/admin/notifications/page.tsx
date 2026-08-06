import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { ALL_ROLES } from '@/lib/types'
import NotificationRulesClient, { type NotificationScheduleRow } from './NotificationRulesClient'
import SelfManageAdmin, { type SelfManageUser } from './SelfManageAdmin'
import { EmailHealthStrip, type DeliveryHealth } from './EmailHealthStrip'
import { CronHealthStrip } from './CronHealthStrip'

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
  const [{ data: rules }, { data: schedules }, { data: userRows }, { data: grantRows }, { data: healthData }, { data: cronRows }] = await Promise.all([
    supabase.from('notification_rules').select('scope, scope_key, event_type, channel, enabled'),
    supabase.from('notification_schedule').select('scope, scope_key, event_type, mode'),
    supabase.from('profiles').select('id, full_name, name, email, role').eq('is_active', true),
    supabase.from('notification_self_manage').select('user_id'),
    supabase.rpc('email_delivery_health'),
    supabase.from('app_settings').select('key, value').in('key', ['cron_heartbeat_am', 'cron_heartbeat_pm']),
  ])
  const cronBy = new Map(((cronRows ?? []) as { key: string; value: string }[]).map(r => [r.key, r.value]))
  const cronAmAt = cronBy.get('cron_heartbeat_am') ?? null
  const cronPmAt = cronBy.get('cron_heartbeat_pm') ?? null
  // Build defensively: tolerate the pre-migration flat shape (no email/push
  // keys) so the strip never crashes in the deploy→migration window.
  const emptyChannel = { counts: {}, stuck: 0, recent: [] }
  const raw = (healthData ?? null) as Partial<DeliveryHealth> | null
  const health: DeliveryHealth = { email: raw?.email ?? emptyChannel, push: raw?.push ?? emptyChannel }

  // Non-admin active people (admins always self-manage, so they're not listed).
  const granted = new Set((grantRows ?? []).map(g => (g as { user_id: string }).user_id))
  type ProfRow = { id: string; full_name: string | null; name: string | null; email: string | null; role: string }
  const selfManageUsers: SelfManageUser[] = ((userRows ?? []) as ProfRow[])
    .filter(u => u.role !== 'admin')
    .map(u => ({ id: u.id, name: u.full_name ?? u.name ?? '(unnamed)', email: u.email, role: u.role, granted: granted.has(u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-4">
      <div className="pt-2"><EmailHealthStrip health={health} /></div>
      <CronHealthStrip amAt={cronAmAt} pmAt={cronPmAt} nowMs={Date.now()} />
      <NotificationRulesClient
        initialRules={(rules ?? []) as NotificationRuleRow[]}
        initialSchedules={(schedules ?? []) as NotificationScheduleRow[]}
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
