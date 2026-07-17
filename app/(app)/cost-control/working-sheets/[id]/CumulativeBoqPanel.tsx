// Per-line cumulative BOQ (cc_cumulative_versions). For a revision it shows,
// for every item: the qty/rate ALREADY APPROVED vs what's asked NOW, with rate
// changes highlighted (old → new + which component moved), brand-new items
// grouped below, and dropped items muted. A paperclip on a changed row opens
// the working file it's linked to. Presentational — no client JS.

import { formatINR } from '@/lib/utils'
import { Paperclip, AlertTriangle } from 'lucide-react'
import type { MatchedRow, MatchSummary } from '@/lib/cost-control/version-ledger'

const COMP_LABEL: Record<string, string> = {
  material: 'Material', installation: 'Installation', ml: 'M+L', rate: 'Rate',
}

interface Props {
  rows: MatchedRow[]
  summary: MatchSummary
  /** row.key → { url, name } of the working file the row is linked to. */
  workingByKey?: Record<string, { url: string | null; name: string } | undefined>
}

function QtyRate({ qty, rate }: { qty: number | null; rate: number | null }) {
  if (qty == null && rate == null) return <span className="text-gray-300">—</span>
  return (
    <span className="tabular-nums">
      {qty ?? '—'}<span className="text-gray-400"> @ </span>{rate != null ? formatINR(rate) : '—'}
    </span>
  )
}

export function CumulativeBoqPanel({ rows, summary, workingByKey = {} }: Props) {
  const continuing = rows.filter(r => !r.isNew && !r.dropped)
  const fresh = rows.filter(r => r.isNew)
  const dropped = rows.filter(r => r.dropped)

  const renderRow = (r: MatchedRow) => {
    const link = workingByKey[r.key]
    return (
      <tr key={r.key} className={`border-t border-gray-100 ${r.dropped ? 'opacity-50' : ''} ${r.rateChanged ? 'bg-amber-50/50' : ''}`}>
        <td className="px-2 py-1.5">
          <span className={r.dropped ? 'line-through text-gray-500' : 'text-gray-900'}>{r.description}</span>
          {r.possibleDoubleClaim && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-1">
              <AlertTriangle className="h-3 w-3" /> possible double claim
            </span>
          )}
          {r.unit && <span className="ml-2 text-[10px] text-gray-400">{r.unit}</span>}
        </td>
        <td className="px-2 py-1.5 text-right text-gray-500"><QtyRate qty={r.approvedQty} rate={r.approvedRate} /></td>
        <td className="px-2 py-1.5 text-right font-medium text-gray-900"><QtyRate qty={r.newQty} rate={r.newRate} /></td>
        <td className="px-2 py-1.5 text-right">
          {r.rateChanged ? (
            <span className="text-[11px] text-amber-800">
              {formatINR(r.rateOld ?? 0)} → {formatINR(r.rateNew ?? 0)}
              <span className="block text-[10px] text-amber-600">
                {r.rateChangeComponents.map(c => COMP_LABEL[c] ?? c).join(', ')} changed
              </span>
            </span>
          ) : r.qtyDelta != null && r.qtyDelta !== 0 ? (
            <span className={`text-[11px] ${r.qtyDelta > 0 ? 'text-amber-800' : 'text-emerald-700'} tabular-nums`}>
              {r.qtyDelta > 0 ? '+' : ''}{r.qtyDelta} qty
            </span>
          ) : (
            <span className="text-[11px] text-gray-400">unchanged</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-900">
          {r.newAmount != null ? formatINR(r.newAmount) : <span className="text-gray-300">dropped</span>}
        </td>
        <td className="px-2 py-1.5 text-center w-8">
          {link?.url && (
            <a href={link.url} target="_blank" rel="noreferrer" title={`Working: ${link.name}`} className="text-indigo-600 hover:text-indigo-800 inline-flex">
              <Paperclip className="h-3.5 w-3.5" />
            </a>
          )}
        </td>
      </tr>
    )
  }

  const sectionHead = (label: string, tone: string) => (
    <tr className={`text-[10px] uppercase tracking-wide ${tone}`}>
      <td colSpan={6} className="px-2 pt-3 pb-1 font-bold">{label}</td>
    </tr>
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Cumulative BOQ — approved vs this ask</p>
        <p className="text-[11px] text-gray-500">
          {summary.continuingCount} carried · {summary.newCount} new · {summary.rateChangedCount} rate change{summary.rateChangedCount === 1 ? '' : 's'}
          {summary.droppedCount > 0 ? ` · ${summary.droppedCount} dropped` : ''}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
            <tr>
              <th className="px-2 py-1.5 text-left min-w-[200px]">Item</th>
              <th className="px-2 py-1.5 text-right w-32">Approved (qty @ rate)</th>
              <th className="px-2 py-1.5 text-right w-32">Now (qty @ rate)</th>
              <th className="px-2 py-1.5 text-right w-32">Change</th>
              <th className="px-2 py-1.5 text-right w-28">Amount now</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {continuing.map(renderRow)}
            {fresh.length > 0 && sectionHead('Newly added in this version', 'text-emerald-700')}
            {fresh.map(renderRow)}
            {dropped.length > 0 && sectionHead('Dropped from the approved BOQ', 'text-gray-400')}
            {dropped.map(renderRow)}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td className="px-2 py-2 text-right text-gray-600" colSpan={4}>Approved so far</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{formatINR(summary.approvedTotal)}</td>
              <td></td>
            </tr>
            <tr>
              <td className="px-2 py-2 text-right font-semibold text-gray-800" colSpan={4}>This version total</td>
              <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(summary.newAskTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
