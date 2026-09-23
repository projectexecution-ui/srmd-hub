import { requireBillsAccess } from '@/lib/bills-booking/access'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { DESKS } from '@/lib/bills-booking/desk-list'
import { BillsDesksBody } from './body'
export { DESKS }

export const dynamic = 'force-dynamic'

/** Who sits at which desk — reached from inside Bills Approval. The same grid
 *  is Admin › Projects › Bills desks (Aksha, 23 Sep 2026, D1). */
export default async function BillsDesksPage() {
  const me = await requireBillsAccess()
  if (!me.isAdmin) redirect('/bills-booking')
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader title="Who sits at which desk" back="/bills-booking"
        subtitle="One grid. Also under Admin › Projects › Bills desks." />
      <BillsDesksBody />
    </div>
  )
}
