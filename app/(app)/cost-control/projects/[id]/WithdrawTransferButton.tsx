'use client'
// Taking back a request you raised, while it is still only a request.
//
// The database refuses this once it has been approved, because from that point
// the Trustee has signed something — calling it off is their decision, not the
// raiser's. So this only appears while it is still in the approval chain.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR } from '@/lib/utils'
import { cancelTransfer } from './transfer-actions'

export function WithdrawTransferButton({
  id, projectId, amount, fromLabel,
}: {
  id: string
  projectId: string
  amount: number
  fromLabel: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const onClick = async () => {
    const ok = await confirm({
      title: 'Withdraw this request?',
      message: `The request to move ${formatINR(amount)} from ${fromLabel} will be closed. `
        + 'Nothing has moved, so there is nothing to undo in IN4. You can raise it again at any time.',
      confirmLabel: 'Withdraw',
    })
    if (!ok) return
    start(async () => {
      setErr(null)
      const r = await cancelTransfer(id, projectId)
      if (!r.ok) { setErr(r.error); return }
      toast.success('Request withdrawn')
      router.refresh()
    })
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button" onClick={onClick} disabled={pending}
        className="inline-flex items-center gap-1 px-2 min-h-[32px] rounded text-[11.5px] font-semibold border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
        Withdraw
      </button>
      {err && <span className="text-[10.5px] font-semibold text-rose-700 max-w-[200px] leading-tight">{err}</span>}
    </span>
  )
}
