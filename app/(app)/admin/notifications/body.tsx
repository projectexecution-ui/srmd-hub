import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { getCcSettings } from '@/lib/cost-control/settings'
import { ALL_ROLES } from '@/lib/types'
import { personName } from '@/lib/utils'
import NotificationRulesClient, { type NotificationScheduleRow } from './NotificationRulesClient'
import SelfManageAdmin, { type SelfManageUser } from './SelfManageAdmin'
import { TelegramApprovalsCard } from './TelegramApprovalsCard'

export interface NotificationRuleRow {
  scope: 'global' | 'role'
  scope_key: string
  event_type: string
  channel: string
  enabled: boolean
}

/**
 * Instant alerts — the Messages door's second tab (B1): each alert on or off
 * per channel and role, the Telegram approval switches (moved here from
 * Internal Estimate settings on 23 Sep 2026, F5), and who may manage their
 * own. The delivery and job health strips moved to the Job health tab. The
 * gate is the door's.
 */
export async function AlertsBody() {
  const [profile, roleLabels, cc] = await Promise.all([getMyProfile(), getRoleLabels(), getCcSettings()])
  const supabase = await createClient()
  const [{ data: rules }, { data: schedules }, { data: userRows }, { data: grantRows }] = await Promise.all([
    supabase.from('notification_rules').select('scope, scope_key, event_type, channel, enabled'),
    supabase.from('notification_schedule').select('scope, scope_key, event_type, mode'),
    supabase.from('profiles').select('id, full_name, name, email, role').eq('is_active', true),
    supabase.from('notification_self_manage').select('user_id'),
  ])

  type ProfRow = { id: string; full_name: string | null; name: string | null; email: string | null; role: string }
  const people = (userRows ?? []) as ProfRow[]

  // Teammates who have connected Telegram — the ones a test card can reach.
  // notification_preferences is RLS'd to auth.uid(), so the SERVICE client is
  // the only way to see everyone's; the door has already gated this to admins.
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let connectedUsers: Array<{ id: string; name: string; role: string }> = []
  if (svcUrl && svcKey) {
    const svc = createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } })
    const { data: conn } = await svc.from('notification_preferences').select('user_id').eq('telegram', true).not('telegram_chat_id', 'is', null)
    const ids = new Set((conn ?? []).map(r => r.user_id as string))
    connectedUsers = people.filter(u => ids.has(u.id)).map(u => ({ id: u.id, name: personName(u.full_name, u.name, u.email), role: u.role }))
  }

  // Non-admin active people (admins always self-manage, so they're not listed).
  const granted = new Set((grantRows ?? []).map(g => (g as { user_id: string }).user_id))
  const selfManageUsers: SelfManageUser[] = people
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
      <TelegramApprovalsCard
        initial={{ telegram_approvals: cc.telegram_approvals, tg_trustee_digest: cc.tg_trustee_digest }}
        connectedUsers={connectedUsers}
      />
      <SelfManageAdmin users={selfManageUsers} currentUserId={profile!.id} />
    </div>
  )
}
