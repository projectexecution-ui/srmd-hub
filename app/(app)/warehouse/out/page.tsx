import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { createClient } from '@/lib/supabase/server'
import {
  getLocationTree, getPostableSpots, getStockRows, getReceivers,
  getRecentOuts, getLists, getVendorNames, peekNextEntryNo, one,
} from '@/lib/warehouse/data'
import { formatDate } from '@/lib/utils'
import { formatQty } from '@/lib/warehouse/format'
import { GateOutForm } from './gate-out-form'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function GateOutPage() {
  await requirePermission('warehouse', 'view')
  const perms = await getMyPermissions()
  const canEdit = can(perms, 'warehouse', 'edit')
  const sb = await createClient()

  const sites = await getLocationTree()
  const [scoping, stock, receivers, lists, recent, vendorNames, projectsRes, nextOut, nextMove] = await Promise.all([
    getPostableSpots(sites),
    getStockRows(),
    getReceivers(),
    getLists(),
    getRecentOuts(),
    getVendorNames(),
    sb.from('projects').select('id, name').order('name'),
    peekNextEntryNo('out'),
    peekNextEntryNo('move'),
  ])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="OUT of the store"
        subtitle="One screen for all three — material going to a site to be used, stock moving to another store, or a vendor taking his own material back. The first question decides which."
      />

      <div className="grid lg:grid-cols-[minmax(0,400px)_1fr] gap-4 items-start">
        <GateOutForm
          sites={sites}
          postableSpotIds={scoping.ids}
          scopingOff={scoping.scopingOff}
          stock={stock}
          projects={(projectsRes.data ?? []) as Array<{ id: string; name: string }>}
          receivers={receivers}
          entities={lists.entity}
          vendorNames={vendorNames}
          canEdit={canEdit}
          nextOut={nextOut}
          nextMove={nextMove}
        />

        <div className="space-y-3 min-w-0">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Recent</h3>
          {recent.error && <QueryError message={recent.error.message} what="recent OUT entries" />}
          {!recent.error && recent.rows.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
              Nothing has gone out yet.
            </Card>
          )}
          {recent.rows.map(r => {
            const lines = r.wh_gate_out_lines ?? []
            const isSite = r.dest_type === 'site'
            const isStore = r.dest_type === 'store'
            const overdue = r.is_returnable && r.return_due_date
              && new Date(r.return_due_date) < new Date() ? true : false
            return (
              <Card key={r.id} className="p-0 shadow-sm overflow-hidden">
                <div className={`px-3 py-2 border-b flex items-center gap-2 flex-wrap ${
                  isSite ? 'bg-amber-50/70 border-amber-100'
                    : isStore ? 'bg-sky-50/70 border-sky-100' : 'bg-purple-50/70 border-purple-100'}`}>
                  <span className="font-mono text-[11.5px] font-bold text-slate-700">{r.entry_no}</span>
                  <span className="text-[11px] text-slate-500">{formatDate(r.entry_date)}</span>
                  <span className="text-[10px] font-extrabold uppercase rounded-full px-2 py-0.5 bg-white/70 text-slate-600">
                    {isSite ? 'to site' : isStore ? 'store move' : 'back to vendor'}
                  </span>
                  <span className="text-[11.5px] font-semibold text-slate-800 min-w-0 truncate">
                    {isSite ? one(r.projects)?.name
                      : isStore ? `${one(r.from_loc)?.name} → ${one(r.to_loc)?.name}`
                      : r.party}
                  </span>
                  {r.is_returnable && (
                    <span className={`text-[10px] font-extrabold uppercase rounded-full px-2 py-0.5 ${
                      overdue ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      returnable{overdue ? ' · overdue' : ''}
                    </span>
                  )}
                  {isSite && !r.confirmed_at && (
                    <span className="ml-auto text-[10px] font-bold text-amber-700">awaiting site confirmation</span>
                  )}
                </div>
                <div className="px-3 py-2 space-y-1">
                  {lines.map(l => (
                    <div key={l.id} className="flex items-baseline gap-2 text-[12px]">
                      <span className="flex-1 min-w-0 truncate text-slate-700">{one(l.wh_items)?.name ?? '—'}</span>
                      <span className="tabular-nums font-semibold text-slate-800">
                        {formatQty(l.qty)} {one(l.wh_items)?.unit}
                      </span>
                    </div>
                  ))}
                  {isStore && (
                    <p className="text-[11px] text-sky-800 pt-1 border-t border-slate-100 mt-1.5">
                      Total stock unchanged — one store down, the other up.
                    </p>
                  )}
                  {!isSite && !isStore && (
                    <p className="text-[11px] text-purple-800 pt-1 border-t border-slate-100 mt-1.5">
                      His own material, gone home. Nothing charged to any project.
                    </p>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
