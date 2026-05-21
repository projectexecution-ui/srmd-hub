import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { IndentStagePill } from '@/components/IndentStagePill'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatNumber } from '@/lib/utils'
import { FileText } from 'lucide-react'
import { IndentNotesForm } from './notes-form'

export const dynamic = 'force-dynamic'

export default async function IndentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const perms = await requirePermission('indents', 'view')
  const canEdit = can(perms, 'indents', 'edit')
  const supabase = await createClient()

  const { data: indent } = await supabase
    .from('indents')
    .select('*, projects(id, code, name)')
    .eq('id', id)
    .single()

  if (!indent) notFound()

  const { data: lines } = await supabase
    .from('indent_lines')
    .select('*')
    .eq('indent_id', id)
    .order('line_no')

  // Linked POs (POs whose lines reference any of this indent's lines)
  const { data: linkedPos } = await supabase
    .from('po_lines')
    .select('po_id, purchase_orders(id, po_no, po_date, po_amount, vendors(name))')
    .in('indent_line_id', (lines ?? []).map(l => l.id))
  const poMap = new Map<string, { id: string; po_no: string; po_date: string; po_amount: number; vendors: { name: string } | null }>()
  for (const row of linkedPos ?? []) {
    const po = Array.isArray(row.purchase_orders) ? row.purchase_orders[0] : row.purchase_orders
    if (po && !poMap.has(po.id)) {
      poMap.set(po.id, {
        ...po,
        vendors: Array.isArray(po.vendors) ? po.vendors[0] : po.vendors,
      })
    }
  }
  const uniquePos = Array.from(poMap.values())

  const proj = Array.isArray(indent.projects) ? indent.projects[0] : indent.projects

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title={indent.indent_no} back="/indents" subtitle={proj ? `${proj.code} · ${proj.name}` : undefined}>
        <IndentStagePill stage={indent.stage} />
      </PageHeader>

      {/* Meta */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Date" value={formatDate(indent.indent_date)} />
            <Field label="Sub-project" value={indent.sub_project || '—'} />
            <Field label="Area of application" value={indent.area_of_application || '—'} />
            <Field label="Raised by" value={indent.raised_by || '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Material Lines ({lines?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines && lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">#</th>
                    <th className="px-4 py-2 font-semibold">Material</th>
                    <th className="px-4 py-2 font-semibold">Area of application</th>
                    <th className="px-4 py-2 font-semibold">UOM</th>
                    <th className="px-4 py-2 font-semibold text-right">Qty</th>
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
                      <td className="px-4 py-2 text-gray-700">{l.area_of_application || '—'}</td>
                      <td className="px-4 py-2 text-gray-700">{l.uom || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-900">{formatNumber(l.indent_qty, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No lines on this indent" />
          )}
        </CardContent>
      </Card>

      {/* Linked POs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase Orders ({uniquePos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {uniquePos.length > 0 ? (
            <div className="space-y-2">
              {uniquePos.map(po => (
                <Link
                  key={po.id}
                  href={`/pos/${po.id}`}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-blue-700 truncate">{po.po_no}</p>
                    <p className="text-xs text-gray-500 truncate">{po.vendors?.name ?? '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{formatDate(po.po_date)}</p>
                    <p className="text-xs text-gray-500">₹{formatNumber(po.po_amount)}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<FileText className="h-8 w-8" />} title="No POs issued against this indent yet" />
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <IndentNotesForm indentId={indent.id} initialNotes={indent.notes ?? ''} canEdit={canEdit} />
        </CardContent>
      </Card>
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
