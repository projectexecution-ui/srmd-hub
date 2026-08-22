import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { getBudgetV2 } from '@/lib/budget-v2-cached'
import ScPresentationClient from './sc-presentation-client'

export const dynamic = 'force-dynamic'

// "SC Presentation" — a pick-your-projects Budget vs Actual hand-out for the HOD.
// Same single-source tree as the V2 page (loadBudgetV2), rendered in the SC
// format: no WO/PO, no Used, no Balance, no status — just Budget vs Paid with
// ₹/sft under each, projects ordered by cost/sft. Browser-print → PDF, matching
// the other V2 report pages.
export default async function ScPresentationPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const supabase = await createClient()
  const { result, freshness } = await getBudgetV2(supabase)
  return <ScPresentationClient result={result} freshness={freshness} />
}
