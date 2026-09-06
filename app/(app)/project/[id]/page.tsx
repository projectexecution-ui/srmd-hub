import { requirePermission } from '@/lib/auth'
import { WORKSPACE_TABS, activeSubTab } from '@/lib/revamp/workspace'
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
  await requirePermission('cost-control', 'view')
  const { id } = await params
  const { view } = await searchParams

  return <BudgetTab projectId={id} view={activeSubTab(WORKSPACE_TABS[0], view)} />
}
