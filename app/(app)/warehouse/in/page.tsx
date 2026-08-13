import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { getGateInOptions, getRecentIns, getShowValues, one } from '@/lib/warehouse/data'
import { formatDate } from '@/lib/utils'
import { formatQty } from '@/lib/warehouse/format'
import { GateInForm } from './gate-in-form'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function GateInPage() {
  await requirePermission('warehouse', 'view')
  const perms = await getMyPermissions()
  const canEdit = can(perms, 'warehouse', 'edit')
  // The guard records trucks; he has no business seeing what they cost. The
  // permissions matrix controls screens, not columns — so values are gated
  // here. (#22)
  // One definition for the whole module, driven by the Settings switch. (#22)
  const showValues = await getShowValues()

  const [options, recent] = await Promise.all([getGateInOptions(), getRecentIns()])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Gate IN"
        subtitle="One entry per challan. Type the challan quantity and what actually came off the truck — the difference is recorded as a shortage, not absorbed into stock."
      />

      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
          You can see this register but not add to it. Ask an admin for edit access on Warehouse V2.
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,400px)_1fr] gap-4 items-start">
        <GateInForm options={options} canEdit={canEdit} showValues={showValues} />

        <div className="space-y-3 min-w-0">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Recent entries
          </h3>
          {recent.error && <QueryError message={recent.error.message} what="recent gate entries" />}
          {!recent.error && recent.rows.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
              No entries yet. The first truck you record will show up here.
            </Card>
          )}
          {recent.rows.map(r => {
            const lines = r.wh_gate_in_lines ?? []
            const short = lines.reduce((s, l) => s + Math.max(0, Number(l.short_qty)), 0)
            const damaged = lines.reduce((s, l) => s + Number(l.damaged_qty), 0)
            const po = one(r.wh_po)?.po_no ?? r.po_no_text
            return (
              <Card key={r.id} className="p-0 shadow-sm overflow-hidden">
                <div className="px-3 py-2 bg-slate-50/70 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11.5px] font-bold text-slate-700">{r.entry_no}</span>
                  <span className="text-[11px] text-slate-500">{formatDate(r.entry_date)}</span>
                  <span className="text-[11.5px] font-semibold text-slate-800 truncate">{r.party}</span>
                  {r.owner === 'vendor' && (
                    <span className="text-[9.5px] font-extrabold uppercase bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">vendor</span>
                  )}
                  {!po && (
                    <span className="text-[9.5px] font-extrabold uppercase bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">no PO</span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-500 truncate">
                    {one(r.wh_locations)?.name}
                  </span>
                </div>
                <div className="px-3 py-2 space-y-1">
                  {lines.map(l => {
                    const ordered = one(l.po_line)
                    return (
                    <div key={l.id}>
                      <div className="flex items-baseline gap-2 text-[12px]">
                        <span className="flex-1 min-w-0 truncate text-slate-700">{one(l.wh_items)?.name ?? '—'}</span>
                        <span className="tabular-nums font-semibold text-slate-800">
                          {formatQty(l.good_qty)} {one(l.wh_items)?.unit}
                        </span>
                        {Number(l.short_qty) > 0 && (
                          <span className="tabular-nums text-[11px] font-bold text-rose-600">short {formatQty(l.short_qty)}</span>
                        )}
                        {Number(l.damaged_qty) > 0 && (
                          <span className="tabular-nums text-[11px] font-bold text-amber-700">dmg {formatQty(l.damaged_qty)}</span>
                        )}
                      </div>
                      {/* What IN4 ordered vs what actually turned up. Flagged at
                          the gate, kept on the entry for procurement + billing. */}
                      {l.differs_from_po && (
                        <div className="mt-0.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] text-amber-900">
                          <b>Not what IN4 ordered.</b>{' '}
                          {ordered && <>IN4 said <i>{ordered.source_text || one(ordered.wh_items)?.name}</i>. </>}
                          {l.differ_note}
                        </div>
                      )}
                    </div>
                  )})}
                  {(short > 0 || damaged > 0) && (
                    <p className="text-[11px] text-rose-700 pt-1 border-t border-slate-100 mt-1.5">
                      {short > 0 && <>Short by {formatQty(short)} against the challan — reported to procurement. </>}
                      {damaged > 0 && <>{formatQty(damaged)} damaged, booked as damaged not good stock.</>}
                    </p>
                  )}
                  {lines.some(l => l.differs_from_po) && (
                    <p className="text-[11px] text-amber-800 pt-1 border-t border-slate-100 mt-1.5">
                      Some of this did not match what IN4 ordered — needs fixing in IN4 and checking against the bill.
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

