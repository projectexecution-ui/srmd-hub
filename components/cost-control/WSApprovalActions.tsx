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
import { addWsComment } from '@/components/cost-control/comment-actions'
import { ApproveTrancheButton } from '@/components/cost-control/ApproveTrancheButton'
import { MoneyInput } from '@/components/ui/money-input'

/** Per-stage checked amounts + display labels (labels come from Cost
 *  Control settings so Aksha can rename the fields anytime). Shown ONLY
 *  inside this approval block + the trail — never on estimate tables. */
export interface SignOffCfg {
  phLabel: string
  atmLabel: string
  approvedLabel: string
  phChecked: { amt: number } | null
  atmChecked: { amt: number } | null
}

const DEFAULT_SIGNOFF_CFG: SignOffCfg = {
  phLabel: 'Project Head Checked Amt',
  atmLabel: 'Atm Head Checked Amt',
  approvedLabel: 'Approved Amount',
  phChecked: null,
  atmChecked: null,
}

/** The departments that raise work against a construction project. "Other"
 *  opens a free-text box rather than forcing a wrong choice. */
const OTHER_DEPT = 'Other…'
const DEPARTMENTS = ['Design', 'Security', 'ICT', 'Housekeeping', OTHER_DEPT]

export function WSApprovalActions({
  wsId, status, ctx, totalAmount, approvedSoFar, chainReleasedSoFar, submitDisabled = false, onBeforeSubmit, signOffCfg,
}: {
  wsId: string
  status: string
  ctx: WSApprovalContext
  totalAmount: number
  approvedSoFar: number
  /** Chain-wide released-so-far (max approved_for_erp_amt over the version
   *  chain) — the Trustee release balance nets against this, not the sheet's
   *  own tranche. Passed straight through to ApproveTrancheButton. */
  chainReleasedSoFar?: number
  /** Extra client-side condition (e.g. no items yet / zero total). */
  submitDisabled?: boolean
  /** Runs before submit — e.g. the BOQ editor flushes unsaved rows. */
  onBeforeSubmit?: () => Promise<void>
  signOffCfg?: SignOffCfg
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [signOffOpen, setSignOffOpen] = useState(false)
  const [checkedRaw, setCheckedRaw] = useState('')
  const [signOffComment, setSignOffComment] = useState('')
  // Most approvals are Construction’s own work, so this stays off unless the
  // Atm Head says otherwise.
  const [otherDeptOn, setOtherDeptOn] = useState(false)
  const [dept, setDept] = useState('')
  const [deptOther, setDeptOther] = useState('')
  const [deptNote, setDeptNote] = useState('')
  const [submitComment, setSubmitComment] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const cfg = signOffCfg ?? DEFAULT_SIGNOFF_CFG
  const done = stageIndexFor(status)
  const isReturned = status === 'returned'
  const isCancelled = status === 'cancelled'

  async function doSubmit() {
    // Comment is mandatory when sending for approval — the approver reads it.
    if (submitComment.trim().length < 3) {
      setErr('Add a short note for the approver before sending (why this budget is needed).')
      return
    }
    setBusy(true); setErr(null)
    if (onBeforeSubmit) {
      try { await onBeforeSubmit() } catch { /* row-level errors surface in the editor */ }
    }
    // Record the note on the sheet's comment thread, then submit.
    const c = await addWsComment(wsId, submitComment.trim())
    if (!c.ok) { setBusy(false); setErr(c.error ?? 'Could not save your note'); return }
    const r = await submitWorkingSheet(wsId)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Submit failed'); return }
    setSubmitComment('')
    toast.success('Sent for approval — the Project Head will check it next')
    router.refresh()
  }

  async function doSignOff() {
    const amt = Number(checkedRaw)
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr('Type the amount you checked before signing off')
      return
    }
    // Comment is mandatory at every approval stage.
    if (signOffComment.trim().length < 3) {
      setErr('Add a note on what you checked before signing off')
      return
    }
    // Tagging without saying which department, or without the note, would
    // leave a record nobody can act on.
    const deptName = (dept === OTHER_DEPT ? deptOther : dept).trim()
    if (otherDeptOn && !deptName) { setErr('Pick which department this budget belongs to'); return }
    if (otherDeptOn && deptNote.trim().length < 5) {
      setErr('Add the note \u2014 who approved it, and how much is being drawn'); return
    }
    setBusy(true); setErr(null)
    const r = await signOffWorkingSheet(
      wsId, amt, signOffComment.trim() || null,
      otherDeptOn ? { dept: deptName, note: deptNote.trim() } : null,
    )
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Sign-off failed'); return }
    setSignOffOpen(false); setCheckedRaw(''); setSignOffComment('')
    setOtherDeptOn(false); setDept(''); setDeptOther(''); setDeptNote('')
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
                      'text-[9px] sm:text-[10px] font-semibold whitespace-nowrap',
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
          {/* What each stakeholder checked/approved — approval UI only. */}
          {(cfg.phChecked || cfg.atmChecked || approvedSoFar > 0) && (
            <p className="mt-1 text-[11px] text-indigo-700/90 tabular-nums flex flex-wrap gap-x-4 gap-y-0.5">
              {cfg.phChecked && (
                <span><b>{cfg.phLabel}:</b> ₹{Math.round(cfg.phChecked.amt).toLocaleString('en-IN')}</span>
              )}
              {cfg.atmChecked && (
                <span><b>{cfg.atmLabel}:</b> ₹{Math.round(cfg.atmChecked.amt).toLocaleString('en-IN')}</span>
              )}
              {approvedSoFar > 0 && (
                <span className="text-emerald-700"><b>{cfg.approvedLabel}:</b> ₹{Math.round(approvedSoFar).toLocaleString('en-IN')}</span>
              )}
            </p>
          )}
        </div>
      )}

      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {/* Mandatory note when sending for approval — the approver reads this. */}
      {ctx.canSubmit && (
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700">Note for the approver <span className="text-rose-600">*</span></label>
          <textarea
            value={submitComment}
            onChange={e => setSubmitComment(e.target.value)}
            rows={2}
            disabled={busy}
            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
            placeholder="Required — why this budget is needed / what changed since the last version."
          />
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center gap-2">
        {ctx.canSubmit && (
          <Button onClick={doSubmit} disabled={busy || submitDisabled} size="lg" className="w-full sm:w-auto font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send for approval
          </Button>
        )}
        {signOffLabel && (
          <Button
            onClick={() => {
              // Pre-fill with the amount to approve (grand total, incl. GST) so
              // the approver just confirms; still editable if they checked less.
              if (!signOffOpen) setCheckedRaw(String(Math.round(totalAmount)))
              setSignOffOpen(o => !o); setErr(null)
            }}
            disabled={busy}
            size="lg"
            variant="success"
            className="w-full sm:w-auto font-semibold"
          >
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

      {/* Sign-off panel — pre-filled with the amount to approve (the grand
          total incl. GST) so approval is one click; the approver can still
          overwrite it if they checked a different figure. */}
      {signOffOpen && signOffLabel && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
          <label className="text-xs font-semibold text-emerald-900">
            {ctx.nextSignOff === 'ph_approved' ? cfg.phLabel : cfg.atmLabel} (₹) *
          </label>
          <MoneyInput
            value={checkedRaw}
            onChange={setCheckedRaw}
            placeholder="0"
            className="bg-white max-w-xs"
            autoFocus
          />
          <p className="text-[11px] text-emerald-800/80">
            Pre-filled with the amount to approve (incl. GST). Change it only if you checked a different figure.
          </p>
          <label className="text-xs font-semibold text-emerald-900 block">Note on your check <span className="text-rose-600">*</span></label>
          <textarea
            value={signOffComment}
            onChange={e => setSignOffComment(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-emerald-200 bg-white p-2 text-sm"
            placeholder="Required — e.g. verified rates against the Q1 vendor quotes"
          />

          {/* Whose budget is this? Atm Head only — the Project Head stage
              never shows it, and the server refuses it there too. */}
          {ctx.nextSignOff === 'atm_approved' && (
            <div className={`rounded-lg border px-3 py-2.5 ${otherDeptOn ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'}`}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox" checked={otherDeptOn}
                  onChange={e => { setOtherDeptOn(e.target.checked); setErr(null) }}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-purple-700"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-gray-900">
                    This budget is for another department
                  </span>
                  <span className="block text-[11.5px] text-gray-500">
                    Design, Security, ICT and so on — not Construction. It is recorded on the
                    project page so the extra work is visible without opening this sheet.
                  </span>
                </span>
              </label>

              {otherDeptOn && (
                <div className="mt-3 space-y-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {DEPARTMENTS.map(d => (
                      <button
                        key={d} type="button"
                        onClick={() => { setDept(d); setErr(null) }}
                        className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold border ${
                          dept === d ? 'bg-purple-700 border-purple-700 text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:border-purple-400'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  {dept === OTHER_DEPT && (
                    <input
                      value={deptOther}
                      onChange={e => { setDeptOther(e.target.value); setErr(null) }}
                      placeholder="Name the department"
                      className="w-full min-h-[40px] rounded-md border border-gray-300 bg-white px-2 text-sm"
                    />
                  )}
                  <div>
                    <label className="text-xs font-semibold text-gray-900 block mb-1">
                      What was approved, and by whom <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      value={deptNote}
                      onChange={e => { setDeptNote(e.target.value); setErr(null) }}
                      rows={2}
                      className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
                      placeholder="e.g. Mji approved ₹20,00,000. For CX approval, as per the working we are taking ₹7,00,000."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setSignOffOpen(false); setCheckedRaw(''); setSignOffComment(''); setOtherDeptOn(false); setDept(''); setDeptOther(''); setDeptNote('') }} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="success" size="sm" className="font-semibold"
              disabled={busy || !(Number(checkedRaw) > 0)}
              onClick={doSignOff}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Confirm sign-off
            </Button>
          </div>
        </div>
      )}

      {/* Trustee release — the only stage where money moves */}
      {ctx.canRelease && (
        <ApproveTrancheButton
          wsId={wsId}
          totalAmount={totalAmount}
          approvedSoFar={approvedSoFar}
          chainReleasedSoFar={chainReleasedSoFar}
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
