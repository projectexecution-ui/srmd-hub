import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { findTab, PROJECT_TABS, tabHref } from '@/lib/revamp/tabs'
import { Hammer, ArrowRight } from 'lucide-react'
import ProjectSchedulePage from '@/app/(app)/schedule/[id]/page'
import { ApprovalsTab, StoresTab, JmrTab } from '../tabs'
import { OverviewTab } from '../OverviewTab'
import { ReportsTab } from '../ReportsTab'
import { ProcurementTab, DiscussionsTab } from '../MoreTabs'

export const dynamic = 'force-dynamic'

/**
 * One catch-all for every tab under the cockpit, so the tab list in
 * lib/revamp/tabs.ts stays the single source of truth — adding a tab there
 * makes it appear and route without a new folder.
 *
 * Built tabs render the EXISTING live page component. Nothing about the
 * Internal Estimate is re-implemented: the revamp is navigation, not new
 * arithmetic, and re-writing that table would mean re-arguing every figure.
 */
export default async function ProjectTabPage({
  params, searchParams,
}: {
  params: Promise<{ id: string; rest: string[] }>
  searchParams: Promise<{ focus_disc?: string; focus_sub?: string; ws?: string }>
}) {
  await requirePermission('cost-control', 'view')
  const { id, rest } = await params
  const slug = rest?.[0] ?? ''
  const tab = findTab(slug)
  if (!tab || slug === '') notFound()

  if (slug === 'overview')    return <OverviewTab projectId={id} />
  if (slug === 'reports')     return <ReportsTab projectId={id} />
  if (slug === 'approvals')   return <ApprovalsTab projectId={id} />
  if (slug === 'procurement') return <ProcurementTab projectId={id} />
  if (slug === 'discussions') return <DiscussionsTab projectId={id} />
  if (slug === 'stores')    return <StoresTab projectId={id} />
  if (slug === 'jmr')       return <JmrTab projectId={id} />

  if (slug === 'schedule') {
    // The existing per-project schedule page, whole, inside the cockpit.
    return <ProjectSchedulePage params={Promise.resolve({ id })} />
  }

  if (slug === 'setup') {
    // Setup already exists and is good; don't fork it.
    redirect(`/cost-control/projects/${id}/setup`)
  }

  return <NotBuiltYet projectId={id} label={tab.label} hint={tab.hint} />
}

/** Aksha's "honest tabs" rule: a section that does not exist says what it will
 *  hold and where that work happens today — never a blank screen. */
function NotBuiltYet({ projectId, label, hint }: { projectId: string; label: string; hint: string }) {
  const builtElsewhere = PROJECT_TABS.filter(t => t.built && t.slug !== '')

  return (
    <div className="max-w-xl mx-auto text-center py-12 px-4">
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 border border-amber-200 mb-3">
        <Hammer className="h-5 w-5 text-amber-700" />
      </div>
      <h2 className="text-lg font-bold text-gray-900">{label} — not built yet</h2>
      <p className="text-sm text-gray-500 mt-1.5">{hint}</p>
      <p className="text-xs text-gray-400 mt-3">
        This tab is part of the revamp and is coming. Nothing is broken — it simply
        has not been written yet, and it is shown here so the plan is visible rather
        than hidden.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {builtElsewhere.map(t => (
          <Link
            key={t.slug}
            href={tabHref(projectId, t)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 min-h-[44px]"
          >
            Go to {t.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}
