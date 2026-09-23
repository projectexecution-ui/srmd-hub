// Fetch what the Today strip and the console rail need; lib/admin/today.ts
// and lib/admin/rail.ts do the deciding.

import { createClient } from '@/lib/supabase/server'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'
import { loadHealth } from '@/lib/revamp/admin-health'
import { FEEDS, FEED_META } from '@/lib/in4/feeds'
import { intakeSummary } from '@/lib/in4/intake.server'
import { REPORT_JOB } from '@/lib/notifications/report-jobs'
import { MODULES } from '@/lib/modules'
import { todayRows, UNFINISHED_AFTER_MS, type FeedState, type TodayRow } from './today'
import type { RailCounts } from './rail'

export interface TodayBundle {
  rows: TodayRow[]
  counts: RailCounts
}

/** One pass for the console: the Today rows and every count the rail shows. */
export async function loadTodayBundle(opts: { admin: boolean }): Promise<TodayBundle> {
  const supabase = await createClient()
  const nowMs = Date.now()
  const [accessRes, allowedRes, emailRes, delRes, runsRes, ledgerRes, findings, intake, peopleRes, projRes, headsRes, visRes] = await Promise.all([
    opts.admin ? supabase.from('profiles').select('email, is_active, access_state').eq('is_active', false).is('access_state', null) : Promise.resolve({ data: [] }),
    opts.admin ? supabase.from('allowed_emails').select('email') : Promise.resolve({ data: [] }),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    opts.admin ? supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
    // Newest first; the first row per feed is its latest run.
    supabase.from('in4_sync_runs').select('feed, started_at, ok, error').order('id', { ascending: false }).limit(80),
    supabase.from('app_settings').select('value').eq('key', 'cron_ledger').maybeSingle(),
    loadHealth(),
    intakeSummary(supabase).catch(() => ({ waiting: 0, arrivedRecently: 0 })),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    // Groups hold no head of their own (H1); only projects and sub-projects count.
    supabase.from('projects').select('id').is('archived_at', null).neq('project_type', 'group'),
    supabase.from('cc_project_approvers').select('project_id').eq('role', 'head'),
    supabase.from('module_visibility').select('slug, enabled'),
  ])

  const adminEmail = (emailRes.data?.value as string | null) ?? 'projectexecution@construction.srmd.org'
  const allowed = allowedEmailSet((allowedRes.data ?? []) as Array<{ email: string }>)
  const pendingAccess = ((accessRes.data ?? []) as Array<{ email: string; is_active: boolean; access_state: string | null }>)
    .filter(p => isPendingAccessRequest(p, allowed, adminEmail)).length

  const seen = new Set<string>()
  const feeds: FeedState[] = []
  for (const r of (runsRes.data ?? []) as Array<{ feed: string | null; started_at: string; ok: boolean | null; error: string | null }>) {
    const feed = r.feed ?? 'budget'
    if (seen.has(feed)) continue
    seen.add(feed)
    if (!(FEEDS as string[]).includes(feed)) continue
    feeds.push({ feed, label: FEED_META[feed as keyof typeof FEED_META].label, startedAt: r.started_at, ok: r.ok, error: r.error })
  }

  let ledger: Record<string, string> | null = null
  try {
    const parsed = JSON.parse((ledgerRes.data?.value as string | undefined) ?? 'null')
    if (parsed && typeof parsed === 'object') ledger = parsed as Record<string, string>
  } catch { ledger = null }

  const pendingDeletes = (delRes as { count: number | null }).count ?? 0
  const rows = todayRows({ nowMs, pendingAccess, pendingDeletes, feeds, ledger, findings, intake })

  const projectIds = ((projRes.data ?? []) as Array<{ id: string }>).map(p => p.id)
  const withHead = new Set(((headsRes.data ?? []) as Array<{ project_id: string }>).map(r => r.project_id))
  const overrides = new Map(((visRes.data ?? []) as Array<{ slug: string; enabled: boolean }>).map(r => [r.slug, r.enabled]))
  const modulesOn = MODULES.filter(m => (overrides.has(m.slug) ? !!overrides.get(m.slug) : true)).length

  const counts: RailCounts = {
    people: peopleRes.count ?? 0,
    pendingAccess,
    projects: projectIds.length,
    projectsNeedHead: projectIds.filter(id => !withHead.has(id)).length,
    scheduled: Object.keys(REPORT_JOB).length,
    messagesSilent: findings.filter(f => f.id === 'silent-messages').length > 0
      ? Number((findings.find(f => f.id === 'silent-messages')?.title ?? '0').split(' ')[0]) || 1
      : 0,
    feeds: FEEDS.length,
    feedsFailing: feeds.filter(f => f.ok === false).length,
    feedsUnfinished: feeds.filter(f => f.ok === null && nowMs - Date.parse(f.startedAt) > UNFINISHED_AFTER_MS).length,
    intakeWaiting: intake.waiting,
    modulesOn,
    modulesTotal: MODULES.length,
  }
  return { rows, counts }
}

/** The Today rows alone. */
export async function loadToday(opts: { admin: boolean }): Promise<TodayRow[]> {
  return (await loadTodayBundle(opts)).rows
}
