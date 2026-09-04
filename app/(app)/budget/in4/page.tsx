import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { in4Config } from '@/lib/in4/db'
import { readLastSync, IN4_LIVE_KEY } from '@/lib/in4/sync'
import type { ComparisonSummary } from '@/lib/in4/compare'
import { In4SyncClient, type LinkRow, type BphOption } from './client'

export const dynamic = 'force-dynamic'

// The IN4 budget sync, for the admin who owns the weekly upload: is it
// configured, when did it last run, how close is it to the last Excel, which
// IN4 sub-project is which Budget-Hub project, and the one switch that makes
// the sync the source instead of the upload.
export default async function In4SyncPage() {
  await requirePermission('budget-vs-actual', 'admin', '/budget')
  const supabase = await createClient()

  const [last, liveRow, runsRes, linksRes, spRes, stateRes] = await Promise.all([
    readLastSync(supabase),
    supabase.from('app_settings').select('value').eq('key', IN4_LIVE_KEY).maybeSingle(),
    supabase.from('in4_sync_runs').select('id, started_at, finished_at, trigger, mode, ok, error, linked, subprojects, wrote_budget_hub, compared').order('id', { ascending: false }).limit(1),
    supabase.from('in4_subproject_links').select('subproject_id, bph_project_id, source, confirmed_at'),
    supabase.from('in4_subprojects').select('id, name, ex_code, is_active, project_id').order('name'),
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
  ])

  const live = String(liveRow.data?.value ?? 'false') === 'true'
  const lastRun = runsRes.data?.[0] ?? null
  const comparison = (lastRun?.compared ?? null) as ComparisonSummary | null

  type P = { id: string; name: string; type?: string; parentId?: string | null; data?: { fileName?: string } | null }
  const projects = (((stateRes.data?.state as { projects?: P[] } | null)?.projects) ?? []).filter(p => p.type !== 'group')
  const bphOptions: BphOption[] = projects.map(p => ({ id: p.id, name: p.name, fileName: p.data?.fileName ?? null }))
  const linkByBph = new Map((linksRes.data ?? []).map(l => [l.bph_project_id as string, l]))
  const linkBySp = new Map((linksRes.data ?? []).map(l => [l.subproject_id as number, l]))

  // Rows: every IN4 sub-project that is active, with its current link (if any).
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
        back="/budget"
        subtitle="The SRMD Budget vs Expenses report, rebuilt from IN4's database twice a day. Shadow mode compares it with your last upload; live mode makes it the upload."
      />
      <In4SyncClient
        configured={!!in4Config()}
        live={live}
        last={last}
        lastRun={lastRun ? { id: lastRun.id as number, startedAt: lastRun.started_at as string, trigger: lastRun.trigger as string, mode: lastRun.mode as string, ok: !!lastRun.ok, error: (lastRun.error as string | null) ?? null } : null}
        comparison={comparison}
        rows={rows}
        bphOptions={bphOptions}
        unlinkedBph={unlinkedBph}
        mirrorCount={spRes.data?.length ?? 0}
      />
    </div>
  )
}
