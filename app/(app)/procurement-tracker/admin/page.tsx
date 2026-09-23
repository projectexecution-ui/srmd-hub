import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { TrackerVisibilityBody } from './body'

export const dynamic = 'force-dynamic'

/** Who sees which project's indents — reached from inside the tracker. The same
 *  editor is Admin › Projects › Tracker visibility (Aksha, 23 Sep 2026, D1). */
export default async function ProcurementProjectVisibilityPage() {
  await requirePermission('procurement-tracker', 'admin', '/procurement-tracker')
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title="Tracker visibility" back="/procurement-tracker" subtitle="Which projects each person sees in the Indent → PO tracker. Also under Admin › Projects." />
      <TrackerVisibilityBody />
    </div>
  )
}
