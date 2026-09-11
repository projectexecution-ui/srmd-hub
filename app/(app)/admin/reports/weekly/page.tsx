import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { getRoleLabels } from '@/lib/role-labels'
import { loadWeeklyReport } from '@/lib/weekly-report/load'
import { resolveRecipients, WEEKLY_EVENT } from '@/lib/weekly-report/config'
import { WeeklyClient, type WeeklyPageData } from './WeeklyClient'

export const dynamic = 'force-dynamic'

/**
 * The Monday report, all in one place (Aksha, 11 Sep 2026): what goes in it
 * and how it is grouped, which channels are on, who gets it, a preview of
 * this week's figures, and the buttons to send a test or send it now.
 */
export default async function WeeklyReportPage() {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) redirect('/admin')

  const supabase = await createClient()
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const reader = svcUrl && svcKey ? createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } }) : supabase

  const [loaded, usersRes, ovRes, rulesRes, lastRes, groupRes, roleLabels] = await Promise.all([
    loadWeeklyReport(reader),
    supabase.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('role').order('full_name'),
    supabase.from('user_module_roles').select('user_id, role').eq('module_slug', 'cost-control'),
    supabase.from('notification_rules').select('scope, scope_key, channel, enabled').eq('event_type', WEEKLY_EVENT),
    supabase.from('notifications').select('created_at').eq('type', WEEKLY_EVENT).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', 'telegram_reports_group_chat_id').maybeSingle(),
    getRoleLabels(),
  ])

  const labelOf = roleLabels as Record<string, { label?: string } | undefined>
  const ov = new Map(((ovRes.data ?? []) as Array<{ user_id: string; role: string }>).map(r => [r.user_id, r.role]))
  const people = ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; role: string }>)
    .filter(u => !/^anonymous$/i.test(u.full_name ?? ''))
    .map(u => ({ id: u.id, name: u.full_name?.trim() || u.email || 'Unnamed', roleLabel: labelOf[u.role]?.label ?? u.role, ccRole: ov.get(u.id) ?? u.role }))
  const recipients = resolveRecipients(loaded.cfg, people.map(p => ({ id: p.id, ccRole: p.ccRole, active: true })))

  const rules = (rulesRes.data ?? []) as Array<{ scope: string; scope_key: string; channel: string; enabled: boolean }>
  const globalOff = new Set(rules.filter(r => r.scope === 'global' && !r.enabled).map(r => r.channel))

  const data: WeeklyPageData = {
    cfg: loaded.cfg,
    lines: loaded.in4Lines,
    unplaced: loaded.unplaced,
    missing: loaded.missing,
    preview: loaded.result.groups.map(g => ({
      name: g.name, budget: g.budget, approved: g.approved, spent: g.spent,
      lines: g.projects.map(p => ({ name: p.name, budget: p.budget, approved: p.approved, spent: p.spent, deltaPaid: loaded.delta.byProject[p.name]?.paid ?? 0 })),
    })),
    totals: { ...loaded.result.totals, deltaPaid: loaded.delta.overall.paid },
    hasBaseline: loaded.delta.hasBaseline,
    prevSnapshotWeek: loaded.prevSnapshotWeek,
    budgetAsOf: loaded.freshness.budget,
    thisMonday: loaded.thisMonday,
    lastSent: (lastRes.data?.created_at as string | undefined) ?? null,
    channels: { in_app: !globalOff.has('in_app'), email: !globalOff.has('email'), web_push: !globalOff.has('web_push'), telegram: !globalOff.has('telegram') },
    groupConnected: !!groupRes.data?.value,
    people,
    recipients,
    recipientsChosen: loaded.cfg.recipients !== null,
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Weekly report"
        back="/admin/reports"
        subtitle="The Monday Budget vs Actual: what goes in, how it is grouped, which channels are on, who gets it."
      />
      <p className="text-[12px] text-gray-500">
        Every other report and its per-person mutes are on <Link href="/admin/reports" className="text-indigo-700 hover:underline">Messages</Link>. The IN4 figures themselves come from the live sync; this page only decides how they are shown and to whom.
      </p>
      <WeeklyClient data={data} />
    </div>
  )
}
