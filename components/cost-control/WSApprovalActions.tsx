'use client'
// ONE shared approval-actions block for every Working Sheet flavour
// (BOQ editor / Excel quick mode / thumbrule). Replaces the three
// near-identical copies that used to live in each panel.
//
// Renders:
//   • A visual 4-step chain stepper (Submitted → Project Head → Atm Head
//     → Trustee) with plain-word captions for laymen.
//   • The ONE primary action this viewer can take now: Submit (owner),
//     Sign off (PH / Atm Head), or Release into ERP (Trustee).
//   • Return-for-revision with a reason box (any approver stage).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Send, RotateCcw, Loader2, CheckCircle2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  CHAIN_STEPS, stageIndexFor, plainStatusLabel,
} from '@/lib/cost-control/chain'
import {
  submitWorkingSheet, signOffWorkingSheet, returnWorkingSheet,
  type WSApprovalContext,
} from '@/components/cost-control/ws-actions'
import { ApproveTrancheButton } from '@/components/cost-control/ApproveTrancheButton'

export function WSApprovalActions({
  wsId, status, ctx, totalAmount, approvedSoFar, submitDisabled = false, onBeforeSubmit,
}: {
  wsId: string
  status: string
  ctx: WSApprovalContext
  totalAmount: number
  approvedSoFar: number
  /** Extra client-side condition (e.g. no items yet / zero total). */
  submitDisabled?: boolean
  /** Runs before submit — e.g. the BOQ editor flushes unsaved rows. */
  onBeforeSubmit?: () => Promise<void>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const done = stageIndexFor(status)
  const isReturned = status === 'returned'
  const isCancelled = status === 'cancelled'

  async function doSubmit() {
    setBusy(true); setErr(null)
    if (onBeforeSubmit) {
      try { await onBeforeSubmit() } catch { /* row-level errors surface in the editor */ }
    }
    const r = await submitWorkingSheet(wsId)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Submit failed'); return }
    toast.success('Sent for approval — the Project Head will check it next')
    router.refresh()
  }

  async function doSignOff() {
    setBusy(true); setErr(null)
    const r = await signOffWorkingSheet(wsId)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Sign-off failed'); return }
    toast.success(
      r.new_status === 'ph_approved'
        ? 'Signed off — the sheet moves to the Atm Head'
        : 'Signed off — the sheet moves to the Trustee',
    )
    router.refresh()
  }

  async function doReturn() {
    if (returnReason.trim().length < 5) { setErr('Give a clear return reason (5+ characters)'); return }
    setBusy(true); setErr(null)
    const r = await returnWorkingSheet(wsId, returnReason.trim())
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Return failed'); return }
    setReturnOpen(false); setReturnReason('')
    toast.success('Returned to the engineer for changes')
    router.refresh()
  }

  const signOffLabel =
    ctx.nextSignOff === 'ph_approved' ? 'Sign off as Project Head'
    : ctx.nextSignOff === 'atm_approved' ? 'Sign off as Atm Head'
    : null

  return (
    <div className="space-y-3">
      {/* ── Chain stepper ── */}
      {!isCancelled && (
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 to-white p-3">
          <ol className="flex items-center gap-0">
            {CHAIN_STEPS.map((step, i) => {
              const stepDone = done > i
              const current = done === i && !isReturned
              return (
                <li key={step} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1 min-w-0">
                    <span className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors',
                      stepDone ? 'bg-indigo-600 border-indigo-600 text-white'
                        : current ? 'bg-white border-indigo-500 text-indigo-700 ring-4 ring-indigo-100'
                        : 'bg-white border-gray-300 text-gray-400',
                    )}>
                      {stepDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className={cn(
                      'text-[10px] font-semibold whitespace-nowrap',
                      stepDone ? 'text-indigo-800' : current ? 'text-indigo-700' : 'text-gray-400',
                    )}>
                      {step}
                    </span>
                  </div>
                  {i < CHAIN_STEPS.length - 1 && (
                    <div className={cn('h-0.5 flex-1 mx-1.5 mb-4 rounded', done > i + 1 ? 'bg-indigo-400' : 'bg-gray-200')} />
                  )}
                </li>
              )
            })}
          </ol>
          <p className={cn(
            'mt-2 text-xs font-medium',
            isReturned ? 'text-rose-700' : done >= CHAIN_STEPS.length ? 'text-emerald-700' : 'text-indigo-800',
          )}>
            {plainStatusLabel(status)}
            {status === 'partially_approved' && totalAmount > 0 && (
              <span className="text-amber-700"> — ₹{approvedSoFar.toLocaleString('en-IN')} of ₹{totalAmount.toLocaleString('en-IN')} released so far</span>
            )}
          </p>
        </div>
      )}

      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center gap-2">
        {ctx.canSubmit && (
          <Button onClick={doSubmit} disabled={busy || submitDisabled} size="lg" className="font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send for approval
          </Button>
        )}
        {signOffLabel && (
          <Button onClick={doSignOff} disabled={busy} size="lg" variant="success" className="font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            {signOffLabel}
          </Button>
        )}
        {ctx.canReturn && (
          <Button
            variant="outline"
            onClick={() => setReturnOpen(o => !o)}
            disabled={busy}
            className="text-rose-700 border-rose-300 hover:bg-rose-50"
          >
            <RotateCcw className="h-4 w-4" /> Return for changes
          </Button>
        )}
      </div>

      {/* Trustee release — the only stage where money moves */}
      {ctx.canRelease && (
        <ApproveTrancheButton
          wsId={wsId}
          totalAmount={totalAmount}
          approvedSoFar={approvedSoFar}
          compact
        />
      )}

      {returnOpen && ctx.canReturn && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 space-y-2">
          <label className="text-xs font-semibold text-rose-900">
            Return reason — the engineer sees this
          </label>
          <textarea
            value={returnReason}
            onChange={e => setReturnReason(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-rose-200 bg-white p-2 text-sm"
            placeholder="e.g. Painting rate looks high vs last quarter — please re-check the vendor quote"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setReturnOpen(false); setReturnReason('') }} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="outline" size="sm"
              className="text-rose-700 border-rose-300 hover:bg-rose-50"
              disabled={busy || returnReason.trim().length < 5}
              onClick={doReturn}
            >
              {busy ? 'Returning…' : 'Confirm return'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
