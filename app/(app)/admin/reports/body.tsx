import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { loadRoof } from '@/lib/notifications/roof'
import { REPORT_JOB, notificationTypeFor } from '@/lib/notifications/report-jobs'
import { ReportsClient, type ReportRow, type MatrixUser, type MuteRow } from './ReportsClient'

/**
 * Scheduled reports, and the mute list — two tabs of the Messages door (B1),
 * one loader. Aksha, 10 Sep 2026: "for Admin the weekly reports — make
 * something which Admin can control all the data in one place … users who
 * will get what I should be able to decide — if this can be made like the
 * Permission Matrix."
 *
 * `section` picks which half renders: the scheduled-report table (channels ·
 * recipients · last sent · send now) or the people × messages mute matrix. A
 * mute is a user-scope row in notification_rules, read by
 * notification_allowed() before the role and global rules, so it holds for
 * every channel and every sender. The gate is the door's.
 */
export async function ReportsBody({ section }: { section: 'reports' | 'mute' }) {
  const supabase = await createClient()
  // notifications and their deliveries are readable only by their own recipient,
  // so "last sent" and "ever by Telegram" need the service key to see everyone's.
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const history = svcUrl && svcKey ? createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } }) : supabase

  const [{ rows }, labels, usersRes, mutesRes] = await Promise.all([
    loadRoof(),
    getModuleLabels(),
    supabase.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('role').order('full_name'),
    supabase.from('notification_rules').select('scope_key, event_type, channel, enabled').eq('scope', 'user'),
  ])

  // Last time each scheduled message actually went out — the newest notification of its type.
  const scheduled = rows.filter(r => r.message.kind === 'scheduled')
  const lastSent = new Map<string, string | null>()
  // Has this report ever produced a Telegram delivery? If not, nobody on its
  // list has linked Telegram, and the switch shows grey rather than a green lie.
  const telegramUsed = new Map<string, boolean>()
  if (section === 'reports') {
    await Promise.all(scheduled.map(async r => {
      const type = notificationTypeFor(r.message.key)
      const [{ data }, tg] = await Promise.all([
        history.from('notifications').select('created_at').eq('type', type).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        history.from('notifications').select('id, notification_deliveries!inner(channel)').eq('type', type).eq('notification_deliveries.channel', 'telegram').limit(1),
      ])
      lastSent.set(r.message.key, (data?.created_at as string | undefined) ?? null)
      telegramUsed.set(r.message.key, ((tg.data ?? []) as unknown[]).length > 0)
    }))
  }

  const reportRows: ReportRow[] = scheduled.map(r => ({
    key: r.message.key,
    label: r.message.label,
    moduleLabel: labelFor(labels, r.message.module),
    schedule: r.message.schedule ?? '',
    trigger: r.message.trigger,
    channels: r.message.channels,
    channelsOn: r.channelsOn,
    respectsRules: r.message.respectsRules,
    enabled: r.enabled,
    recipients: r.recipients,
    who: r.message.recipients.who,
    warning: r.warning,
    lastSent: lastSent.get(r.message.key) ?? null,
    telegramUsed: telegramUsed.get(r.message.key) ?? false,
    job: REPORT_JOB[r.message.key] ?? null,
    settingsHref: r.message.settingsHref,
  }))

  // Every message a person can be muted from — the ones that go through notify_user().
  const events = rows.filter(r => r.message.respectsRules).map(r => ({ key: r.message.key, label: r.message.label, kind: r.message.kind }))

  const users: MatrixUser[] = ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; role: string }>)
    .map(u => ({ id: u.id, name: u.full_name?.trim() || u.email || 'Unnamed', role: u.role }))
  const mutes: MuteRow[] = ((mutesRes.data ?? []) as Array<{ scope_key: string; event_type: string; channel: string; enabled: boolean }>)
    .filter(m => !m.enabled)
    .map(m => ({ userId: m.scope_key, event: m.event_type, channel: m.channel }))

  return <ReportsClient section={section} reports={reportRows} events={events} users={users} initialMutes={mutes} />
}
