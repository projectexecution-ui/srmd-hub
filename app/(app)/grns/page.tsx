import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PackageCheck } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function GRNsPage() {
  const supabase = await createClient()
  const { data: grns } = await supabase
    .from('grns')
    .select('id, grn_no, grn_date, certificate_id, purchase_orders(id, po_no, vendors(name))')
    .order('grn_date', { ascending: false })
    .limit(200)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="GRN" subtitle={`${grns?.length ?? 0} goods received note${grns?.length === 1 ? '' : 's'}`} />
      <Card className="overflow-hidden">
        {grns && grns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">GRN No.</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">PO</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Certificate</th>
                </tr>
              </thead>
              <tbody>
                {grns.map((g: { id: string; grn_no: string | null; grn_date: string; certificate_id: string | null; purchase_orders: { id: string; po_no: string; vendors: { name: string } | { name: string }[] | null } | { id: string; po_no: string; vendors: { name: string } | { name: string }[] | null }[] | null }) => {
                  const po = Array.isArray(g.purchase_orders) ? g.purchase_orders[0] : g.purchase_orders
                  const v = po ? (Array.isArray(po.vendors) ? po.vendors[0] : po.vendors) : null
                  return (
                    <tr key={g.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/grns/${g.id}`} className="font-semibold text-blue-700 hover:underline">
                          {g.grn_no || g.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(g.grn_date)}</td>
                      <td className="px-4 py-3 text-gray-700">{po?.po_no || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[240px] truncate">{v?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{g.certificate_id || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<PackageCheck className="h-10 w-10" />} title="No GRNs found" />
        )}
      </Card>
    </div>
  )
}
