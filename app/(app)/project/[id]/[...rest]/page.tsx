import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { findTab, PROJECT_TABS, tabHref } from '@/lib/revamp/tabs'
import { Hammer, ArrowRight } from 'lucide-react'
import { OverviewTab } from '../OverviewTab'
import { ReportsTab } from '../ReportsTab'
import { ProcurementTab, DiscussionsTab } from '../MoreTabs'
import ProjectSetupPage from '@/app/(app)/cost-control/projects/[id]/setup/page'

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
  params,
}: {
  params: Promise<{ id: string; rest: string[] }>
}) {
  await requirePermission('cost-control', 'view')
  const { id, rest } = await params
  const slug = rest?.[0] ?? ''
  const tab = findTab(slug)
  if (!tab || slug === '') notFound()

  if (slug === 'overview')    return <OverviewTab projectId={id} />
  if (slug === 'reports')     return <ReportsTab projectId={id} />
  if (slug === 'procurement') return <ProcurementTab projectId={id} />
  if (slug === 'discussions') return <DiscussionsTab projectId={id} />

  if (slug === 'setup') {
    // The existing Setup screen, rendered INSIDE the cockpit — not a redirect.
    // Redirecting threw you out of the project: the tab bar vanished and
    // getting back meant the browser's Back button. Every other tab stays in
    // the shell, and Setup is where you go mid-task (fix an area, add a
    // category) and then carry on, so leaving is exactly wrong here.
    return <ProjectSetupPage params={Promise.resolve({ id })} />
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
