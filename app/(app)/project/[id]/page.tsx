import { requirePermission } from '@/lib/auth'
import CostControlProjectDetailPage from '@/app/(app)/cost-control/projects/[id]/page'

export const dynamic = 'force-dynamic'

/**
 * The cockpit's landing tab is BUDGET — opening a project should show the
 * Internal Estimate, which is what people came for. Overview is the summary
 * you step back to, and lives at /project/[id]/overview.
 *
 * This renders the EXISTING live page component unchanged. `in_cockpit`
 * suppresses that page's own trial-site redirect back to here, which would
 * otherwise loop forever.
 */
export default async function ProjectBudgetPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ focus_disc?: string; focus_sub?: string; ws?: string }>
}) {
  await requirePermission('cost-control', 'view')
  const { id } = await params
  const sp = await searchParams

  return (
    <CostControlProjectDetailPage
      params={Promise.resolve({ id })}
      searchParams={Promise.resolve({ ...sp, in_cockpit: '1' })}
    />
  )
}
