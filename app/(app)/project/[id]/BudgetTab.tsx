import { createClient } from '@/lib/supabase/server'
import ProjectInternalEstimatePage from '@/app/(app)/cost-control/projects/[id]/page'
import { OrdersView } from './OrdersView'
import { GroupBudgetView } from './GroupBudgetView'

/**
 * Budget vs Actual (build order §2) — two views behind the sub-tab pills.
 *
 *   0  Category / sub-category wise   CT Hub's Internal Estimate — the live page
 *   1  Category — WO/PO wise          the orders tree, live from IN4
 *
 * A third pill, "CT wise" (a flat IN4 sub-project roll-up), was removed on
 * 9 Sep 2026 — Aksha: of no use, engineers get their own view as on the live
 * site. Its loader (lib/revamp/budget-actual-data.ts) went with it.
 *
 * Pill 1 RENDERS THE LIVE INTERNAL ESTIMATE PAGE, it does not reproduce it.
 * Aksha, 6 Sept 2026: "The Budget should also be same as CT Hub".
 *
 * §2 was first built as its own table that recomputed the same figures. It
 * matched to the rupee and was tested against real NGH B rows, and it was
 * still the wrong shape for two reasons:
 *
 *  1. It looked different. People who read this screen every day had to learn
 *     a second layout for the same numbers.
 *  2. It leaked. The live page shows the Internal Estimate column ONLY to a
 *     Cost Control reviewer and hands everyone else a separate safe view
 *     without it — a rule enforced in code, not by the permission matrix. The
 *     replacement table had no such gate while the tab was open on
 *     `cost-control` view, which all eight roles hold. The [IB…] baseline was
 *     therefore reachable by engineers, viewers and site staff.
 *
 * Rendering the live component fixes both at once, and settles a third thing:
 * there is no longer any figure to reconcile, because the tab and the Cost
 * Control page are the same code.
 *
 * `in_cockpit=1` is what stops that page bouncing back to this one on the
 * trial deployment, where every route into a project redirects here.
 */
export async function BudgetTab({ projectId, view }: { projectId: string; view: number }) {
  if (view === 1) return <OrdersView projectId={projectId} />
  // A grouping anchor (NGH, P2, VV) holds no disciplines of its own — its
  // Internal Estimate is empty, which reads as broken. When the project has
  // sub-projects, the landing rolls them up instead. Leaf projects fall through
  // to the live Internal Estimate exactly as before.
  if (await hasSubProjects(projectId)) return <GroupBudgetView projectId={projectId} />
  return (
    <ProjectInternalEstimatePage
      params={Promise.resolve({ id: projectId })}
      searchParams={Promise.resolve({ in_cockpit: '1' })}
    />
  )
}

/** True when this project is a parent of one or more live sub-projects. One
 *  cheap head-count, so a leaf pays only a COUNT before its estimate loads. */
async function hasSubProjects(projectId: string): Promise<boolean> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('parent_project_id', projectId)
    .is('archived_at', null)
  return (count ?? 0) > 0
}
