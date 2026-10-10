'use client'
// Approving or turning down a budget transfer, from the one approvals inbox.
//
// The CT Head and the Atm Head must write a comment to approve (Aksha, 10 Oct
// 2026); the Trustee's note is optional. Turning down always REQUIRES a
// reason, because the person who raised it has to learn what to change rather
// than watching a request go quiet. All of it is enforced again in the database.
//
// The CT Head may also change the amount, up or down, while approving — never
// above what is free to move on the "from" line (Aksha, 10 Oct 2026). The Atm
// Head and the Trustee approve his figure as it stands, or turn it down.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { formatINR } from '@/lib/utils'
import { approveTransfer, rejectTransfer } from '@/app/(app)/cost-control/projects/[id]/transfer-actions'

export function TransferDecideActions({
  id, projectId, amount, stage, fromLabel, toLabel, maxAmount = null,
}: {
  id: string
  projectId: string
  amount: number
  /** "CT Head", "Atm Head" or "Trustee" — what signing as means at this point. */
  stage: string
  fromLabel: string
  toLabel: string
  /** The most the CT Head may set (free on the line + this request). Only
   *  sent for the CT Head step; null hides the amount box. */
  maxAmount?: number | null
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [text, setText] = useState('')
  const [amt, setAmt] = useState(String(amount))
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // Compulsory comment on approval at these two steps.
  const noteRequired = stage === 'CT Head' || stage === 'Atm Head'
  const canSetAmount = stage === 'CT Head' && maxAmount != null

  const newAmount = Math.round(Number(amt || 0))
  const changed = canSetAmount && newAmount !== amount
  const amountProblem = !canSetAmount ? null
    : !(newAmount > 0) ? 'Enter an amount to shift'
    : newAmount > (maxAmount ?? 0) ? `Only ${formatINR(maxAmount ?? 0)} is free to move off that line`
    : null

  const run = (kind: 'approve' | 'reject') => {
    start(async () => {
      setErr(null)
      const r = kind === 'approve'
        ? await approveTransfer(id, text.trim() || null, projectId, changed ? newAmount : null)
        : await rejectTransfer(id, text.trim(), projectId)
      if (!r.ok) { setErr(r.error); return }
      const figure = changed ? newAmount : amount
      toast.success(kind === 'approve'
        ? (r.status === 'awaiting_in4'
            ? `${formatINR(figure)} approved — now with the Coordinator to shift in IN4`
            : r.status === 'pending_atm'
              ? `${formatINR(figure)} approved${changed ? ` (changed from ${formatINR(amount)})` : ''} — now with the Atm Head`
              : `${formatINR(figure)} approved — now with the Trustee`)
        : 'Turned down, and the person who raised it has been told')
      setMode('idle'); setText('')
      router.refresh()
    })
  }

  if (mode === 'idle') {
    return (
      <div className="flex flex-col-reverse sm:flex-row gap-2">
        <button
          type="button" onClick={() => { setMode('reject'); setErr(null) }}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-md border border-gray-300 bg-white text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          <X className="h-3.5 w-3.5" /> Turn down
        </button>
        <button
          type="button" onClick={() => { setMode('approve'); setErr(null); setAmt(String(amount)) }}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-md bg-emerald-600 text-white text-[12.5px] font-semibold hover:bg-emerald-700"
        >
          <Check className="h-3.5 w-3.5" /> Approve as {stage}
        </button>
      </div>
    )
  }

  const rejecting = mode === 'reject'
  const blocked = pending
    || ((rejecting || noteRequired) && !text.trim())
    || (!rejecting && !!amountProblem)
  return (
    <div className="w-full sm:max-w-md flex flex-col gap-2">
      <p className="text-[11.5px] text-gray-600">
        {rejecting
          ? `Turning down the move of ${formatINR(amount)} from ${fromLabel}.`
          : `Approving the move from ${fromLabel} to ${toLabel}.`}
      </p>

      {/* The CT Head's figure — up or down, within what is free on the line. */}
      {!rejecting && canSetAmount && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`tr-amt-${id}`} className="text-[12px]">Amount to shift</Label>
          <MoneyInput
            id={`tr-amt-${id}`} value={amt}
            onChange={raw => { setAmt(raw); setErr(null) }}
            decimals={0} inputMode="numeric" className="min-h-[44px] sm:min-h-[36px]"
          />
          <p className={`text-[11.5px] ${amountProblem ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
            {amountProblem
              ?? <>Asked {formatINR(amount)} · up to {formatINR(maxAmount ?? 0)} free on this line</>}
          </p>
        </div>
      )}

      <Textarea
        value={text}
        onChange={e => { setText(e.target.value); setErr(null) }}
        rows={2}
        autoFocus={!canSetAmount}
        placeholder={rejecting
          ? 'Why is it not approved? (required)'
          : changed
            ? 'Your comment (required) — why the amount changed'
            : noteRequired
              ? 'Your comment (required) — what you checked and why it is fine'
              : 'Anything to note with your approval (optional)'}
      />
      {!rejecting && noteRequired && !text.trim() && !err && (
        <p className="text-[11.5px] text-amber-800">A comment is compulsory for the {stage} — write one to approve.</p>
      )}
      {err && <p className="text-[12px] font-semibold text-rose-700">{err}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => { setMode('idle'); setText(''); setErr(null); setAmt(String(amount)) }}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          variant={rejecting ? 'destructive' : 'default'}
          onClick={() => run(mode)}
          disabled={blocked}
          className="w-full sm:w-auto"
        >
          {pending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : rejecting ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {rejecting ? 'Turn down' : changed ? `Approve at ${formatINR(newAmount)}` : 'Approve'}
        </Button>
      </div>
    </div>
  )
}
