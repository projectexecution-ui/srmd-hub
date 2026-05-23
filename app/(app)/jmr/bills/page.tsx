import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, Receipt, AlertTriangle } from 'lucide-react'
import { formatINR, formatDateIN } from '@/lib/jmr/format'
import type { JmrBillStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function JmrBillsPage() {
  await requirePermission('jmr-bills', 'view')
  const supabase = await createClient()

  const { data: bills } = await supabase
    .from('jmr_bills')
    .select(`
      id, bill_number, bill_date, period_from, period_to, total_amount, status, variance_flag,
      jmr_contractors ( name ),
      projects ( name, code )
    `)
    .order('bill_date', { ascending: false })
    .limit(200)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="Bills" subtitle={`${bills?.length ?? 0} bill${bills?.length === 1 ? '' : 's'}`} back="/jmr">
        <Button asChild size="sm"><Link href="/jmr/bill"><Plus className="h-4 w-4" />New bill</Link></Button>
      </PageHeader>
      <Card className="overflow-hidden">
        {bills && bills.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Bill no.</th>
                  <th className="px-4 py-3 font-semibold">Contractor</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Period</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => {
                  const contractor = Array.isArray(b.jmr_contractors) ? b.jmr_contractors[0] : b.jmr_contractors
                  const project = Array.isArray(b.projects) ? b.projects[0] : b.projects
                  return (
                    <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/jmr/bills/${b.id}`} className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-1.5">
                          {b.variance_flag && <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />}
                          {b.bill_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{contractor?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{project?.code || project?.name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{formatDateIN(b.period_from)} – {formatDateIN(b.period_to)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(Number(b.total_amount))}</td>
                      <td className="px-4 py-3"><StatusPill v={b.status as JmrBillStatus} flagged={b.variance_flag} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Receipt className="h-10 w-10" />}
            title="No bills yet"
            action={<Button asChild size="sm"><Link href="/jmr/bill">Log first bill</Link></Button>}
          />
        )}
      </Card>
    </div>
  )
}

function StatusPill({ v, flagged }: { v: JmrBillStatus; flagged: boolean }) {
  const styles: Record<JmrBillStatus, string> = {
    submitted: 'bg-gray-100 text-gray-700',
    pm_review: 'bg-amber-100 text-amber-800',
    approved:  'bg-emerald-100 text-emerald-800',
    paid:      'bg-blue-100 text-blue-800',
    rejected:  'bg-rose-100 text-rose-800',
  }
  const labels: Record<JmrBillStatus, string> = {
    submitted: 'Submitted', pm_review: 'Awaiting verify', approved: 'Approved · pending pay',
    paid: 'Paid', rejected: 'Rejected',
  }
  return (
    <div className="flex items-center gap-1.5">
      {flagged && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800">Variance</span>
      )}
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[v]}`}>{labels[v]}</span>
    </div>
  )
}
