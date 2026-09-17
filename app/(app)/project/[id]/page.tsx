import { redirect } from 'next/navigation'
import { requirePermission, getDisabledModuleSlugs, scopePermissions } from '@/lib/auth'
import { WORKSPACE_TABS, activeSubTab, workspaceHref } from '@/lib/revamp/workspace'
import { canOpenWorkspaceTab, landingSub, scopedPerms } from '@/lib/revamp/permissions'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { BudgetTab } from './BudgetTab'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The workspace's landing tab is BUDGET vs ACTUAL — opening a project shows
 * the money, which is what people came for.
 *
 * Its two views are the sub-tab pills, chosen by `?view=`:
 *   0  Category / sub-category wise (default)
 *   1  Category — WO/PO wise
 * (A third, CT wise, was removed on 9 Sep 2026 — Aksha: of no use, engineers
 * get their own view as on the live site. An old `?view=2` link lands on 0.)
 */
export default async function ProjectBudgetPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  // focus_disc / focus_sub / ws come from an approval link (home inbox, My
  // Approvals, the bell, the email, Telegram — all via ccApprovalPath). The
  // old page redirects here KEEPING them; this route used to read only `view`
  // and drop them, so an approver landed on a collapsed project with nothing
  // highlighted (Aksha, 17 Sep 2026: "i am lost"). They are threaded through
  // to the Internal Estimate, which already knows how to focus on them.
  searchParams: Promise<{ view?: string; focus_disc?: string; focus_sub?: string; ws?: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const { id } = await params
  const { view, focus_disc: focusDisc, focus_sub: focusSub, ws } = await searchParams

  // The Budget tab's own switch (ws:budget) and its pills (ws:budget:by-order …),
  // inheriting cost-control until an admin sets them. See lib/revamp/permissions.ts.
  const budget = WORKSPACE_TABS[0]
  const [disabled, isReviewer] = await Promise.all([getDisabledModuleSlugs(), checkIsCcReviewer()])
  if (!canOpenWorkspaceTab(perms, budget, disabled, isReviewer)) redirect('/dashboard')
  const asked = activeSubTab(budget, view)
  const land = landingSub(perms, budget, asked)
  if (land < 0) redirect('/dashboard')
  if (land !== asked) {
    // Carry the approval focus across this redirect too, or landing on a
    // different pill would lose the highlight the link was for.
    const href = workspaceHref(id, budget, land)
    const qs = new URLSearchParams()
    if (focusDisc) qs.set('focus_disc', focusDisc)
    if (focusSub) qs.set('focus_sub', focusSub)
    if (ws) qs.set('ws', ws)
    const tail = qs.toString()
    redirect(tail ? `${href}${href.includes('?') ? '&' : '?'}${tail}` : href)
  }
  // The Budget screens now see what the tab and pill grant (Edit / Admin), not the bare power.
  await scopePermissions(scopedPerms(perms, budget, land))

  return <BudgetTab projectId={id} view={land} focus={{ disc: focusDisc, sub: focusSub, ws }} />
}
