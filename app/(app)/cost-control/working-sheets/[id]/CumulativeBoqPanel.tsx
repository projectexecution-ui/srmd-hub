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
  /** This version's GRAND total incl. GST + contingency (= ws.total_amount).
   *  The BOQ row amounts sum to the pre-GST subtotal only, so the footer needs
   *  this to show the real "amount to approve" (kept in sync with v1 + the
   *  cumulative strip). Falls back to the row subtotal when not supplied. */
  grandTotal?: number
  /** The previous approved version's grand total incl. GST (= its total_amount). */
  priorGrandTotal?: number
}

function QtyRate({ qty, rate }: { qty: number | null; rate: number | null }) {
  if (qty == null && rate == null) return <span className="text-gray-300">—</span>
  return (
    <span className="tabular-nums">
      {qty ?? '—'}<span className="text-gray-400"> @ </span>{rate != null ? formatINR(rate) : '—'}
    </span>
  )
}

export function CumulativeBoqPanel({ rows, summary, workingByKey = {}, grandTotal, priorGrandTotal }: Props) {
  const continuing = rows.filter(r => !r.isNew && !r.dropped)
  const fresh = rows.filter(r => r.isNew)
  const dropped = rows.filter(r => r.dropped)

  // The BOQ row amounts sum to the pre-GST subtotal. Everything the approver
  // acts on must be the GRAND total (incl. GST + contingency), matching v1 and
  // the cumulative strip. Grand totals come in from the version chain; if
  // absent we fall back to the subtotal so the panel still renders.
  const subtotal = summary.newAskTotal
  const gt = grandTotal ?? subtotal                 // this version, incl. GST
  const pgt = priorGrandTotal ?? summary.approvedTotal // prev approved, incl. GST
  const taxes = Math.max(gt - subtotal, 0)          // GST + contingency
  const newAsk = gt - pgt                            // new money this version, incl. GST

  const renderRow = (r: MatchedRow) => {
    const link = workingByKey[r.key]
    const qtyChanged = r.qtyDelta != null && r.qtyDelta !== 0
    // Highlight ANY row where qty or rate moved — that's what the approver checks.
    const changed = (r.rateChanged || qtyChanged) && !r.isNew && !r.dropped
    return (
      <tr key={r.key} className={`border-t border-gray-100 ${r.dropped ? 'opacity-50' : ''} ${changed ? 'bg-amber-50/50' : ''}`}>
        <td className="px-2 py-1.5">
          <span className={r.dropped ? 'line-through text-gray-500' : 'text-gray-900'}>{r.description}</span>
          {r.unit && <span className="ml-2 text-[10px] text-gray-400">{r.unit}</span>}
          {r.newBasis === 'estimated' && !r.dropped && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">
              <AlertTriangle className="h-3 w-3" /> estimate — no drawing
            </span>
          )}
          {r.basisPromoted && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1">
              ✓ estimate → measured
            </span>
          )}
          {r.possibleDoubleClaim && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-1">
              <AlertTriangle className="h-3 w-3" /> possible double claim
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right text-gray-500"><QtyRate qty={r.approvedQty} rate={r.approvedRate} /></td>
        <td className="px-2 py-1.5 text-right font-medium text-gray-900"><QtyRate qty={r.newQty} rate={r.newRate} /></td>
        <td className="px-2 py-1.5 text-right">
          {/* Show BOTH a rate move and a qty move when both happen — the
              approver must see each clearly (old → new). */}
          {r.isNew ? (
            <span className="text-[11px] font-semibold text-emerald-700">new item</span>
          ) : r.rateChanged || qtyChanged ? (
            <div className="space-y-0.5">
              {r.rateChanged && (
                <span className="block text-[11px] font-semibold text-amber-800 tabular-nums">
                  Rate {formatINR(r.rateOld ?? 0)} → {formatINR(r.rateNew ?? 0)}
                  <span className="block text-[10px] font-normal text-amber-600">
                    {r.rateChangeComponents.map(c => COMP_LABEL[c] ?? c).join(', ')} changed
                  </span>
                </span>
              )}
              {qtyChanged && (
                <span className={`block text-[11px] font-semibold tabular-nums ${r.qtyDelta! > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                  Qty {r.approvedQty ?? '—'} → {r.newQty ?? '—'}{' '}
                  <span className="font-normal">({r.qtyDelta! > 0 ? '+' : ''}{r.qtyDelta})</span>
                </span>
              )}
            </div>
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

  // Mobile card for one row (the table is too wide for a phone).
  const renderCard = (r: MatchedRow) => {
    const link = workingByKey[r.key]
    const qtyChanged = r.qtyDelta != null && r.qtyDelta !== 0
    const changed = (r.rateChanged || qtyChanged) && !r.isNew && !r.dropped
    return (
      <div key={r.key} className={`px-4 py-3 ${r.dropped ? 'opacity-60' : ''} ${changed ? 'bg-amber-50/40' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm min-w-0">
            <span className={r.dropped ? 'line-through text-gray-500' : 'text-gray-900'}>{r.description}</span>
            {r.unit && <span className="ml-1.5 text-[10px] text-gray-400">{r.unit}</span>}
          </p>
          <span className="text-sm font-semibold tabular-nums flex-shrink-0 text-gray-900">
            {r.newAmount != null ? formatINR(r.newAmount) : <span className="text-gray-300">dropped</span>}
          </span>
        </div>
        {(r.isNew || (r.newBasis === 'estimated' && !r.dropped) || r.basisPromoted || r.possibleDoubleClaim) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {r.isNew && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1">new item</span>}
            {r.newBasis === 'estimated' && !r.dropped && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1"><AlertTriangle className="h-3 w-3" /> estimate</span>}
            {r.basisPromoted && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1">✓ est → measured</span>}
            {r.possibleDoubleClaim && <span className="inline-flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-1"><AlertTriangle className="h-3 w-3" /> double claim?</span>}
          </div>
        )}
        {!r.isNew && !r.dropped && (
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-500">Approved {r.approvedQty ?? '—'} @ {r.approvedRate != null ? formatINR(r.approvedRate) : '—'}</span>
            <span className="text-gray-800 font-medium">Now {r.newQty ?? '—'} @ {r.newRate != null ? formatINR(r.newRate) : '—'}</span>
          </div>
        )}
        {r.rateChanged && (
          <p className="mt-0.5 text-[11px] font-semibold text-amber-800">
            Rate {formatINR(r.rateOld ?? 0)} → {formatINR(r.rateNew ?? 0)}
            <span className="font-normal text-amber-600"> ({r.rateChangeComponents.map(c => COMP_LABEL[c] ?? c).join(', ')})</span>
          </p>
        )}
        {qtyChanged && (
          <p className={`mt-0.5 text-[11px] font-semibold ${r.qtyDelta! > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
            Qty {r.approvedQty ?? '—'} → {r.newQty ?? '—'} ({r.qtyDelta! > 0 ? '+' : ''}{r.qtyDelta})
          </p>
        )}
        {link?.url && (
          <a href={link.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-indigo-600"><Paperclip className="h-3 w-3" /> working file</a>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 flex-wrap">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Cumulative BOQ — approved vs this ask</p>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold">
            <span className="inline-flex items-center gap-1 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{summary.measuredCount} measured</span>
            {summary.estimateCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{summary.estimateCount} estimate{summary.estimateCount > 1 ? 's' : ''} (no drawing)</span>
            )}
            {summary.promotedCount > 0 && <span className="text-emerald-700">· {summary.promotedCount} → measured this version</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            {summary.continuingCount} carried · {summary.newCount} new · {summary.rateChangedCount} rate change{summary.rateChangedCount === 1 ? '' : 's'}
            {summary.droppedCount > 0 ? ` · ${summary.droppedCount} dropped` : ''}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto hidden md:block">
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
            {/* Breakdown of THIS version — the exact components so the approver
                sees what makes up the amount (not just an added-up number). */}
            <tr>
              <td className="px-2 py-1.5 text-right text-gray-500" colSpan={4}>Subtotal (BOQ items)</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatINR(subtotal)}</td>
              <td></td>
            </tr>
            {taxes > 0.5 && (
              <tr>
                <td className="px-2 py-1.5 text-right text-gray-500" colSpan={4}>+ GST &amp; contingency</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatINR(taxes)}</td>
                <td></td>
              </tr>
            )}
            <tr>
              <td className="px-2 py-2 text-right font-semibold text-gray-800" colSpan={4}>This version total (incl. GST)</td>
              <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(gt)}</td>
              <td></td>
            </tr>
            {/* Cumulative comparison — all figures incl. GST. */}
            <tr>
              <td className="px-2 py-2 text-right text-gray-600 border-t border-gray-200" colSpan={4}>Already approved (previous version, incl. GST)</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700 border-t border-gray-200">{formatINR(pgt)}</td>
              <td className="border-t border-gray-200"></td>
            </tr>
            <tr className="bg-indigo-50/60">
              <td className="px-2 py-2 text-right font-bold text-indigo-800" colSpan={4}>➜ New in this request (to approve now, incl. GST)</td>
              <td className="px-2 py-2 text-right font-bold text-lg tabular-nums text-indigo-800">
                {newAsk < 0 ? `−${formatINR(Math.abs(newAsk))}` : formatINR(newAsk)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile: stacked cards (the panel top bar above already carries the
          measured/estimate + counts summary). */}
      <div className="md:hidden">
        <div className="divide-y divide-gray-100">
          {continuing.map(renderCard)}
          {fresh.length > 0 && <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Newly added in this version</p>}
          {fresh.map(renderCard)}
          {dropped.length > 0 && <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Dropped from the approved BOQ</p>}
          {dropped.map(renderCard)}
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500 text-xs"><span>Subtotal (BOQ items)</span><span className="tabular-nums">{formatINR(subtotal)}</span></div>
          {taxes > 0.5 && <div className="flex justify-between text-gray-500 text-xs"><span>+ GST &amp; contingency</span><span className="tabular-nums">{formatINR(taxes)}</span></div>}
          <div className="flex justify-between font-semibold text-gray-900"><span>This version total (incl. GST)</span><span className="tabular-nums">{formatINR(gt)}</span></div>
          <div className="flex justify-between text-gray-600 text-xs border-t border-gray-200 pt-1"><span>Already approved (prev version)</span><span className="tabular-nums">{formatINR(pgt)}</span></div>
          <div className="flex justify-between font-bold text-indigo-800"><span>➜ New to approve now (incl. GST)</span><span className="tabular-nums">{newAsk < 0 ? `−${formatINR(Math.abs(newAsk))}` : formatINR(newAsk)}</span></div>
        </div>
      </div>
    </div>
  )
}
