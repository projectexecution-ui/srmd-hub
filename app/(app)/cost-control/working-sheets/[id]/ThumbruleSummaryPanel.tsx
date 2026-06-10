'use client'
// Read-only view for a thumbrule Working Sheet. A thumbrule estimate is a
// single rate × area figure — there are NO line items to itemise, so this
// panel just shows the total + the rate×area note + the same submit /
// approve / return actions the Excel-mode panel uses. No "Add row".

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Ruler, Send, RotateCcw, Loader2 } from 'lucide-react'
import { submitWorkingSheet, returnWorkingSheet } from '@/components/cost-control/ws-actions'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { ApproveTrancheButton } from '@/components/cost-control/ApproveTrancheButton'
import { formatINR } from '@/lib/utils'

export function ThumbruleSummaryPanel({
  wsId, status, canEdit, canApprove, canReturn, totalAmount, approvedSoFar, summaryNotes, pastApproved,
}: {
  wsId: string
  status: WSStatus
  canEdit: boolean
  canApprove: boolean
  canReturn: boolean
  totalAmount: number
  approvedSoFar: number
  summaryNotes: string | null
  pastApproved: number
}) {
  const router = useRouter()
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
    const r = await returnWorkingSheet(wsId, returnReason.trim())
    setActing(false)
    if (!r.ok) { setErr(r.error ?? 'Return failed'); return }
    setReturnOpen(false); router.refresh()
  }

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
            <Ruler className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Thumbrule estimate</p>
            <p className="text-xs text-gray-500">A quick rate × built-up area figure — no line items needed.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Estimate</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatINR(totalAmount)}</p>
          </div>
        </div>

        {summaryNotes && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm text-gray-700">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">How it&apos;s calculated</p>
            <p className="whitespace-pre-line">{summaryNotes}</p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Cell label="Past approved in sub-skill" value={formatINR(pastApproved)} />
          <Cell label="Approved via WS (this sheet)" value={approvedSoFar > 0 ? formatINR(approvedSoFar) : '—'} />
          <Cell label="This estimate" value={formatINR(totalAmount)} tone="amber" />
        </div>

        {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

        <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <WSStatusPill status={status} />
          {canSubmit && (
            <Button onClick={submit} disabled={acting || !totalAmount || totalAmount <= 0} className="ml-auto">
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

        {returnOpen && canDoReturn && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 space-y-2">
            <label className="text-xs font-semibold text-rose-900">Return reason (shown to engineer)</label>
            <textarea
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-300 p-2 text-sm"
              placeholder="e.g. Rate looks high vs last quarter — please revise."
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReturnOpen(false)} disabled={acting}>Cancel</Button>
              <Button variant="outline" size="sm" onClick={doReturn} disabled={acting}
                className="text-rose-700 border-rose-300">
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Return to engineer
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}
