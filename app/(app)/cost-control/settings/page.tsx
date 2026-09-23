import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { InternalEstimateSettingsBody } from './body'

export const dynamic = 'force-dynamic'
// The "Send me a test card" action renders a card + generates the Computed
// Working PDF + forwards the Excel & evidence, so give it room past the 10s default.
export const maxDuration = 60

/** Internal Estimate settings — reached from inside Cost Control. The same
 *  form is Admin › Hub › Internal Estimate settings (Aksha, 23 Sep 2026: one
 *  name everywhere — it was "Cost Control — Settings" here and "Internal
 *  Estimate settings" on Admin). */
export default async function CostControlSettingsPage() {
  await requirePermission('cost-control', 'admin')
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Internal Estimate settings"
        subtitle="Switch features on or off and rename the approval fields. Changes apply to everyone the next time a page loads."
        back="/cost-control"
      />
      <InternalEstimateSettingsBody />
    </div>
  )
}
