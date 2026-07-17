'use client'
// Verify-and-fix grid for a standard-template upload. Shows every parsed row
// with its recomputed Rate/Amount and precise per-row errors, lets the
// engineer fix qty/rate/unit, add or delete rows, and reconciles the whole
// ladder against the amount they're asking approval for — all BEFORE the
// draft sheet is created, so nothing needs unlocking later.

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { evaluateItem, computeLadder, reconcileAgainstClaim } from '@/lib/cost-control/boq-template-parse'
import { BOQ_UNITS } from '@/lib/cost-control/boq-template'

export interface EditableGridRow {
  key: string
  isHeading: boolean
  description: string
  unit: string
  qty: number | null
  material: number | null
  installation: number | null
  ml: number | null
  remarks: string
}

export interface GridSummary {
  subtotal: number
  contingency: number
  gst: number
  grandTotal: number
  hardErrors: number
  reconciledToClaim: boolean
}

interface Props {
  rows: EditableGridRow[]
  onRowsChange: (rows: EditableGridRow[]) => void
  contingencyPct: number | null
  gstPct: number | null
  onPctChange: (which: 'cont' | 'gst', v: number | null) => void
  claimedTotal: number | null
  onSummary: (s: GridSummary) => void
}

const numOrNull = (v: string): number | null => {
  if (v.trim() === '') return null
  const n = Number(v.replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function TemplateReviewGrid({
  rows, onRowsChange, contingencyPct, gstPct, onPctChange, claimedTotal, onSummary,
}: Props) {
  const evals = rows.map(r =>
    r.isHeading
      ? { rate: 0, amount: 0, errors: [] as string[], warnings: [] as string[] }
      : evaluateItem(r),
  )
  const itemAmounts = rows.map((r, i) => (r.isHeading ? 0 : evals[i].amount)).filter((_, i) => !rows[i].isHeading)
  const ladder = computeLadder(itemAmounts, contingencyPct, gstPct)
  const hardErrors = evals.reduce((s, e) => s + e.errors.length, 0)
  const claim = reconcileAgainstClaim(ladder.grandTotal, claimedTotal)

  // Report the rolled-up summary up to the parent (for the submit gate).
  React.useEffect(() => {
    onSummary({
      subtotal: ladder.subtotal, contingency: ladder.contingency, gst: ladder.gst,
      grandTotal: ladder.grandTotal, hardErrors, reconciledToClaim: claim.ok,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder.grandTotal, ladder.subtotal, ladder.contingency, ladder.gst, hardErrors, claim.ok])

  function update(idx: number, patch: Partial<EditableGridRow>) {
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function remove(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx))
  }
  function addItem() {
    onRowsChange([...rows, {
      key: 'new-' + rows.length + '-' + Math.floor(ladder.grandTotal + rows.length),
      isHeading: false, description: '', unit: 'Cum', qty: null,
      material: null, installation: null, ml: null, remarks: '',
    }])
  }

  const cellCls = 'h-8 text-right tabular-nums px-1'

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">Check &amp; fix the rows</span>
        <span className={`text-xs font-medium ${hardErrors ? 'text-rose-700' : 'text-emerald-700'}`}>
          {hardErrors ? `${hardErrors} thing${hardErrors > 1 ? 's' : ''} to fix` : 'All rows look good'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
            <tr>
              <th className="px-2 py-1.5 text-left w-8">#</th>
              <th className="px-2 py-1.5 text-left min-w-[180px]">Description</th>
              <th className="px-2 py-1.5 text-left w-20">Unit</th>
              <th className="px-2 py-1.5 text-right w-20">Qty</th>
              <th className="px-2 py-1.5 text-right w-24" title="Leave empty if using M+L">Material</th>
              <th className="px-2 py-1.5 text-right w-24" title="Leave empty if using M+L">Install.</th>
              <th className="px-2 py-1.5 text-right w-24" title="Combined — leave empty if using split">M+L</th>
              <th className="px-2 py-1.5 text-right w-24">Rate</th>
              <th className="px-2 py-1.5 text-right w-28">Amount</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const ev = evals[idx]
              if (r.isHeading) {
                return (
                  <tr key={r.key} className="border-t border-gray-100 bg-gray-50/60">
                    <td className="px-2 py-1.5 text-gray-400">—</td>
                    <td className="px-2 py-1.5 font-semibold text-gray-700" colSpan={8}>
                      <Input value={r.description} onChange={e => update(idx, { description: e.target.value })}
                        className="h-8 font-semibold" placeholder="Section heading" />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button type="button" onClick={() => remove(idx)} className="text-rose-600 hover:bg-rose-50 rounded p-1">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              }
              return (
                <React.Fragment key={r.key}>
                  <tr className={`border-t border-gray-100 ${ev.errors.length ? 'bg-rose-50/40' : ''}`}>
                    <td className="px-2 py-1.5 text-gray-500 tabular-nums">{r.key.startsWith('new-') ? '+' : idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Input value={r.description} onChange={e => update(idx, { description: e.target.value })}
                        className="h-8" placeholder="e.g. RCC M25 footings" />
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={r.unit} onChange={e => update(idx, { unit: e.target.value })}
                        className="h-8 w-full rounded-md border border-gray-300 bg-white px-1 text-sm">
                        {!BOQ_UNITS.includes(r.unit as typeof BOQ_UNITS[number]) && r.unit && <option value={r.unit}>{r.unit}</option>}
                        {BOQ_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={r.qty ?? ''} onChange={e => update(idx, { qty: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={r.material ?? ''} onChange={e => update(idx, { material: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={r.installation ?? ''} onChange={e => update(idx, { installation: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={r.ml ?? ''} onChange={e => update(idx, { ml: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatINR(ev.rate)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-900">{formatINR(ev.amount)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button type="button" onClick={() => remove(idx)} className="text-rose-600 hover:bg-rose-50 rounded p-1">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  {(ev.errors.length > 0 || ev.warnings.length > 0) && (
                    <tr className={ev.errors.length ? 'bg-rose-50/40' : ''}>
                      <td></td>
                      <td colSpan={9} className="px-2 pb-1.5">
                        {ev.errors.map((e, i) => (
                          <span key={'e' + i} className="inline-flex items-center gap-1 text-[11px] text-rose-700 mr-3">
                            <AlertTriangle className="h-3 w-3" /> {e}
                          </span>
                        ))}
                        {ev.warnings.map((w, i) => (
                          <span key={'w' + i} className="inline-flex items-center gap-1 text-[11px] text-amber-700 mr-3">
                            <AlertTriangle className="h-3 w-3" /> {w}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50 text-sm">
            <tr>
              <td colSpan={7} className="px-2 py-1.5 text-right text-gray-600">Subtotal</td>
              <td></td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatINR(ladder.subtotal)}</td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={6} className="px-2 py-1.5 text-right text-gray-600">Contingency</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  <Input value={contingencyPct ?? ''} onChange={e => onPctChange('cont', numOrNull(e.target.value))}
                    className="h-7 w-14 text-right tabular-nums" inputMode="decimal" />
                  <span className="text-gray-500">%</span>
                </div>
              </td>
              <td></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatINR(ladder.contingency)}</td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={6} className="px-2 py-1.5 text-right text-gray-600">GST</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  <Input value={gstPct ?? ''} onChange={e => onPctChange('gst', numOrNull(e.target.value))}
                    className="h-7 w-14 text-right tabular-nums" inputMode="decimal" />
                  <span className="text-gray-500">%</span>
                </div>
              </td>
              <td></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatINR(ladder.gst)}</td>
              <td></td>
            </tr>
            <tr className="border-t border-gray-200">
              <td colSpan={7} className="px-2 py-2 text-right font-semibold text-gray-800">Grand total</td>
              <td></td>
              <td className="px-2 py-2 text-right font-bold text-lg tabular-nums text-gray-900">{formatINR(ladder.grandTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between gap-3">
        <Button type="button" size="sm" variant="outline" onClick={addItem}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add item
        </Button>
        {claimedTotal != null && claimedTotal > 0 && (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${claim.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {claim.ok
              ? <><CheckCircle2 className="h-4 w-4" /> Matches your approval amount</>
              : <><AlertTriangle className="h-4 w-4" /> Off by {formatINR(Math.abs(claim.diff))} vs your approval amount</>}
          </span>
        )}
      </div>
    </div>
  )
}
