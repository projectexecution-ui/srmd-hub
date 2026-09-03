import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { findTab, PROJECT_TABS, tabHref, type ProjectTab } from '@/lib/revamp/tabs'
import { Hammer, ArrowRight, Database } from 'lucide-react'
import { OverviewTab } from '../OverviewTab'
import { ReportsTab } from '../ReportsTab'
import { ProcurementTab, DiscussionsTab } from '../MoreTabs'
import { ApprovalsTab, JmrTab, StoresTab } from '../tabs'
import { ScBudgetsTab } from '../ScBudgetsTab'
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
  const { id, rest } = await params
  const slug = rest?.[0] ?? ''
  const tab = findTab(slug)
  if (!tab || slug === '') notFound()

  // Gate on the TAB's own module, not on cost-control. Gating every tab on
  // cost-control (which all eight roles hold) turned the cockpit into a way
  // round the permission matrix: /project/<id>/reports served contractor and
  // supplier billing to the two contractor accounts and the two engineers,
  // none of whom have contractor-report, and /project/<id>/procurement served
  // the tracker to everyone. Same slug the standalone screen uses, so the two
  // can never drift apart.
  await requirePermission(tab.permissionSlug, 'view')

  // Some tabs need more than the module permission. Setup's own page redirects
  // a non-reviewer to /cost-control, which from inside the cockpit reads as
  // being thrown out of the project for no stated reason — so don't let them
  // arrive there at all. The strip hides it for the same reason.
  if (tab.reviewerOnly && !(await checkIsCcReviewer())) notFound()

  if (slug === 'overview')    return <OverviewTab projectId={id} />
  if (slug === 'reports')     return <ReportsTab projectId={id} />
  if (slug === 'discussions') return <DiscussionsTab projectId={id} />

  // Indents and WO/POs are two pages on the mind map and two views of the one
  // tracker — its `global` snapshot holds the indents, its `po` snapshot the
  // purchase orders. Same component, told which side to show.
  if (slug === 'procurement') return <ProcurementTab projectId={id} />
  if (slug === 'wo-po')       return <ProcurementTab projectId={id} />

  // Restored from the parked set — all three are on the mind map and all three
  // were already built and tested; only their row in PROJECT_TABS was removed.
  if (slug === 'approvals')   return <ApprovalsTab projectId={id} />
  if (slug === 'jmr')         return <JmrTab projectId={id} />
  if (slug === 'material')    return <StoresTab projectId={id} />

  // Confidentiality is the route guard above, on budget-vs-actual-v2 — admin
  // and head only. The component does not re-check, so there is one gate.
  if (slug === 'sc-budgets')  return <ScBudgetsTab projectId={id} />

  if (slug === 'setup') {
    // The existing Setup screen, rendered INSIDE the cockpit — not a redirect.
    // Redirecting threw you out of the project: the tab bar vanished and
    // getting back meant the browser's Back button. Every other tab stays in
    // the shell, and Setup is where you go mid-task (fix an area, add a
    // category) and then carry on, so leaving is exactly wrong here.
    return <ProjectSetupPage params={Promise.resolve({ id })} />
  }

  return <NotBuiltYet projectId={id} tab={tab} />
}

/** Aksha's "honest tabs" rule: a section that does not exist says what it will
 *  hold and where that work happens today — never a blank screen. */
function NotBuiltYet({ projectId, tab }: { projectId: string; tab: ProjectTab }) {
  const { label, hint, todayHref, blockedBy } = tab
  const builtElsewhere = PROJECT_TABS.filter(t => t.built && t.slug !== '')

  return (
    <div className="max-w-xl mx-auto text-center py-12 px-4">
      <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border mb-3 ${
        blockedBy ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'
      }`}>
        {blockedBy
          ? <Database className="h-5 w-5 text-rose-700" />
          : <Hammer className="h-5 w-5 text-amber-700" />}
      </div>
      <h2 className="text-lg font-bold text-gray-900">
        {label} — {blockedBy ? 'waiting on data' : 'coming soon'}
      </h2>
      <p className="text-sm text-gray-500 mt-1.5">{hint}</p>

      {/* "Not written yet" and "cannot be written yet" need different things
          from the reader, so they must not read the same. */}
      {blockedBy ? (
        <p className="text-xs text-rose-900 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-3 text-left">
          <b>This one is not waiting on development.</b> {blockedBy}
        </p>
      ) : (
        <p className="text-xs text-gray-400 mt-3">
          One of the pages from the plan. Nothing is broken — it simply has not been
          written yet, and it is shown greyed so the plan is visible rather than hidden.
        </p>
      )}

      {/* Where this work happens TODAY. Without it a greyed tab is a dead end,
          and Site entries / Schedule both already have a working screen. */}
      {todayHref && (
        <Link
          href={todayHref}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 min-h-[44px]"
        >
          Open {label} as it works today <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}

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
