'use client'
// The Excel Budget Request, read back: the Verified BOQ (the parser's
// row-by-row reading of the uploaded template) with the decision under it.
//
// Redesigned 23 Sep 2026 with Aksha ("lot of things … clutter"). Gone from
// here: the file card (the header row has Download Excel; the Files card has
// the file), the three tiles, the "this is the approved figure" sentence, the
// AI composition fold, the Flag column when nothing is flagged, the
// explanatory paragraph under the title, the take-off lines under every row.
// What stays is the table, quieter and correct, and the approval block moved
// BELOW it — an approver reads the working, then decides.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCcw, Loader2, AlertTriangle, TrendingDown, TrendingUp, Sigma, Sparkles } from 'lucide-react'
import { WSApprovalActions, type SignOffCfg } from '@/components/cost-control/WSApprovalActions'
import type { WSApprovalContext } from '@/components/cost-control/ws-actions'
import type { WSStatus } from '@/components/cost-control/WSStatusPill'
import { formatINR } from '@/lib/utils'
import { explainAdditions, type StoredLadder } from '@/lib/cost-control/additions'

interface Breakdown { label: string; value: number }

interface Row {
  id: string
  row_no: number
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
  rate_breakdown: Breakdown[] | null
  amount_breakdown: Breakdown[] | null
  ai_meta: {
    category?: 'material' | 'labour' | 'material_and_labour' | 'equipment' | 'tax' | 'addon' | 'discount' | null
  } | null
  flag: string | null
  flag_reason: string | null
  flag_severity: string | null
  qty_formula?: string | null
  qty_basis?: string | null
  source_sheet?: string | null
  source_cell?: string | null
}

interface FlagSummary {
  generated_at: string
  total_rows: number
  flagged_rows: number
  by_flag: Record<string, number>
  narrative: string | null
  ai_used: boolean
  ai_error: string | null
}

/** The parser labels the template's two rate columns "M+L" and "Rate" —
 *  under a Rate of ₹2,060 that read "M+L ₹1,030 + Rate ₹1,030", which is
 *  nonsense. When the breakdown is exactly those two labels and they add up to
 *  the rate, they ARE the Material and Labour halves of the template's
 *  Rate = M + L; write them as such. Any other breakdown is shown as stored. */
function rateParts(b: Breakdown[] | null, rate: number | null): string | null {
  if (!b || b.length === 0) return null
  if (b.length === 2 && rate != null) {
    const labels = b.map(x => x.label.trim().toLowerCase())
    const sum = b[0].value + b[1].value
    if (labels.includes('m+l') && labels.includes('rate') && Math.abs(sum - rate) < 1) {
      return `M ${formatINR(b[0].value)} + L ${formatINR(b[1].value)}`
    }
  }
  return b.map(x => `${x.label} ${formatINR(x.value)}`).join(' + ')
}

/** A percentage row (Contingency, GST) stores its % in `rate`; "₹18" for GST
 *  was defect 5 on Aksha's list. */
function isPercentRow(r: Row): boolean {
  const d = (r.description ?? '').toLowerCase()
  return (r.qty == null || r.qty === 0) && (/\b(gst|cgst|sgst|igst|cess|vat|contingenc|tax)\b/.test(d))
}

