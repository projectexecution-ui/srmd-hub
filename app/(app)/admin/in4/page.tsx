import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { in4Config, in4MissingVars } from '@/lib/in4/db'
import { readLastSync } from '@/lib/in4/sync'
import { FEEDS, FEED_META, readFeedModes, readLastFeedSync, type Feed } from '@/lib/in4/feeds'
import type { ComparisonSummary } from '@/lib/in4/compare'
import { In4SyncClient, type FeedRow, type LinkRow, type BphOption } from './client'

export const dynamic = 'force-dynamic'

// Every IN4 feed on one screen: is IN4 connected, when did each feed last run,
// how close is it to the Excel it replaces, and the switch that makes the sync
// the source instead of the upload. Below it, the one mapping the budget feed
// needs — which IN4 sub-project is which Budget-Hub project.
export default async function In4AdminPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const supabase = await createClient()

  const [modes, budgetLast, runsRes, linksRes, spRes, stateRes] = await Promise.all([
    readFeedModes(supabase),
    readLastSync(supabase),
    supabase.from('in4_sync_runs').select('id, feed, started_at, finished_at, trigger, mode, ok, error, rows_read, compared').order('id', { ascending: false }).limit(60),
    supabase.from('in4_subproject_links').select('subproject_id, bph_project_id, source, confirmed_at'),
    supabase.from('in4_subprojects').select('id, name, ex_code, is_active, project_id').order('name'),
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
  ])
  const lasts = await Promise.all(FEEDS.map(f => f === 'budget' ? null : readLastFeedSync(supabase, f)))

  type Run = { id: number; feed: string; started_at: string; finished_at: string | null; trigger: string; mode: string; ok: boolean | null; error: string | null; rows_read: number | null; compared: unknown }
  const runs = (runsRes.data ?? []) as Run[]
  const lastRunOf = (feed: Feed) => runs.find(r => (r.feed ?? 'budget') === feed) ?? null

  const feeds: FeedRow[] = FEEDS.map((feed, i) => {
    const run = lastRunOf(feed)
    const last = feed === 'budget'
      ? (budgetLast ? { at: budgetLast.at, ok: budgetLast.ok, error: budgetLast.error, summary: budgetLast.ok ? `${budgetLast.subprojects ?? 0} sub-projects · ${budgetLast.linked ?? 0} linked${typeof budgetLast.exact === 'number' && budgetLast.figures ? ` · ${Math.round((budgetLast.exact / budgetLast.figures) * 100)}% of figures match the last upload` : ''}` : undefined } : null)
      : lasts[i]
    return {
      feed, label: FEED_META[feed].label, replaces: FEED_META[feed].replaces, page: FEED_META[feed].page, source: FEED_META[feed].source,
      mode: modes[feed],
      last: last ? { at: last.at, ok: last.ok, error: last.error ?? null, summary: last.summary ?? null } : null,
      lastRun: run ? { id: run.id, startedAt: run.started_at, trigger: run.trigger, mode: run.mode, ok: !!run.ok, error: run.error, rows: run.rows_read } : null,
      comparison: run?.ok ? run.compared : null,
    }
  })
  const budgetComparison = (lastRunOf('budget')?.compared ?? null) as ComparisonSummary | null

  type P = { id: string; name: string; type?: string; data?: { fileName?: string } | null }
  const projects = (((stateRes.data?.state as { projects?: P[] } | null)?.projects) ?? []).filter(p => p.type !== 'group')
  const bphOptions: BphOption[] = projects.map(p => ({ id: p.id, name: p.name, fileName: p.data?.fileName ?? null }))
  const linkByBph = new Map((linksRes.data ?? []).map(l => [l.bph_project_id as string, l]))
  const linkBySp = new Map((linksRes.data ?? []).map(l => [l.subproject_id as number, l]))
  const rows: LinkRow[] = ((spRes.data ?? []) as Array<{ id: number; name: string; ex_code: string | null; is_active: boolean }>)
    .filter(s => s.is_active)
    .map(s => {
      const l = linkBySp.get(s.id)
      return { subprojectId: s.id, name: s.name, exCode: s.ex_code, bphProjectId: (l?.bph_project_id as string | undefined) ?? null, source: (l?.source as string | undefined) ?? null }
    })
    .sort((a, b) => (a.bphProjectId ? 0 : 1) - (b.bphProjectId ? 0 : 1) || a.name.localeCompare(b.name))
  const unlinkedBph = bphOptions.filter(p => !linkByBph.has(p.id))

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="IN4 live sync"
        back="/admin"
        subtitle="Every IN4 report the hub used to take as an Excel upload, read from IN4's database twice a day. Shadow mode compares it with your last upload; live mode makes it the upload."
      />
      <In4SyncClient
        configured={!!in4Config()}
        missingVars={in4MissingVars()}
        feeds={feeds}
        budgetComparison={budgetComparison}
        rows={rows}
        bphOptions={bphOptions}
        unlinkedBph={unlinkedBph}
      />
    </div>
  )
}
