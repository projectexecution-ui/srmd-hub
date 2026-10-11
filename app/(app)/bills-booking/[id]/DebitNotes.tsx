// "Debit notes on this work order" — only drawn when the order has one
// (Aksha, 11 Oct 2026: "Debit note is not necessary all bills have"). The
// same lines on every note, so it reads the same on a phone.

import { TriangleAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatDate, formatINR } from '@/lib/utils'
import type { DebitNotes as DN } from '@/lib/bills-booking/debit-notes'

export function DebitNotes({ data, warn }: {
  data: DN
  /** The bill is still being checked — say plainly that the balance should come off it. */
  warn: boolean
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70">
        <p className="text-sm font-bold text-gray-900">Debit notes on this work order</p>
        <p className="text-xs text-gray-600 mt-0.5 tabular-nums">
          {data.notes.length} in IN4 · raised {formatINR(data.raised)} · recovered {formatINR(data.recovered)}
          {data.open > 0 && <b className="text-amber-800"> · {formatINR(data.open)} still to recover</b>}
        </p>
        {warn && data.open > 0 && (
          <p className="mt-2 inline-flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">
            <TriangleAlert className="mt-px h-3.5 w-3.5 flex-shrink-0" />
            <span>{formatINR(data.open)} of debit notes is not yet recovered from this contractor. See that this bill deducts it in IN4, or say why not.</span>
          </p>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        {data.notes.map(n => (
          <div key={n.id} className="px-4 py-3 space-y-0.5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span className="font-mono text-[12px] text-gray-800">{n.no}</span>
              <span className="text-[13px] font-bold tabular-nums text-gray-900">{formatINR(n.amount)}</span>
            </div>
            <p className="text-[12px] text-gray-600">
              {n.date ? formatDate(n.date) : '—'}{n.reason ? ` · ${n.reason}` : ''}{n.pending ? ' · awaiting approval in IN4' : ''}
            </p>
            {n.remarks && <p className="text-[12px] text-gray-700">{n.remarks}</p>}
            <p className={`text-[12px] tabular-nums ${n.balance > 0 ? 'text-amber-800 font-semibold' : 'text-emerald-700'}`}>
              {n.balance > 0
                ? `${formatINR(n.balance)} still to recover${n.recovered > 0 ? ` (${formatINR(n.recovered)} recovered)` : ''}`
                : 'Recovered in full'}
              {n.recoveredOn.length > 0 && (
                <span className="font-normal text-gray-500">
                  {' '}— on {n.recoveredOn.map(r => `${r.certNo ?? 'a bill'}${r.billNo ? ` (bill ${r.billNo})` : ''} ${formatINR(r.amount)}`).join(', ')}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}
