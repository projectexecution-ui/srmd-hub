'use client'
// Approving or turning down a budget transfer, from the one approvals inbox.
//
// The CT Head and the Atm Head must write a comment to approve (Aksha, 10 Oct
// 2026); the Trustee's note is optional. Turning down always REQUIRES a
// reason, because the person who raised it has to learn what to change rather
// than watching a request go quiet. All of it is enforced again in the database.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatINR } from '@/lib/utils'
import { approveTransfer, rejectTransfer } from '@/app/(app)/cost-control/projects/[id]/transfer-actions'

export function TransferDecideActions({
  id, projectId, amount, stage, fromLabel, toLabel,
}: {
  id: string
  projectId: string
  amount: number
  /** "CT Head", "Atm Head" or "Trustee" — what signing as means at this point. */
  stage: string
  fromLabel: string
  toLabel: string
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // Compulsory comment on approval at these two steps.
  const noteRequired = stage === 'CT Head' || stage === 'Atm Head'

  const run = (kind: 'approve' | 'reject') => {
    start(async () => {
      setErr(null)
      const r = kind === 'approve'
        ? await approveTransfer(id, text.trim() || null, projectId)
        : await rejectTransfer(id, text.trim(), projectId)
      if (!r.ok) { setErr(r.error); return }
      toast.success(kind === 'approve'
        ? (r.status === 'awaiting_in4'
            ? `${formatINR(amount)} approved — now with the Coordinator to shift in IN4`
            : r.status === 'pending_atm'
              ? `${formatINR(amount)} approved — now with the Atm Head`
              : `${formatINR(amount)} approved — now with the Trustee`)
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
          type="button" onClick={() => { setMode('approve'); setErr(null) }}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded-md bg-emerald-600 text-white text-[12.5px] font-semibold hover:bg-emerald-700"
        >
          <Check className="h-3.5 w-3.5" /> Approve as {stage}
        </button>
      </div>
    )
  }

  const rejecting = mode === 'reject'
  return (
    <div className="w-full sm:max-w-md flex flex-col gap-2">
      <p className="text-[11.5px] text-gray-600">
        {rejecting
          ? `Turning down the move of ${formatINR(amount)} from ${fromLabel}.`
          : `Approving the move of ${formatINR(amount)} from ${fromLabel} to ${toLabel}.`}
      </p>
      <Textarea
        value={text}
        onChange={e => { setText(e.target.value); setErr(null) }}
        rows={2}
        autoFocus
        placeholder={rejecting
          ? 'Why is it not approved? (required)'
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
          onClick={() => { setMode('idle'); setText(''); setErr(null) }}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          variant={rejecting ? 'destructive' : 'default'}
          onClick={() => run(mode)}
          disabled={pending || ((rejecting || noteRequired) && !text.trim())}
          className="w-full sm:w-auto"
        >
          {pending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : rejecting ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {rejecting ? 'Turn down' : 'Approve'}
        </Button>
      </div>
    </div>
  )
}