export function ExcelSummaryPanel({
  wsId, status, ctx, reviewer, aiEnabled = true, signOffCfg, totalAmount, approvedSoFar, chainReleasedSoFar,
  summaryTotal, summaryNotes, flagSummary, rows, grandTotal, ladder,
}: {
  wsId: string
  status: WSStatus
  ctx: WSApprovalContext
  chainReleasedSoFar?: number
  reviewer: boolean
  aiEnabled?: boolean
  signOffCfg?: SignOffCfg
  totalAmount: number
  approvedSoFar: number
  /** Kept in the props for the callers; the header row carries the download now. */
  fileName?: string | null
  downloadUrl?: string | null
  lastCheckedAt?: string | null
  summaryTotal: number | null
  summaryNotes: string | null
  flagSummary: FlagSummary | null
  rows: Row[]
  grandTotal?: number
  ladder?: StoredLadder | null
}) {
  const router = useRouter()
  const [rechecking, setRechecking] = useState(false)
  const [takeoff, setTakeoff] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const showFlags = reviewer && aiEnabled

  // Real lines only: drop the template's empty numbered placeholders and the
  // pure aggregate rows (SUM / grand total) — the footer already shows those.
  const visibleRows = rows.filter(r => {
    const descTrim = (r.description ?? '').trim()
    const noMoney = (r.amount == null || r.amount === 0) && (r.qty == null || r.qty === 0) && (r.rate == null || r.rate === 0)
    if (noMoney && (descTrim === '' || /^\d+$/.test(descTrim))) return false
    if (descTrim === '' && r.formula_in_amount) return false
    return true
  })
  const anyFlag = showFlags && visibleRows.some(r => r.flag)
  const lineRows = visibleRows.filter(r => !isPercentRow(r))
  const pctRows = visibleRows.filter(r => isPercentRow(r))

  async function recheck() {
    setRechecking(true); setErr(null)
    try {
      const r = await fetch(`/api/cost-control/working-sheets/${wsId}/check`, { method: 'POST' })
      if (!r.ok) throw new Error()
      router.refresh()
    } catch {
      setErr('Couldn\'t re-check the sheet — please try again.')
    } finally {
      setRechecking(false)
    }
  }

  const rowsSum = lineRows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const gt = grandTotal ?? summaryTotal ?? visibleRows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const add = explainAdditions(rowsSum, gt, ladder)

  const takeoffLine = (r: Row) => r.source_cell
    ? <p className="text-[11px] text-emerald-700 font-mono truncate">🔗 {r.source_sheet ? `${r.source_sheet}!` : ''}{r.source_cell}</p>
    : r.qty_formula
      ? <p className="text-[11px] text-emerald-700 font-mono truncate" title={r.qty_formula}>Qty = {r.qty_formula}</p>
      : r.qty_basis === 'estimated'
        ? <p className="text-[11px] font-semibold text-amber-700">Estimate — no drawing</p>
        : null

  const rateCell = (r: Row) => {
    if (isPercentRow(r)) return r.rate != null ? `${r.rate.toLocaleString('en-IN')} %` : ''
    return r.rate != null ? formatINR(r.rate) : ''
  }

  return (
    <div className="space-y-4">
      {/* Analysis — the checker's flags, reviewers only, folded. */}
      {showFlags && flagSummary && (
        <details className="rounded-xl border border-gray-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-gray-900 inline-flex items-center gap-2 w-full">
            <Sparkles className="h-4 w-4 text-indigo-600" /> Analysis
            <span className="ml-auto text-[11px] font-medium text-gray-500">
              {flagSummary.flagged_rows === 0 ? 'nothing flagged' : `${flagSummary.flagged_rows} row${flagSummary.flagged_rows === 1 ? '' : 's'} flagged`}
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(flagSummary.by_flag).map(([flag, n]) => (
                <Badge key={flag} className={flagClass(flag)}>{flagIcon(flag)}{flagLabel(flag)} · {n}</Badge>
              ))}
              {flagSummary.flagged_rows === 0 && <Badge className="bg-emerald-100 text-emerald-800">No flags — looks clean</Badge>}
            </div>
            {flagSummary.narrative && (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-sm text-gray-800 whitespace-pre-line">{flagSummary.narrative}</div>
            )}
            {!flagSummary.ai_used && (
              <p className="text-xs text-gray-500 italic">AI narrative skipped {flagSummary.ai_error ? `(error: ${flagSummary.ai_error})` : '— set GEMINI_API_KEY on Vercel to enable.'}</p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={recheck} disabled={rechecking}>
                {rechecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Re-check
              </Button>
              {err && <span className="text-xs text-rose-700">{err}</span>}
            </div>
          </div>
        </details>
      )}

      {/* Verified BOQ — reviewers only (engineers upload and submit; the
          table is the approver's reading aid). */}
      {reviewer && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Verified BOQ</h3>
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={takeoff} onChange={e => setTakeoff(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
              take-off
            </label>
          </div>
          {summaryNotes && (
            <p className="px-4 py-2 text-xs text-gray-600 border-b border-gray-100 whitespace-pre-line"><span className="text-gray-400">Engineer&rsquo;s note · </span>{summaryNotes}</p>
          )}

          {/* Desktop table */}
          <div className="overflow-x-auto hidden md:block">
            <table className="min-w-full text-[13px]">
              <thead className="text-left text-[10.5px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 w-10 font-semibold"></th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 font-semibold">Unit</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  {anyFlag && <th className="px-3 py-2 font-semibold">Flag</th>}
                </tr>
              </thead>
              <tbody>
                {lineRows.map(r => (
                  <tr key={r.id} className={`border-t border-gray-100 ${showFlags && r.flag ? rowTintBySeverity(r.flag_severity) : ''}`}>
                    <td className="px-3 py-2 text-gray-400 align-top tabular-nums">{r.row_no}</td>
                    <td className="px-3 py-2 text-gray-900 max-w-md align-top">
                      <p className="truncate" title={r.description ?? ''}>{r.description ?? '—'}</p>
                      {takeoff && takeoffLine(r)}
                      {takeoff && r.formula_in_amount && <p className="text-[11px] text-gray-400 truncate font-mono">= {r.formula_in_amount}</p>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 align-top">{r.unit ?? ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums align-top">{r.qty != null ? r.qty.toLocaleString('en-IN') : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums align-top">
                      {rateCell(r)}
                      {(() => { const p = rateParts(r.rate_breakdown, r.rate); return p ? <div className="text-[10.5px] text-gray-400 font-normal">{p}</div> : null })()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums align-top">
                      {r.amount != null ? formatINR(r.amount) : ''}
                      {r.amount_breakdown && r.amount_breakdown.length > 0 && (
                        <div className="text-[10.5px] text-gray-400 font-normal">{r.amount_breakdown.map(b => `${b.label} ${formatINR(b.value)}`).join(' + ')}</div>
                      )}
                    </td>
                    {anyFlag && (
                      <td className="px-3 py-2 max-w-xs align-top">
                        {r.flag && (
                          <div className="space-y-0.5">
                            <Badge className={flagClass(r.flag)}>{flagIcon(r.flag)}{flagLabel(r.flag)}</Badge>
                            {r.flag_reason && <p className="text-[11px] text-gray-600 truncate" title={r.flag_reason}>{r.flag_reason}</p>}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 text-gray-600">
                  <td className="px-3 py-2" colSpan={5}>Rows 1–{lineRows.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(rowsSum)}</td>
                  {anyFlag && <td />}
                </tr>
                {/* Percentage rows from the sheet itself (Contingency, GST) with
                    the % where the rate column would otherwise say ₹18. */}
                {pctRows.map(r => (
                  <tr key={r.id} className="text-gray-600 text-xs">
                    <td className="px-3 py-1 text-gray-400 tabular-nums">{r.row_no}</td>
                    <td className="px-3 py-1" colSpan={3}>{r.description}{takeoff && r.formula_in_amount ? <span className="ml-2 font-mono text-[11px] text-gray-400">= {r.formula_in_amount}</span> : null}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{rateCell(r)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{r.amount != null ? formatINR(r.amount) : ''}</td>
                    {anyFlag && <td />}
                  </tr>
                ))}
                {pctRows.length === 0 && add?.lines.map((l, i) => (
                  <tr key={i} className={add.source === 'overrun' ? 'text-amber-800 text-xs' : 'text-gray-600 text-xs'}>
                    <td className="px-3 py-1" colSpan={5}>{l.label}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{l.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(l.amount))}</td>
                    {anyFlag && <td />}
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-bold text-gray-900 text-sm">
                  <td className="px-3 py-2.5" colSpan={5}>Requested total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(gt)}</td>
                  {anyFlag && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Phone: the same rows as cards. */}
          <div className="md:hidden divide-y divide-gray-100 px-4">
            {lineRows.map(r => (
              <div key={r.id} className={`py-3 ${showFlags && r.flag ? rowTintBySeverity(r.flag_severity) : ''}`}>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-gray-400 tabular-nums mt-0.5 flex-shrink-0">{r.row_no}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900">{r.description ?? '—'}</p>
                    <p className="text-[11.5px] text-gray-500 tabular-nums">{r.qty != null ? r.qty.toLocaleString('en-IN') : '—'} {r.unit ?? ''} × {rateCell(r) || '—'}</p>
                    {takeoff && takeoffLine(r)}
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">{r.amount != null ? formatINR(r.amount) : '—'}</p>
                </div>
                {showFlags && r.flag && (
                  <div className="mt-1.5">
                    <Badge className={flagClass(r.flag)}>{flagIcon(r.flag)}{flagLabel(r.flag)}</Badge>
                    {r.flag_reason && <p className="text-[11px] text-gray-600 mt-0.5">{r.flag_reason}</p>}
                  </div>
                )}
              </div>
            ))}
            <div className="py-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600"><span>Rows 1–{lineRows.length}</span><span className="tabular-nums">{formatINR(rowsSum)}</span></div>
              {pctRows.map(r => (
                <div key={r.id} className="flex justify-between gap-3 text-xs text-gray-600"><span>{r.description} · {rateCell(r)}</span><span className="tabular-nums flex-shrink-0">{r.amount != null ? formatINR(r.amount) : ''}</span></div>
              ))}
              {pctRows.length === 0 && add?.lines.map((l, i) => (
                <div key={i} className={`flex justify-between gap-3 text-xs ${add.source === 'overrun' ? 'text-amber-800' : 'text-gray-600'}`}><span>{l.label}</span><span className="tabular-nums flex-shrink-0">{l.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(l.amount))}</span></div>
              ))}
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5"><span>Requested total</span><span className="tabular-nums">{formatINR(gt)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* The decision — under the working, where it is read first. For the
          engineer this is the Send-for-approval block; for an approver it is
          the status line, Sign off and Return. */}
      <div className={`rounded-xl border p-4 ${ctx.nextSignOff || ctx.canRelease ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-white'}`}>
        {(ctx.nextSignOff || ctx.canRelease) && (
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
            <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-emerald-700">
              {ctx.nextSignOff === 'ph_approved' ? 'Your decision as Project Head' : ctx.nextSignOff === 'atm_approved' ? 'Your decision as Atm Head' : 'Your decision as Trustee'}
            </p>
            <p className="text-base font-bold text-gray-900 tabular-nums">{formatINR(gt)}</p>
          </div>
        )}
        <WSApprovalActions
          signOffCfg={signOffCfg}
          wsId={wsId}
          status={status}
          ctx={ctx}
          totalAmount={totalAmount}
          approvedSoFar={approvedSoFar}
          chainReleasedSoFar={chainReleasedSoFar}
          submitDisabled={!summaryTotal || summaryTotal <= 0}
        />
      </div>
    </div>
  )
}

function flagLabel(f: string): string {
  if (f === 'rate_high') return 'Rate high'
  if (f === 'rate_low') return 'Rate low'
  if (f === 'formula_mismatch') return 'Formula mismatch'
  if (f === 'ai_review') return 'AI review'
  return f
}
function flagIcon(f: string) {
  if (f === 'rate_high') return <TrendingUp className="h-3 w-3 mr-1 inline" />
  if (f === 'rate_low') return <TrendingDown className="h-3 w-3 mr-1 inline" />
  if (f === 'formula_mismatch') return <Sigma className="h-3 w-3 mr-1 inline" />
  return <AlertTriangle className="h-3 w-3 mr-1 inline" />
}
function flagClass(f: string): string {
  if (f === 'rate_high') return 'bg-amber-100 text-amber-800'
  if (f === 'rate_low') return 'bg-sky-100 text-sky-800'
  if (f === 'formula_mismatch') return 'bg-rose-100 text-rose-800'
  return 'bg-purple-100 text-purple-800'
}
function rowTintBySeverity(sev: string | null): string {
  if (sev === 'error') return 'bg-rose-50'
  if (sev === 'warn')  return 'bg-amber-50'
  return 'bg-blue-50/40'
}
