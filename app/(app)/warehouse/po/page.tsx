import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { createClient } from '@/lib/supabase/server'
import { searchTrackerPos, getTrackerPo } from '@/lib/warehouse/po-import'
import { formatDate } from '@/lib/utils'
import { PoImportClient } from './po-import-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PoPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; po?: string }> }) {
  await requirePermission('warehouse', 'view')
  const perms = await getMyPermissions()
  const canEdit = can(perms, 'warehouse', 'edit')
  const { q = '', po } = await searchParams
  const sb = await createClient()

  const [available, picked, mineRes, projectsRes] = await Promise.all([
    searchTrackerPos(q),
    po ? getTrackerPo(po) : Promise.resolve(null),
    sb.from('wh_po')
      .select('id, po_no, po_date, vendor, entity, status, source, wh_po_lines(id, ordered_qty)')
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(20),
    sb.from('projects').select('id, name').order('name'),
  ])

  const mine = mineRes.data ?? []
  // Two independent reads, two independent failures. A blank 'already imported'
  // list must not be mistaken for 'nothing imported yet'.
  const readError = mineRes.error?.message ?? projectsRes.error?.message ?? null

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Purchase Orders"
        subtitle="Pull a PO out of the Indent → PO Tracker. Vendor, date, materials, units and ordered quantities all come from IN4 as they are — nothing to map or confirm."
      />

      {readError && <QueryError message={readError} what="your purchase orders" />}

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-[12.5px] text-sky-900">
        <b>IN4 is the base.</b> The material name IN4 uses <i>is</i> the item here, with IN4&apos;s own unit —
        no guessing which of our items it might mean. A material IN4 has never sent before simply becomes
        a new item on import. If what actually arrives at the gate is not what IN4 says, the storekeeper
        or the guard records what really came and the line is <b>flagged as different from IN4 and the
        bill</b>, for procurement to settle afterwards.
      </div>

      <PoImportClient
        q={q}
        available={available}
        picked={picked}
        projects={(projectsRes.data ?? []) as Array<{ id: string; name: string }>}
        canEdit={canEdit}
      />

      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          POs in Warehouse V2
        </h3>
        {mine.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
            None yet. Import one above and its balance appears on the Gate IN screen.
          </Card>
        ) : (
          <Card className="p-0 shadow-sm overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="text-left font-bold px-3 py-2 border-b border-slate-200">PO</th>
                  <th className="text-left font-bold px-3 py-2 border-b border-slate-200">Vendor</th>
                  <th className="text-left font-bold px-3 py-2 border-b border-slate-200">Paid by</th>
                  <th className="text-right font-bold px-3 py-2 border-b border-slate-200">Lines</th>
                  <th className="text-left font-bold px-3 py-2 border-b border-slate-200">Date</th>
                  <th className="text-left font-bold px-3 py-2 border-b border-slate-200">Status</th>
                </tr>
              </thead>
              <tbody>
                {mine.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono font-semibold text-slate-800">{p.po_no}</td>
                    <td className="px-3 py-2 text-slate-700">{p.vendor ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{p.entity ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(p.wh_po_lines ?? []).length}</td>
                    <td className="px-3 py-2 text-slate-600">{p.po_date ? formatDate(p.po_date) : '—'}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] font-extrabold uppercase rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">
                        {p.status.replace('_', ' ')}
                      </span>
                      {p.source === 'tracker' && (
                        <span className="ml-1.5 text-[10px] font-bold text-sky-700">from IN4</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
