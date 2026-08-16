'use client'

/** The V1 daily movement report, on the V2 ledger: four counters, a dark
 *  "where material went" card, then one table per bucket. */

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { formatQty } from '@/lib/warehouse/format'
import { dayTotals, flows, flowSummary, sections, bucketOf, KIND_LABEL } from '@/lib/warehouse/daily'
import type { DayMovement, Bucket } from '@/lib/warehouse/daily'
import {
  LogIn, LogOut, ArrowLeftRight, PackageSearch, ChevronLeft, ChevronRight, ArrowRight,
} from 'lucide-react'

const TONE: Record<Bucket, { chip: string; head: string }> = {
  exit:       { chip: 'bg-rose-100 text-rose-800',       head: 'text-rose-700' },
  entry:      { chip: 'bg-emerald-100 text-emerald-800', head: 'text-emerald-700' },
  transfer:   { chip: 'bg-sky-100 text-sky-800',         head: 'text-sky-700' },
  correction: { chip: 'bg-amber-100 text-amber-900',     head: 'text-amber-700' },
}

export function DailyClient({
  rows, day, today, showValues,
}: {
  rows: DayMovement[]
  day: string
  today: string
  showValues: boolean
}) {
  const router = useRouter()
  const totals = useMemo(() => dayTotals(rows), [rows])
  const flowRows = useMemo(() => flows(rows), [rows])
  const groups = useMemo(() => sections(rows), [rows])

  const shift = (days: number) => {
    const d = new Date(`${day}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    const next = d.toISOString().slice(0, 10)
    router.push(`/warehouse/daily${next === today ? '' : `?d=${next}`}`)
  }

  return (
    <div className="space-y-3">
      {/* Date nav */}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous day"
          className="rounded-lg border-2 border-slate-200 px-2.5 py-2 min-h-[40px] text-slate-500 hover:border-slate-300">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-[13px] font-bold text-slate-800">
          {formatDate(day)}{day === today && <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">today</span>}
        </p>
        <button type="button" onClick={() => shift(1)} disabled={day >= today} aria-label="Next day"
          className="rounded-lg border-2 border-slate-200 px-2.5 py-2 min-h-[40px] text-slate-500 hover:border-slate-300 disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Four counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi icon={<LogIn className="h-4 w-4" />} tone="bg-emerald-50 text-emerald-700"
          n={totals.entries} label="Entries" />
        <Kpi icon={<LogOut className="h-4 w-4" />} tone="bg-rose-50 text-rose-700"
          n={totals.exits} label="Exits" />
        <Kpi icon={<ArrowLeftRight className="h-4 w-4" />} tone="bg-sky-50 text-sky-700"
          n={totals.transfers} label="Transfers" />
        <Kpi icon={<PackageSearch className="h-4 w-4" />} tone="bg-slate-100 text-slate-700"
          n={totals.itemsTouched} label="Items touched" />
      </div>

      {/* Where material went — the one card that answers the question without
          reading a single table row underneath. */}
      <Card className="p-0 shadow-sm overflow-hidden">
        <div className="bg-slate-800 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-[13.5px] font-bold text-white">Where material went</p>
          <p className="text-[11.5px] font-semibold text-amber-300 whitespace-nowrap">
            {flowSummary(flowRows)}
          </p>
        </div>
        {flowRows.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-slate-500">
            Nothing left a store on this day.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {flowRows.map(f => (
              <div key={`${f.from}-${f.to}`} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <p className="text-[13px] text-slate-800 min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{f.from}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                  <span className="font-semibold">{f.to}</span>
                </p>
                <p className="text-[11.5px] text-slate-500 whitespace-nowrap">
                  {f.lines} {f.lines === 1 ? 'line' : 'lines'} · {f.items} {f.items === 1 ? 'item' : 'items'}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {groups.length === 0 ? (
        <Card className="p-8 shadow-sm text-center text-[13px] text-slate-500">
          Nothing moved on {formatDate(day)}.
        </Card>
      ) : groups.map(g => (
        <section key={g.bucket} className="space-y-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${TONE[g.bucket].chip}`}>
            {g.title} · {g.rows.length}
          </span>

          {/* Desktop: the V1 table. Mobile: the same rows as cards, because a
              six-column table at 375px is a horizontal scrollbar nobody uses. */}
          <Card className="p-0 shadow-sm overflow-hidden">
            <div className="hidden md:block">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="text-left px-3 py-2">Item &amp; details</th>
                    <th className="text-left px-2 py-2">Type</th>
                    <th className="text-left px-2 py-2">Store</th>
                    <th className="text-left px-2 py-2">By</th>
                    <th className="text-right px-2 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(r => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 align-top">
                      <td className="px-3 py-2.5">
                        <ItemCell r={r} />
                      </td>
                      <td className="px-2 py-2.5 text-slate-600 whitespace-nowrap">{KIND_LABEL[r.kind]}</td>
                      <td className="px-2 py-2.5 text-slate-600">{r.storeName}</td>
                      <td className="px-2 py-2.5 text-slate-600">{r.actor ?? '—'}</td>
                      <td className="px-2 py-2.5 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatQty(Math.abs(r.qty))} <span className="font-normal text-slate-400">{r.unit}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums whitespace-nowrap">{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-slate-100">
              {g.rows.map(r => (
                <div key={r.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><ItemCell r={r} /></div>
                    <p className="text-[12.5px] font-bold tabular-nums text-slate-900 whitespace-nowrap">
                      {formatQty(Math.abs(r.qty))} <span className="font-normal text-slate-400">{r.unit}</span>
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {KIND_LABEL[r.kind]} · {r.storeName} · {r.actor ?? '—'} · {r.time}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ))}

      {!showValues && rows.length > 0 && (
        <p className="text-[11px] text-slate-400 px-0.5">
          Rates and values are hidden for your role, so this report shows quantities only.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Kpi({ icon, tone, n, label }: {
  icon: React.ReactNode; tone: string; n: number; label: string
}) {
  return (
    <Card className="p-3 shadow-sm flex items-center gap-3">
      <span className={`h-9 w-9 rounded-xl grid place-items-center flex-shrink-0 ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[20px] font-extrabold leading-none text-slate-900 tabular-nums">{n}</span>
        <span className="block text-[11px] text-slate-500 mt-1">{label}</span>
      </span>
    </Card>
  )
}

/** Item name, its code, and the one line of context that turns a movement into
 *  a story: which entry, where it went, and what the keeper wrote. */
function ItemCell({ r }: { r: DayMovement }) {
  const bits = [
    r.counterparty,
    r.remarks ? `“${r.remarks}”` : null,
    r.entryNo,
  ].filter(Boolean)
  return (
    <>
      <p className="text-[13px] font-semibold text-slate-900 flex items-baseline gap-1.5 flex-wrap">
        {r.itemName}
        {r.itemCode && <span className="font-mono text-[10px] font-normal text-slate-400">{r.itemCode}</span>}
      </p>
      {bits.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-0.5">{bits.join(' · ')}</p>
      )}
      {bucketOf(r.kind) === 'correction' && (
        <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
          {r.qty < 0 ? 'reduced' : 'increased'} by {formatQty(Math.abs(r.qty))} {r.unit}
        </p>
      )}
    </>
  )
}
