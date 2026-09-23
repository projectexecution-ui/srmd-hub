import { createClient } from '@/lib/supabase/server'
import ProjectInternalEstimatePage from '@/app/(app)/cost-control/projects/[id]/page'
import { OrdersView } from './OrdersView'
import { GroupBudgetView } from './GroupBudgetView'
import { SubProjectsStrip } from './SubProjectsStrip'

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
export async function BudgetTab({ projectId, view, focus }: {
  projectId: string
  view: number
  /** Where an approval link wants the estimate opened — work category,
   *  sub-skill, and the sheet to offer. Passed straight through; the Internal
   *  Estimate page has read these since the HOD asked for project-first
   *  approvals. This tab used to hand it a hardcoded `{ in_cockpit: '1' }`,
   *  which silently dropped them and landed the approver on a collapsed
   *  project with nothing highlighted. */
  focus?: { disc?: string; sub?: string; ws?: string }
}) {
  if (view === 1) return <OrdersView projectId={projectId} />

  // Group or project? The SAME rule the landing and the sidebar use (Aksha,
  // 16 Sep 2026, grouping flaw 1): a parent is a GROUP only when it holds no
  // budget lines and no working sheets of its own. NGH / P2 / VV are groups
  // and roll up their children. Admin Block, CV4, Ekant Kutir, WCE, CMCW and
  // NRH have money of their own — they open on their own Internal Estimate,
  // with the sub-projects one click away in a strip above it. Before this,
  // any project with children got the roll-up, and Admin Block's own ₹1.43 Cr
  // was unreachable behind its children's ₹33.7 L.
  const shape = await projectShape(projectId)
  // A group (H1) is the roll-up; so is a parent that has children and no data
  // of its own, the rule the sidebar and shell_for still share.
  if (shape.kind === 'group' || (shape.children > 0 && !shape.ownData)) return <GroupBudgetView projectId={projectId} />

  const estimate = (
    <ProjectInternalEstimatePage
      params={Promise.resolve({ id: projectId })}
      searchParams={Promise.resolve({
        in_cockpit: '1',
        focus_disc: focus?.disc,
        focus_sub: focus?.sub,
        ws: focus?.ws,
      })}
    />
  )
  if (shape.children === 0) return estimate
  return (
    <div className="space-y-4">
      <SubProjectsStrip projectId={projectId} />
      {estimate}
    </div>
  )
}

/** How many live sub-projects this project has, and whether it carries Cost
 *  Control data of its own. Three head-counts in parallel — a leaf pays a few
 *  milliseconds before its estimate loads. `ownData` mirrors shell_for's
 *  hasOwnData (a budget line or a working sheet) so the tab and the sidebar
 *  can never disagree about what is a group. */
async function projectShape(projectId: string): Promise<{ children: number; ownData: boolean; kind: string }> {
  const supabase = await createClient()
  const [me, kids, lines, sheets] = await Promise.all([
    supabase.from('projects').select('project_type').eq('id', projectId).maybeSingle(),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('parent_project_id', projectId).is('archived_at', null),
    supabase.from('cc_budget_lines').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    supabase.from('cc_working_sheets').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
  ])
  return { children: kids.count ?? 0, ownData: (lines.count ?? 0) > 0 || (sheets.count ?? 0) > 0, kind: (me.data?.project_type as string | null) ?? 'project' }
}
