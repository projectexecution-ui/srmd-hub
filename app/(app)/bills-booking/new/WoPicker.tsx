'use client'

import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import type { PickableWo } from '@/lib/bills-booking/wo-picker'

/** Find the work order by typing, not by drilling.
 *
 *  There are 2,181 work orders. A project dropdown feeding a work-order
 *  dropdown means two choices and a scroll, and it needs the project answered
 *  before you can even look — when the thing in the person's hand is a bill
 *  with a WO number printed on it. So: one box, type any part of the number or
 *  the contractor, pick from what matches.
 *
 *  The project is then a fact IN4 tells us, not a question we ask twice. */
export function WoPicker({ wos, picked, onPick, projectNames }: {
  wos: PickableWo[]
  picked: PickableWo | null
  onPick: (w: PickableWo | null) => void
  /** IN4 project names, used only to say which building a match belongs to
   *  while somebody is still choosing between several. */
  projectNames: Map<number, string>
}) {
  const [q, setQ] = useState('')

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    return wos
      .filter(w => w.woNo.toLowerCase().includes(needle) || w.contractor.toLowerCase().includes(needle))
      .slice(0, 12)
  }, [wos, q])

  if (picked) {
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold">{picked.woNo}</div>
            {/* Where it books is NOT repeated here — the panel below it carries
                the sub-project, the CT Hub project and the Atm Head, all read
                off this work order. */}
            <div className="text-xs text-gray-600">{picked.contractor || 'contractor not named in IN4'}</div>
          </div>
          <button type="button" onClick={() => { onPick(null); setQ('') }}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 min-h-[32px]">
            <X className="h-3.5 w-3.5" /> Change
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <Fact k="Ordered incl. GST" v={formatINR(picked.orderedGross)} />
          <Fact k="Billed so far" v={formatINR(picked.billedGross)} />
          <Fact k="Balance to bill" v={formatINR(picked.balance)} strong />
          <Fact k="Retention" v={picked.retentionPct == null ? 'no bills yet' : `${picked.retentionPct}%`} />
          <Fact k="Trust" v={picked.trust ?? '—'} />
          <Fact k="Bills so far" v={String(picked.bills)} />
          <Fact k="Last bill no." v={picked.lastBillNo ?? '—'} />
          <Fact k="WO status" v={picked.status ?? '—'} />
        </dl>

        {picked.balance === 0 && (
          <p className="mt-2.5 text-[11px] font-semibold text-red-700">
            Fully billed. Anything further needs an amendment in IN4 first — it will be flagged either way.
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <Label htmlFor="wosearch">Work order</Label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input id="wosearch" value={q} onChange={e => setQ(e.target.value)} className="pl-9"
               placeholder="Type the WO number or the contractor — e.g. SQ/2026 or Amin" autoComplete="off" />
      </div>

      {q.trim().length >= 2 && (
        matches.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            Nothing in IN4 matches that. Check the number, or tick <b>no work order yet</b> below if it has not been raised.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {matches.map(w => (
              <li key={w.woId}>
                <button type="button" onClick={() => { onPick(w); setQ('') }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-indigo-50 min-h-[44px]">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{w.woNo}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {w.contractor || '—'}
                      {w.projectId != null && projectNames.get(w.projectId) ? ` · ${projectNames.get(w.projectId)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs tabular-nums font-medium">{formatINR(w.balance)}</span>
                    <span className="block text-[10.5px] text-gray-400">left to bill</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{v}</dd>
    </div>
  )
}
