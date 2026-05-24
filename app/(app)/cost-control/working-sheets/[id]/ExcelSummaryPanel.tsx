'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FileSpreadsheet, Download, RefreshCcw, Loader2, AlertTriangle, TrendingDown, TrendingUp, Sigma, Sparkles,
} from 'lucide-react'

interface Row {
  id: string
  row_no: number
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
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
  wsId, fileName, downloadUrl, summaryTotal, summaryNotes, flagSummary, lastCheckedAt, rows,
}: {
  wsId: string
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
  const [err, setErr] = useState<string | null>(null)

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
  const totalFromRows = rows.reduce((s, r) => s + (r.amount ?? 0), 0)

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
              <p className="text-xs text-gray-500">{rows.length} parsed row{rows.length === 1 ? '' : 's'}{lastCheckedAt ? ` · checked ${new Date(lastCheckedAt).toLocaleString('en-IN')}` : ''}</p>
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
            <Cell label="Grand total (stated)" value={summaryTotal != null ? `₹${summaryTotal.toLocaleString('en-IN')}` : '—'} />
            <Cell label="Sum of parsed rows"   value={`₹${totalFromRows.toLocaleString('en-IN')}`} />
            <Cell label="Flagged rows"          value={flagSummary?.flagged_rows ?? rows.filter(r => r.flag).length} />
            <Cell label="AI review"             value={flagSummary?.ai_used ? 'On' : 'Off'} />
          </div>

          {summaryNotes && (
            <div className="mt-4 text-sm text-gray-700">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Notes</p>
              <p className="whitespace-pre-line">{summaryNotes}</p>
            </div>
          )}

          {err && <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
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
                AI narrative skipped {flagSummary.ai_error ? `(error: ${flagSummary.ai_error})` : '— set ANTHROPIC_API_KEY on Vercel to enable.'}
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
                    <td className="px-2 py-2 text-right tabular-nums">{r.rate != null ? r.rate.toLocaleString('en-IN') : ''}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.amount != null ? r.amount.toLocaleString('en-IN') : ''}</td>
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

function Cell({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900 mt-0.5">{value ?? '—'}</p>
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
