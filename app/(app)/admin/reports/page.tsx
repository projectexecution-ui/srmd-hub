import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { loadRoof } from '@/lib/notifications/roof'
import { REPORT_JOB, notificationTypeFor } from '@/lib/notifications/report-jobs'
import { ReportsClient, type ReportRow, type MatrixUser, type MuteRow } from './ReportsClient'

export const dynamic = 'force-dynamic'

/**
 * Reports & digests — one place for everything CT Hub sends on a schedule, and
 * who receives what.
 *
 * Aksha, 10 Sep 2026: "for Admin the weekly reports — make something which
 * Admin can control all the data in one place … users who will get what I
 * should be able to decide — if this can be made like the Permission Matrix."
 *
 * Top: each scheduled report with its channels (on/off), recipients as worked
 * out today, when it last went out, and Send now. Below: the matrix — every
 * person against every message, one tap mutes or unmutes. A mute is a
 * user-scope row in notification_rules, read by notification_allowed() before
 * the role and global rules, so it holds for every channel and every sender.
 */
export default async function ReportsPage() {
  await requirePermission('admin-settings', 'view')
  const supabase = await createClient()

  const [{ rows }, labels, usersRes, mutesRes] = await Promise.all([
    loadRoof(),
    getModuleLabels(),
    supabase.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('role').order('full_name'),
    supabase.from('notification_rules').select('scope_key, event_type, channel, enabled').eq('scope', 'user'),
  ])

  // Last time each scheduled message actually went out — the newest notification of its type.
  const scheduled = rows.filter(r => r.message.kind === 'scheduled')
  const lastSent = new Map<string, string | null>()
  await Promise.all(scheduled.map(async r => {
    const type = notificationTypeFor(r.message.key)
    const { data } = await supabase.from('notifications').select('created_at').eq('type', type).order('created_at', { ascending: false }).limit(1).maybeSingle()
    lastSent.set(r.message.key, (data?.created_at as string | undefined) ?? null)
  }))

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

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Messages"
        back="/admin"
        subtitle="Every report and digest the hub sends: on or off per channel, who gets it, when it last went, send it now. Below, mute a person from any of them."
      />
      <p className="text-[12px] text-gray-500">
        Instant alerts (approvals, mentions, IN4 verify) are switched on <Link href="/admin/notifications" className="text-indigo-700 hover:underline">Instant alerts</Link>; every message with its address list is on <Link href="/admin/email" className="text-indigo-700 hover:underline">Every message, who gets it</Link>. Who gets the bills digest is set per person on <Link href="/admin/people" className="text-indigo-700 hover:underline">People</Link>.
      </p>
      <ReportsClient reports={reportRows} events={events} users={users} initialMutes={mutes} />
    </div>
  )
}
