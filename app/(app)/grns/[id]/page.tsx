import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function GRNDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: grn } = await supabase
    .from('grns')
    .select('*, purchase_orders(id, po_no, vendors(name), projects(code))')
    .eq('id', id)
    .single()

  if (!grn) notFound()

  const { data: lines } = await supabase
    .from('grn_lines')
    .select('*, po_lines(material_name, material_desc, uom, po_qty, po_rate)')
    .eq('grn_id', id)

  const po = Array.isArray(grn.purchase_orders) ? grn.purchase_orders[0] : grn.purchase_orders
  const vendor = po ? (Array.isArray(po.vendors) ? po.vendors[0] : po.vendors) : null
  const proj = po ? (Array.isArray(po.projects) ? po.projects[0] : po.projects) : null

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={grn.grn_no || `GRN ${grn.id.slice(0, 8)}`}
        back="/grns"
        subtitle={po ? `PO: ${po.po_no}` : undefined}
      />

      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="GRN Date" value={formatDate(grn.grn_date)} />
            <Field
              label="PO"
              value={po ? <Link href={`/pos/${po.id}`} className="text-blue-700 hover:underline">{po.po_no}</Link> : '—'}
            />
            <Field label="Vendor" value={vendor?.name || '—'} />
            <Field label="Project" value={proj?.code || '—'} />
            <Field label="Certificate" value={grn.certificate_id || '—'} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Received Lines ({lines?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {lines && lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Material</th>
                    <th className="px-4 py-2 font-semibold">UOM</th>
                    <th className="px-4 py-2 font-semibold text-right">Received</th>
                    <th className="px-4 py-2 font-semibold text-right">Breakage</th>
                    <th className="px-4 py-2 font-semibold text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l: { id: string; received_qty: number; breakage_qty: number; net_received_qty: number; po_lines: { material_name: string; material_desc: string | null; uom: string | null } | { material_name: string; material_desc: string | null; uom: string | null }[] | null }) => {
                    const pl = Array.isArray(l.po_lines) ? l.po_lines[0] : l.po_lines
                    return (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 text-gray-900">
                          <p className="font-medium">{pl?.material_name || '—'}</p>
                          {pl?.material_desc && <p className="text-xs text-gray-500 mt-0.5">{pl.material_desc}</p>}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{pl?.uom || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(l.received_qty, 3)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-amber-700">{formatNumber(l.breakage_qty, 3)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{formatNumber(l.net_received_qty, 3)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No lines on this GRN" />
          )}
        </CardContent>
      </Card>

      {grn.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700 whitespace-pre-line">{grn.notes}</p>
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
