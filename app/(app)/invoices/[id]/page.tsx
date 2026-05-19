import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatINR, formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: inv } = await supabase
    .from('invoices')
    .select('*, vendors(name, gstin), purchase_orders(id, po_no, projects(code))')
    .eq('id', id)
    .single()

  if (!inv) notFound()

  const { data: lines } = await supabase
    .from('invoice_lines')
    .select('*, po_lines(material_name, material_desc, uom)')
    .eq('invoice_id', id)

  const v = Array.isArray(inv.vendors) ? inv.vendors[0] : inv.vendors
  const po = Array.isArray(inv.purchase_orders) ? inv.purchase_orders[0] : inv.purchase_orders
  const proj = po ? (Array.isArray(po.projects) ? po.projects[0] : po.projects) : null

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={inv.invoice_no}
        back="/invoices"
        subtitle={v?.name}
      />

      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Date" value={formatDate(inv.invoice_date)} />
            <Field
              label="PO"
              value={po ? <Link href={`/pos/${po.id}`} className="text-blue-700 hover:underline">{po.po_no}</Link> : '—'}
            />
            <Field label="Project" value={proj?.code || '—'} />
            <Field label="Invoice Amount" value={<span className="font-bold">{formatINR(inv.invoice_amount)}</span>} />
            {v?.gstin && <Field label="Vendor GSTIN" value={v.gstin} />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoice Lines ({lines?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {lines && lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Material</th>
                    <th className="px-4 py-2 font-semibold">UOM</th>
                    <th className="px-4 py-2 font-semibold text-right">Qty</th>
                    <th className="px-4 py-2 font-semibold text-right">Rate</th>
                    <th className="px-4 py-2 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l: { id: string; invoice_qty: number; rate: number; line_amount: number; po_lines: { material_name: string; material_desc: string | null; uom: string | null } | { material_name: string; material_desc: string | null; uom: string | null }[] | null }) => {
                    const pl = Array.isArray(l.po_lines) ? l.po_lines[0] : l.po_lines
                    return (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 text-gray-900">
                          <p className="font-medium">{pl?.material_name || '—'}</p>
                          {pl?.material_desc && <p className="text-xs text-gray-500 mt-0.5">{pl.material_desc}</p>}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{pl?.uom || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(l.invoice_qty, 3)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(l.rate, 2)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{formatNumber(l.line_amount, 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr className="border-t border-gray-200">
                    <td colSpan={4} className="px-4 py-2 text-right text-xs uppercase tracking-wide text-gray-500 font-semibold">Subtotal</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatINR(inv.subtotal)}</td>
                  </tr>
                  <tr className="border-t border-gray-200">
                    <td colSpan={4} className="px-4 py-2 text-right text-sm font-bold text-gray-900">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold">{formatINR(inv.invoice_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState title="No lines on this invoice" />
          )}
        </CardContent>
      </Card>

      {inv.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-line">{inv.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}
