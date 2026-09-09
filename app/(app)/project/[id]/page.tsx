import { redirect } from 'next/navigation'
import { requirePermission, getDisabledModuleSlugs, scopePermissions } from '@/lib/auth'
import { WORKSPACE_TABS, activeSubTab, workspaceHref } from '@/lib/revamp/workspace'
import { canOpenWorkspaceTab, landingSub, scopedPerms } from '@/lib/revamp/permissions'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { BudgetTab } from './BudgetTab'

export const dynamic = 'force-dynamic'

/**
 * The workspace's landing tab is BUDGET vs ACTUAL — opening a project shows
 * the money, which is what people came for.
 *
 * Its three views are the sub-tab pills, chosen by `?view=`:
 *   0  Category / sub-category wise (default)
 *   1  Category — WO/PO wise
 *   2  CT wise
 */
export default async function ProjectBudgetPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const { id } = await params
  const { view } = await searchParams

  // The Budget tab's own switch (ws:budget) and its pills (ws:budget:by-order …),
  // inheriting cost-control until an admin sets them. See lib/revamp/permissions.ts.
  const budget = WORKSPACE_TABS[0]
  const [disabled, isReviewer] = await Promise.all([getDisabledModuleSlugs(), checkIsCcReviewer()])
  if (!canOpenWorkspaceTab(perms, budget, disabled, isReviewer)) redirect('/dashboard')
  const asked = activeSubTab(budget, view)
  const land = landingSub(perms, budget, asked)
  if (land < 0) redirect('/dashboard')
  if (land !== asked) redirect(workspaceHref(id, budget, land))
  // The Budget screens now see what the tab and pill grant (Edit / Admin), not the bare power.
  await scopePermissions(scopedPerms(perms, budget, land))

  return <BudgetTab projectId={id} view={land} />
}
