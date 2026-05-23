import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { formatINR, formatDateIN } from '@/lib/jmr/format'
import { AlertTriangle } from 'lucide-react'
import { BillActions } from './bill-actions'

export const dynamic = 'force-dynamic'

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const perms = await requirePermission('jmr-bills', 'view')
  const profile = await getMyProfile()
  const isPM = can(perms, 'jmr-bills', 'edit') && (profile?.role === 'admin' || profile?.role === 'head')

  const { id } = await params
  const supabase = await createClient()

  const { data: bill } = await supabase
    .from('jmr_bills')
    .select(`
      *,
      jmr_contractors ( id, name, gst_number ),
      projects ( id, name, code ),
      jmr_bill_line_items (
        id, billed_quantity, jmr_quantity, rate, amount, variance, variance_pct,
        jmr_items ( name, unit, category )
      )
    `)
    .eq('id', id)
    .single()
  if (!bill) notFound()

  const photoUrl = bill.bill_photo_url ? (await supabase.storage.from('jmr-photos').createSignedUrl(bill.bill_photo_url, 3600)).data?.signedUrl : null

  // Supabase types the joined relations as arrays; unwrap them once here.
  type RelObj<T> = T | T[] | null | undefined
  function unwrap<T>(v: RelObj<T>): T | null {
    if (!v) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }
  type LineItem = {
    id: string
    billed_quantity: number | string
    jmr_quantity: number | string
    rate: number | string
    amount: number | string
    variance: number | string
    variance_pct: number | string | null
    jmr_items?: RelObj<{ name: string; unit: string; category: string }>
  }
  const lines: LineItem[] = (bill.jmr_bill_line_items ?? []) as LineItem[]
  const contractor = unwrap(bill.jmr_contractors as RelObj<{ id: string; name: string; gst_number?: string }>)
  const project = unwrap(bill.projects as RelObj<{ id: string; name: string; code?: string }>)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader
        title={`Bill ${bill.bill_number}`}
        subtitle={`${contractor?.name ?? ''} · ${project?.code || project?.name || ''}`}
        back="/jmr/bills"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          {bill.variance_flag && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-sm text-rose-900">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Variance flagged</p>
                <p className="text-xs opacity-80">One or more line items exceed the configured tolerance.</p>
              </div>
            </div>
          )}

          <Card className="p-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Line items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-right">JMR qty</th>
                    <th className="px-2 py-2 text-right">Billed</th>
                    <th className="px-2 py-2 text-right">Var.</th>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => {
                    const item = unwrap(l.jmr_items)
                    const unit = item?.unit ?? ''
                    const flagged = Math.abs(Number(l.variance_pct) || 0) > 5
                    return (
                      <tr key={l.id} className={`border-t border-gray-100 ${flagged ? 'bg-rose-50/60' : ''}`}>
                        <td className="px-2 py-2">{item?.name}</td>
                        <td className="px-2 py-2 text-right text-gray-700">{Number(l.jmr_quantity)} {unit}</td>
                        <td className="px-2 py-2 text-right font-medium">{Number(l.billed_quantity)} {unit}</td>
                        <td className={`px-2 py-2 text-right ${flagged ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                          {Number(l.variance) > 0 ? '+' : ''}{Number(l.variance)} ({l.variance_pct != null ? `${Number(l.variance_pct).toFixed(1)}%` : '—'})
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{formatINR(Number(l.rate))}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold">{formatINR(Number(l.amount))}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50 text-sm">
                  <tr><td colSpan={5} className="px-2 py-1.5 text-right font-medium">Sub-total</td><td className="px-2 py-1.5 text-right font-mono">{formatINR(Number(bill.subtotal))}</td></tr>
                  <tr><td colSpan={5} className="px-2 py-1.5 text-right text-gray-600">GST {bill.gst_rate}%</td><td className="px-2 py-1.5 text-right font-mono">{formatINR(Number(bill.gst_amount))}</td></tr>
                  <tr className="font-bold"><td colSpan={5} className="px-2 py-2 text-right">Total</td><td className="px-2 py-2 text-right font-mono">{formatINR(Number(bill.total_amount))}</td></tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {photoUrl && (
            <Card className="p-3">
              <p className="text-xs text-gray-500 mb-2">Bill photo</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="Bill" className="max-h-96 mx-auto rounded" />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4 text-sm space-y-2">
            <Detail label="Bill date" value={formatDateIN(bill.bill_date)} />
            <Detail label="Period" value={`${formatDateIN(bill.period_from)} – ${formatDateIN(bill.period_to)}`} />
            <Detail label="Status" value={bill.status} />
            {bill.paid_on && <Detail label="Paid on" value={formatDateIN(bill.paid_on)} />}
            {bill.payment_ref && <Detail label="Payment ref" value={bill.payment_ref} />}
          </Card>
          {isPM && (
            <Card className="p-4">
              <h3 className="text-sm font-bold text-gray-800 mb-3">PM actions</h3>
              <BillActions bill={bill} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}
