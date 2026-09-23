// Fetch what the Today strip needs; lib/admin/today.ts does the deciding.

import { createClient } from '@/lib/supabase/server'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'
import { loadHealth } from '@/lib/revamp/admin-health'
import { FEEDS, FEED_META } from '@/lib/in4/feeds'
import { todayRows, type FeedState, type TodayRow } from './today'

export async function loadToday(opts: { admin: boolean }): Promise<TodayRow[]> {
  const supabase = await createClient()
  const [accessRes, allowedRes, emailRes, delRes, runsRes, ledgerRes, findings] = await Promise.all([
    opts.admin ? supabase.from('profiles').select('email, is_active, access_state').eq('is_active', false).is('access_state', null) : Promise.resolve({ data: [] }),
    opts.admin ? supabase.from('allowed_emails').select('email') : Promise.resolve({ data: [] }),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    opts.admin ? supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
    // Newest first; the first row per feed is its latest run.
    supabase.from('in4_sync_runs').select('feed, started_at, ok, error').order('id', { ascending: false }).limit(80),
    supabase.from('app_settings').select('value').eq('key', 'cron_ledger').maybeSingle(),
    loadHealth(),
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

  return todayRows({
    nowMs: Date.now(),
    pendingAccess,
    pendingDeletes: (delRes as { count: number | null }).count ?? 0,
    feeds,
    ledger,
    findings,
  })
}
