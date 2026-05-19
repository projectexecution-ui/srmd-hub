import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatINR, formatNumber } from '@/lib/utils'
import { PackageCheck, Receipt } from 'lucide-react'
import { PODownloadButton } from './pdf-button'

export const dynamic = 'force-dynamic'

export default async function PODetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase
    .from('purchase_orders')
    .select('*, vendors(*), projects(id, code, name)')
    .eq('id', id)
    .single()

  if (!po) notFound()

  const [{ data: lines }, { data: grns }, { data: invoices }] = await Promise.all([
    supabase.from('po_lines').select('*').eq('po_id', id).order('line_no'),
    supabase.from('grns').select('id, grn_no, grn_date').eq('po_id', id).order('grn_date', { ascending: false }),
    supabase.from('invoices').select('id, invoice_no, invoice_date, invoice_amount').eq('po_id', id).order('invoice_date', { ascending: false }),
  ])

  const vendor = Array.isArray(po.vendors) ? po.vendors[0] : po.vendors
  const proj = Array.isArray(po.projects) ? po.projects[0] : po.projects
  const isDraft = po.po_no?.startsWith('DRAFT-')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title={po.po_no} back="/pos" subtitle={vendor?.name}>
        {isDraft && <Badge variant="warning">Draft</Badge>}
        <PODownloadButton po={{ ...po, vendors: vendor, projects: proj }} lines={lines ?? []} />
      </PageHeader>

      {/* Meta */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Date" value={formatDate(po.po_date)} />
            <Field label="Project" value={proj ? `${proj.code} — ${proj.name}` : '—'} />
            <Field label="Sub-project" value={po.sub_project || '—'} />
            <Field label="PO Amount" value={<span className="font-bold text-gray-900">{formatINR(po.po_amount)}</span>} />
          </div>
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">PO Lines ({lines?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines && lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">#</th>
                    <th className="px-4 py-2 font-semibold">Material</th>
                    <th className="px-4 py-2 font-semibold">UOM</th>
                    <th className="px-4 py-2 font-semibold text-right">Qty</th>
                    <th className="px-4 py-2 font-semibold text-right">Rate</th>
                    <th className="px-4 py-2 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-gray-500">{l.line_no ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-900">
                        <p className="font-medium">{l.material_name}</p>
                        {l.material_desc && <p className="text-xs text-gray-500 mt-0.5">{l.material_desc}</p>}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{l.uom || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-900">{formatNumber(l.po_qty, 3)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{formatNumber(l.po_rate, 2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{formatNumber(l.line_amount, 2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr className="border-t border-gray-200">
                    <td colSpan={5} className="px-4 py-2 text-right text-xs uppercase tracking-wide text-gray-500 font-semibold">Subtotal</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{formatINR(po.subtotal)}</td>
                  </tr>
                  {Number(po.tax_on_material) > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-1 text-right text-xs text-gray-500">Tax on material</td>
                      <td className="px-4 py-1 text-right tabular-nums text-gray-700">{formatINR(po.tax_on_material)}</td>
                    </tr>
                  )}
                  {Number(po.other_charges) > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-1 text-right text-xs text-gray-500">Other charges</td>
                      <td className="px-4 py-1 text-right tabular-nums text-gray-700">{formatINR(po.other_charges)}</td>
                    </tr>
                  )}
                  {Number(po.taxes_on_other_charges) > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-1 text-right text-xs text-gray-500">Tax on other charges</td>
                      <td className="px-4 py-1 text-right tabular-nums text-gray-700">{formatINR(po.taxes_on_other_charges)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-gray-200">
                    <td colSpan={5} className="px-4 py-2 text-right text-sm font-bold text-gray-900">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold text-gray-900">{formatINR(po.po_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState title="No lines on this PO" />
          )}
        </CardContent>
      </Card>

      {/* Vendor */}
      {vendor && (
        <Card>
          <CardHeader><CardTitle className="text-base">Vendor</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm font-semibold text-gray-900">{vendor.name}</p>
            {vendor.gstin && <p className="text-xs text-gray-500">GSTIN: {vendor.gstin}</p>}
            {vendor.address && <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{vendor.address}</p>}
            <div className="mt-2 text-xs text-gray-600 flex flex-wrap gap-4">
              {vendor.contact_person && <span>👤 {vendor.contact_person}</span>}
              {vendor.contact_phone && <span>📞 {vendor.contact_phone}</span>}
              {vendor.contact_email && <span>✉️ {vendor.contact_email}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* GRNs */}
      <Card>
        <CardHeader><CardTitle className="text-base">GRNs ({grns?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {grns && grns.length > 0 ? (
            <div className="space-y-2">
              {grns.map(g => (
                <Link
                  key={g.id}
                  href={`/grns/${g.id}`}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                >
                  <span className="text-sm font-semibold text-blue-700">{g.grn_no || g.id.slice(0, 8)}</span>
                  <span className="text-xs text-gray-500">{formatDate(g.grn_date)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<PackageCheck className="h-8 w-8" />} title="No GRN against this PO yet" />
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader><CardTitle className="text-base">Invoices ({invoices?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {invoices && invoices.length > 0 ? (
            <div className="space-y-2">
              {invoices.map(inv => (
                <Link
                  key={inv.id}
                  href={`/invoices/${inv.id}`}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                >
                  <div>
                    <span className="text-sm font-semibold text-blue-700">{inv.invoice_no}</span>
                    <span className="text-xs text-gray-500 ml-2">{formatDate(inv.invoice_date)}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{formatINR(inv.invoice_amount)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Receipt className="h-8 w-8" />} title="No invoices against this PO yet" />
          )}
        </CardContent>
      </Card>

      {po.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-line">{po.notes}</p>
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
