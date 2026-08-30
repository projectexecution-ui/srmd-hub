// The Verified BOQ, nested under a sub-category in the project tree — the
// HOD's point 8a. Same reading as the approval screen: description with its
// take-off underneath, then Unit / Qty / Rate / Amount, and the flag tint.
//
// Grouped by budget, because a sub-category can hold several. Each block names
// its sheet and stage, so "which of these am I looking at" is answered without
// opening anything.
//
// Management only. This is the line-by-line an approver checks; the sheet page
// keeps it behind `reviewer` for the same reason, and the project view is
// already management-only (engineers get EngineerProjectView).

import Link from 'next/link'
import { formatINR } from '@/lib/utils'
import { explainAdditions, type StoredLadder } from '@/lib/cost-control/additions'

export interface BoqRow {
  id: string
  rowNo: number | null
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  /** How the quantity was measured — the part that makes a row checkable. */
  sourceSheet: string | null
  sourceCell: string | null
  qtyFormula: string | null
  qtyBasis: string | null
  formulaInAmount: string | null
  rateBreakdown: { label: string; value: number }[] | null
  flagSeverity: string | null
  flagReason: string | null
}

export interface BoqSheet {
  wsId: string
  wsCode: string | null
  statusLabel: string
  /** Sum of the parsed rows. */
  rowsTotal: number
  /** The sheet's own figure — the one that gets approved. It is usually
   *  HIGHER than rowsTotal, because GST and contingency are folded into the
   *  total without being parsed as rows. */
  grandTotal: number
  /** Contingency / GST as saved at upload — null on older sheets, where the
   *  footer works the split out of the two totals instead. */
  ladder: StoredLadder | null
  rows: BoqRow[]
}

function tint(sev: string | null): string {
  if (sev === 'high') return 'bg-rose-50'
  if (sev === 'medium') return 'bg-amber-50'
  if (sev === 'low') return 'bg-yellow-50/60'
  return ''
}

/** The take-off line: how this quantity was arrived at. */
function TakeOff({ r }: { r: BoqRow }) {
  if (r.sourceCell) {
    return (
      <p className="text-[10.5px] text-emerald-700 font-mono truncate">
        🔗 {r.sourceSheet ? `${r.sourceSheet}!` : ''}{r.sourceCell}
      </p>
    )
  }
  if (r.qtyFormula) {
    return <p className="text-[10.5px] text-emerald-700 font-mono truncate" title={r.qtyFormula}>= {r.qtyFormula}</p>
  }
  if (r.qtyBasis === 'estimated') {
    return <p className="text-[10.5px] font-semibold text-amber-700">Estimate — no drawing</p>
  }
  return null
}

