import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Receipt } from 'lucide-react'
import { formatDate, formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function InvoicesPage() {
  await requirePermission('invoices', 'view')
  const supabase = await createClient()
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_no, invoice_date, invoice_amount, vendors(name), purchase_orders(po_no)')
    .order('invoice_date', { ascending: false })
    .limit(200)

  const total = invoices?.reduce((s, i) => s + Number(i.invoice_amount ?? 0), 0) ?? 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Invoices" subtitle={`${invoices?.length ?? 0} invoice${invoices?.length === 1 ? '' : 's'} · ${formatINR(total)}`} />
      <Card className="overflow-hidden">
        {invoices && invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Invoice No.</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">PO</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: { id: string; invoice_no: string; invoice_date: string; invoice_amount: number; vendors: { name: string } | { name: string }[] | null; purchase_orders: { po_no: string } | { po_no: string }[] | null }) => {
                  const v = Array.isArray(inv.vendors) ? inv.vendors[0] : inv.vendors
                  const po = Array.isArray(inv.purchase_orders) ? inv.purchase_orders[0] : inv.purchase_orders
                  return (
                    <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/invoices/${inv.id}`} className="font-semibold text-blue-700 hover:underline">
                          {inv.invoice_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3 text-gray-700">{po?.po_no || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[240px] truncate">{v?.name || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900 text-right tabular-nums">{formatINR(inv.invoice_amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Receipt className="h-10 w-10" />} title="No invoices yet" />
        )}
      </Card>
    </div>
  )
}
