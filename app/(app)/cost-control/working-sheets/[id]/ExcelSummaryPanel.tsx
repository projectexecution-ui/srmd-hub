'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FileSpreadsheet, Download, RefreshCcw, Loader2, AlertTriangle, TrendingDown, TrendingUp, Sigma, Sparkles,
  Send, Check, RotateCcw,
} from 'lucide-react'
import { submitWorkingSheet, returnWorkingSheet } from '@/components/cost-control/ws-actions'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { ApproveTrancheButton } from '@/components/cost-control/ApproveTrancheButton'
import { formatINR } from '@/lib/utils'

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
  /** Per-row AI metadata (set by /ai-parse). When present, we trust the
   *  AI's `category` over the regex fallback for bucket classification. */
  ai_meta: {
    category?: 'material' | 'labour' | 'material_and_labour' | 'equipment' | 'tax' | 'addon' | 'discount' | null
  } | null
  flag: string | null
  flag_reason: string | null
  flag_severity: string | null
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

export function ExcelSummaryPanel({
  wsId, status, canEdit, canApprove, canReturn, totalAmount, approvedSoFar, fileName, downloadUrl, summaryTotal, summaryNotes, flagSummary, lastCheckedAt, rows,
}: {
  wsId: string
  status: WSStatus
  canEdit: boolean
  canApprove: boolean
  canReturn: boolean
  totalAmount: number
  approvedSoFar: number
  fileName: string | null
  downloadUrl: string | null
  summaryTotal: number | null
  summaryNotes: string | null
  flagSummary: FlagSummary | null
  lastCheckedAt: string | null
  rows: Row[]
}) {
  const router = useRouter()
  const [rechecking, setRechecking] = useState(false)
  const [acting, setActing] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const canSubmit    = canEdit    && (status === 'draft' || status === 'returned')
  const canDoApprove = canApprove && (status === 'submitted' || status === 'partially_approved')
  const canDoReturn  = canReturn  && (status === 'submitted' || status === 'partially_approved')

  async function submit() {
    setActing(true); setErr(null)
    const r = await submitWorkingSheet(wsId)
    setActing(false)
    if (!r.ok) { setErr(r.error ?? 'Submit failed'); return }
    router.refresh()
  }
  async function doReturn() {
    if (returnReason.trim().length < 5) { setErr('Give a clear return reason (5+ chars)'); return }
    setActing(true); setErr(null)
    const r = await returnWorkingSheet(wsId, returnReason)
    setActing(false)
    if (!r.ok) { setErr(r.error ?? 'Return failed'); return }
    setReturnOpen(false); setReturnReason('')
    router.refresh()
  }

  async function recheck() {
    setRechecking(true); setErr(null)
    try {
      const r = await fetch(`/api/cost-control/working-sheets/${wsId}/check`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Recheck failed')
    } finally {
      setRechecking(false)
    }
  }

  const flaggedRowIds = new Set(rows.filter(r => r.flag).map(r => r.id))

  // Classify each row so the totals reconcile against the typed grand
  // total. Indian BOQ sheets often have GST / freight / discount rows
  // sitting BELOW the line items, with no qty/rate but a flat amount.
  // Previously we summed every row's `amount` as if it were a line item
  // → the sum was lower than the sheet total → confusing mismatch
  // warning. Now we bucket by description so the math reconciles:
  //
  //   line items + add-ons + tax − discounts ≈ sheet total
  //
  // Matching the AI's `ai_meta.category` if present, else inferring
  // from the description text. Case-insensitive, whitespace-tolerant.
  function classifyRow(r: Row): 'line' | 'tax' | 'addon' | 'discount' {
    // 1. AI's tag wins when present. /ai-parse already classified each
    //    row with category=tax/addon/discount/etc., so we don't need to
    //    re-guess from description text.
    const aiCat = r.ai_meta?.category
    if (aiCat === 'tax') return 'tax'
    if (aiCat === 'addon') return 'addon'
    if (aiCat === 'discount') return 'discount'
    // material / labour / material_and_labour / equipment all roll up as
    // line items for the reconciliation total.
    if (aiCat === 'material' || aiCat === 'labour' || aiCat === 'material_and_labour' || aiCat === 'equipment') return 'line'

    // 2. Regex fallback for rows that haven't been AI-parsed yet (or when
    //    AI returned null). Indian-construction-aware patterns.
    const d = (r.description ?? '').toLowerCase().trim()
    if (!d) return 'line'
    // Discounts first
    if (/(^|\s)(discount|less|trade\s+discount|rebate)(\s|$|:)/.test(d)) return 'discount'
    // Tax: GST, CGST, SGST, IGST, UTGST, TDS, TCS, cess, vat, service tax
    if (/(^|\s)(gst|cgst|sgst|igst|utgst|tds|tcs|cess|vat|service\s*tax|input\s*tax)(\s|$|:|%|\d|@)/.test(d)) return 'tax'
    if (/tax\s*(amount|amt|@|on)/.test(d)) return 'tax'
    // Add-ons: freight, transport, packing, insurance, loading, handling,
    // P&F, contingency, provisional sum, retainage, escalation
    if (/(^|\s)(freight|transport(ation)?|carriage|packing|insurance|handling|loading|unloading|p\s*&\s*f|pnf|carting|cartage|loading\/unloading|installation\s*charges|service\s*charge|contingency|contingencies|provisional\s*sum|prov\s*sum|provision|escalation|retainage|round[-\s]*off|rounding)(\s|$|:|%|\d|@)/.test(d)) return 'addon'
    if (/\b(misc(ellaneous)?|other\s*charges|sundry)\b/.test(d) && (r.qty == null || r.rate == null)) return 'addon'
    return 'line'
  }

  type Bucket = 'line' | 'tax' | 'addon' | 'discount'
  const buckets: Record<Bucket, { count: number; total: number }> = {
    line:     { count: 0, total: 0 },
    tax:      { count: 0, total: 0 },
    addon:    { count: 0, total: 0 },
    discount: { count: 0, total: 0 },
  }
  for (const r of rows) {
    const b = classifyRow(r)
    buckets[b].count += 1
    buckets[b].total += r.amount ?? 0
  }
  // Net reconciliation total
  const totalFromRows = buckets.line.total + buckets.addon.total + buckets.tax.total - Math.abs(buckets.discount.total)

  return (
    <div className="space-y-4">
      {/* Header card with file + summary */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="h-10 w-10 rounded-lg bg-green-50 text-green-700 flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{fileName ?? 'Excel attachment'}</p>
              <p className="text-xs text-gray-500">{rows.length} line item{rows.length === 1 ? '' : 's'}{lastCheckedAt ? ` · checked ${new Date(lastCheckedAt).toLocaleString('en-IN')}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {downloadUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={downloadUrl} download={fileName ?? 'sheet.xlsx'}>
                    <Download className="h-4 w-4" /> Download
                  </a>
                </Button>
              )}
              <Button size="sm" onClick={recheck} disabled={rechecking}>
                {rechecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Re-check
              </Button>
            </div>
          </div>

          {/* Plain-language totals card. When the sheet has tax / freight /
              discount rows, we show the breakdown so the reconciliation is
              obvious. Otherwise the simpler 4-tile layout. */}
          {(() => {
            const stated  = summaryTotal ?? 0
            const fromRows = totalFromRows
            const hasExtras = buckets.tax.count + buckets.addon.count + buckets.discount.count > 0
            const diff = fromRows - stated
            const pct = stated > 0 ? Math.abs(diff / stated) * 100 : 0
            const mismatch = stated > 0 && pct > 1
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                  <Cell
                    label="Sheet total"
                    value={summaryTotal != null ? formatINR(summaryTotal) : '—'}
                    hint="What was entered as the grand total"
                  />
                  <Cell
                    label={hasExtras ? 'Items + tax add up to' : 'Lines add up to'}
                    value={formatINR(fromRows)}
                    hint={hasExtras
                      ? `${buckets.line.count} items + ${buckets.tax.count} tax + ${buckets.addon.count} add-on${buckets.discount.count > 0 ? ` − ${buckets.discount.count} discount` : ''} row${buckets.line.count + buckets.tax.count + buckets.addon.count + buckets.discount.count === 1 ? '' : 's'}`
                      : `${rows.length} line item${rows.length === 1 ? '' : 's'} in the sheet`}
                  />
                  <Cell
                    label="Items to check"
                    value={flagSummary?.flagged_rows ?? rows.filter(r => r.flag).length}
                    hint="Rows our checker is unsure about"
                  />
                  <Cell
                    label="AI check"
                    value={flagSummary?.ai_used ? 'Done' : 'Off'}
                    hint={flagSummary?.ai_used ? 'AI reviewed this sheet' : 'AI was not run yet'}
                  />
                </div>

                {/* Breakdown of how the recon total is built — only shown
                    when extras exist. Reads like an invoice footer. */}
                {hasExtras && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">How the total reconciles</p>
                    <div className="space-y-0.5 font-mono text-gray-700">
                      <Line label={`Line items (${buckets.line.count})`} amt={buckets.line.total} />
                      {buckets.addon.count > 0 && <Line label={`Add-ons (${buckets.addon.count}) — freight, P&F, etc.`} amt={buckets.addon.total} prefix="+" />}
                      {buckets.tax.count > 0 && <Line label={`Tax (${buckets.tax.count}) — GST / cess / etc.`} amt={buckets.tax.total} prefix="+" />}
                      {buckets.discount.count > 0 && <Line label={`Discounts (${buckets.discount.count})`} amt={Math.abs(buckets.discount.total)} prefix="−" />}
                      <div className="border-t border-gray-300 pt-1 mt-1 flex justify-between font-semibold text-gray-900">
                        <span>Reconciled total</span>
                        <span>{formatINR(fromRows)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {mismatch && (
                  <div className="mt-3 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">
                        Sheet total and reconciled total don&apos;t match — {pct.toFixed(1)}% gap
                      </p>
                      <p className="opacity-80">
                        Sheet total <b>{formatINR(stated)}</b> vs reconciled <b>{formatINR(fromRows)}</b>
                        {' — gap of '}
                        <b>{formatINR(Math.abs(diff))}</b>.
                        {hasExtras
                          ? ' Some tax / freight / discount rows may be missing or misclassified. Run AI parse to tag them correctly.'
                          : ' Likely: heading rows being counted, or GST/freight/discount rows that we couldn’t auto-detect. Run AI parse to clean it up.'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {summaryNotes && (
            <div className="mt-4 text-sm text-gray-700">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Notes</p>
              <p className="whitespace-pre-line">{summaryNotes}</p>
            </div>
          )}

          {err && <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

          {/* Status actions */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
            <WSStatusPill status={status} />
            {canSubmit && (
              <Button onClick={submit} disabled={acting || !summaryTotal || summaryTotal <= 0} className="ml-auto">
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit for Approval
              </Button>
            )}
            {canDoReturn && (
              <Button variant="outline" onClick={() => setReturnOpen(o => !o)} disabled={acting}
                className="ml-auto text-rose-700 border-rose-300 hover:bg-rose-50">
                <RotateCcw className="h-4 w-4" /> Return
              </Button>
            )}
            {canDoApprove && (
              <div className="w-full">
                <ApproveTrancheButton wsId={wsId} totalAmount={totalAmount} approvedSoFar={approvedSoFar} compact />
              </div>
            )}
          </div>

          {returnOpen && (
            <div className="mt-3 border border-rose-200 bg-rose-50 rounded-lg p-3">
              <p className="text-sm font-semibold text-rose-900 mb-2">Return for revision — give a clear reason</p>
              <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={2}
                placeholder="e.g. Rate for cement seems high vs last month — please re-check vendor quote"
                className="w-full rounded-md border border-rose-200 bg-white p-2 text-sm" />
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setReturnOpen(false); setReturnReason('') }} disabled={acting}>Cancel</Button>
                <Button variant="outline" size="sm" disabled={acting || returnReason.trim().length < 5} onClick={doReturn}
                  className="text-rose-700 border-rose-300 hover:bg-rose-50">
                  {acting ? 'Returning…' : 'Confirm return'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flag summary card */}
      {flagSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" /> Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(flagSummary.by_flag).map(([flag, n]) => (
                <Badge key={flag} className={flagClass(flag)}>
                  {flagIcon(flag)}{flagLabel(flag)} · {n}
                </Badge>
              ))}
              {flagSummary.flagged_rows === 0 && (
                <Badge className="bg-emerald-100 text-emerald-800">No flags — looks clean</Badge>
              )}
            </div>
            {flagSummary.narrative && (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-sm text-gray-800 whitespace-pre-line">
                {flagSummary.narrative}
              </div>
            )}
            {!flagSummary.ai_used && (
              <p className="text-xs text-gray-500 italic">
                AI narrative skipped {flagSummary.ai_error ? `(error: ${flagSummary.ai_error})` : '— set GEMINI_API_KEY (free) on Vercel to enable.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rows table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parsed rows</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2 w-10">#</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Unit</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Flag</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={`border-t border-gray-100 ${flaggedRowIds.has(r.id) ? rowTintBySeverity(r.flag_severity) : ''}`}>
                    <td className="px-2 py-2 text-gray-400">{r.row_no}</td>
                    <td className="px-2 py-2 text-gray-800 max-w-md">
                      <p className="truncate" title={r.description ?? ''}>{r.description ?? '—'}</p>
                      {r.formula_in_amount && (
                        <p className="text-[11px] text-gray-400 truncate font-mono">= {r.formula_in_amount}</p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-gray-600">{r.unit ?? ''}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.qty != null ? r.qty.toLocaleString('en-IN') : ''}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {r.rate != null ? r.rate.toLocaleString('en-IN') : ''}
                      {r.rate_breakdown && r.rate_breakdown.length > 0 && (
                        <div className="text-[10px] text-gray-400 font-normal">
                          {r.rate_breakdown.map(b => `${b.label} ${b.value.toLocaleString('en-IN')}`).join(' + ')}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {r.amount != null ? r.amount.toLocaleString('en-IN') : ''}
                      {r.amount_breakdown && r.amount_breakdown.length > 0 && (
                        <div className="text-[10px] text-gray-400 font-normal">
                          {r.amount_breakdown.map(b => `${b.label} ${b.value.toLocaleString('en-IN')}`).join(' + ')}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 max-w-xs">
                      {r.flag ? (
                        <div className="space-y-0.5">
                          <Badge className={flagClass(r.flag)}>{flagIcon(r.flag)}{flagLabel(r.flag)}</Badge>
                          {r.flag_reason && <p className="text-[11px] text-gray-600 truncate" title={r.flag_reason}>{r.flag_reason}</p>}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Line({ label, amt, prefix = '' }: { label: string; amt: number; prefix?: '+' | '−' | '' }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600">{prefix && <span className="mr-1">{prefix}</span>}{label}</span>
      <span className="tabular-nums">{formatINR(amt)}</span>
    </div>
  )
}

function Cell({ label, value, hint }: { label: string; value: string | number | null | undefined; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3" title={hint}>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900 mt-0.5">{value ?? '—'}</p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{hint}</p>}
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