export function SubSkillBoq({ sheets }: { sheets: BoqSheet[] }) {
  if (sheets.length === 0) return null

  return (
    <div className="space-y-3">
      {sheets.map(sh => {
        const add = explainAdditions(sh.rowsTotal, sh.grandTotal, sh.ladder)
        return (
        <div key={sh.wsId} className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
            <span className="text-[12px] font-semibold text-gray-900">
              <Link href={`/cost-control/working-sheets/${sh.wsId}`} className="text-blue-700 hover:underline">
                {sh.wsCode ?? 'Budget'}
              </Link>
              <span className="ml-2 font-normal text-gray-500">{sh.statusLabel}</span>
            </span>
            <span className="text-[12px] font-bold tabular-nums text-gray-900">{formatINR(sh.grandTotal)}</span>
          </div>

          {/* Desktop: the same columns as the approval screen. */}
          <table className="w-full table-fixed text-[12px] hidden md:table">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="sticky top-[44px] z-[9] bg-white border-b border-gray-100 px-2 py-1.5 w-[4%]">#</th>
                <th className="sticky top-[44px] z-[9] bg-white border-b border-gray-100 px-2 py-1.5 w-[40%]">Description &amp; take-off</th>
                <th className="sticky top-[44px] z-[9] bg-white border-b border-gray-100 px-2 py-1.5 w-[8%]">Unit</th>
                <th className="sticky top-[44px] z-[9] bg-white border-b border-gray-100 px-2 py-1.5 text-right w-[13%]">Qty</th>
                <th className="sticky top-[44px] z-[9] bg-white border-b border-gray-100 px-2 py-1.5 text-right w-[17%]">Rate</th>
                <th className="sticky top-[44px] z-[9] bg-white border-b border-gray-100 px-2 py-1.5 text-right w-[18%]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sh.rows.map(r => (
                <tr key={r.id} className={`border-t border-gray-100 ${tint(r.flagSeverity)}`}>
                  <td className="px-2 py-1.5 text-gray-400 align-top">{r.rowNo ?? ''}</td>
                  <td className="px-2 py-1.5 text-gray-800 align-top">
                    <p className="truncate" title={r.description ?? ''}>{r.description ?? '—'}</p>
                    <TakeOff r={r} />
                    {r.formulaInAmount && (
                      <p className="text-[10.5px] text-gray-400 truncate font-mono">= {r.formulaInAmount}</p>
                    )}
                    {r.flagReason && (
                      <p className="text-[10.5px] font-semibold text-rose-700">{r.flagReason}</p>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 align-top">{r.unit ?? ''}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums align-top">
                    {r.qty != null ? r.qty.toLocaleString('en-IN') : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums align-top">
                    {r.rate != null ? formatINR(r.rate) : ''}
                    {r.rateBreakdown && r.rateBreakdown.length > 0 && (
                      <span className="block text-[10px] text-gray-400">
                        {r.rateBreakdown.map(b => `${b.label} ${formatINR(b.value)}`).join(' + ')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold align-top">
                    {r.amount != null ? formatINR(r.amount) : ''}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-200 bg-gray-50/70">
                <td />
                <td className="px-2 py-1.5 text-gray-600">Rows total</td>
                <td colSpan={3} />
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{formatINR(sh.rowsTotal)}</td>
              </tr>
              {/* GST and contingency are folded into the total without being
                  parsed as rows. Showing the rows alone would under-state the
                  budget by ~18-24%, so each addition gets its own named line
                  rather than being left for the reader to notice. */}
              {add?.lines.map((l, i) => (
                <tr key={i} className="bg-gray-50/70">
                  <td />
                  <td className={`px-2 py-1.5 ${add.source === 'overrun' ? 'text-amber-800' : 'text-gray-600'}`}>{l.label}</td>
                  <td colSpan={3} />
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                    {l.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(l.amount))}
                  </td>
                </tr>
              ))}
              {add?.note && (
                <tr className="bg-gray-50/70">
                  <td />
                  <td className="px-2 pb-1 text-[10px] text-gray-400" colSpan={5}>{add.note}</td>
                </tr>
              )}
              <tr className="border-t border-gray-300 bg-gray-100/70">
                <td />
                <td className="px-2 py-2 font-bold text-gray-900">Grand total (the approved figure)</td>
                <td colSpan={3} />
                <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(sh.grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          {/* Phone: six columns cannot survive 375px, so each row becomes a
              block — description and take-off, then the numbers on one line. */}
          <div className="md:hidden divide-y divide-gray-100">
            {sh.rows.map(r => (
              <div key={r.id} className={`px-3 py-2 ${tint(r.flagSeverity)}`}>
                <p className="text-[12.5px] text-gray-900">
                  <span className="text-gray-400 mr-1.5">{r.rowNo ?? ''}</span>
                  {r.description ?? '—'}
                </p>
                <TakeOff r={r} />
                {r.flagReason && <p className="text-[10.5px] font-semibold text-rose-700">{r.flagReason}</p>}
                <p className="mt-1 text-[11.5px] text-gray-600 tabular-nums">
                  {r.qty != null ? r.qty.toLocaleString('en-IN') : '—'}
                  {r.unit ? ` ${r.unit}` : ''}
                  <span className="mx-1 text-gray-300">×</span>
                  {r.rate != null ? formatINR(r.rate) : '—'}
                  <span className="mx-1 text-gray-300">=</span>
                  <b className="text-gray-900">{r.amount != null ? formatINR(r.amount) : '—'}</b>
                </p>
              </div>
            ))}
            <div className="px-3 py-2 bg-gray-50/70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-gray-600">Rows total</span>
                <span className="text-[12px] tabular-nums text-gray-700">{formatINR(sh.rowsTotal)}</span>
              </div>
              {add?.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className={`text-[12px] ${add.source === 'overrun' ? 'text-amber-800' : 'text-gray-600'}`}>{l.label}</span>
                  <span className="text-[12px] tabular-nums text-gray-700 flex-shrink-0">
                    {l.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(l.amount))}
                  </span>
                </div>
              ))}
              {add?.note && <p className="text-[10px] text-gray-400 leading-snug">{add.note}</p>}
              <div className="flex items-center justify-between border-t border-gray-200 pt-1">
                <span className="text-[12px] font-bold text-gray-900">Grand total</span>
                <span className="text-[13px] font-bold tabular-nums text-gray-900">{formatINR(sh.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>
        )
      })}
    </div>
  )
}
