'use client'
// "Moved in IN4" — the tick for the person who actually made the change.
//
// This records a claim, not evidence. The next BPH pull compares both lines
// against what was approved and only then closes the request; if the figures
// disagree it stays open and says what actually moved. The confirm says that
// plainly, so nobody ticks it expecting the job to be finished.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR } from '@/lib/utils'
import { markTransferInIn4 } from '@/app/(app)/cost-control/projects/[id]/transfer-actions'

export function MarkTransferMovedButton({
  id, amount, fromLabel, toLabel, variant,
}: {
  id: string
  amount: number
  fromLabel: string
  toLabel: string
  variant: 'card' | 'row'
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const onClick = async () => {
    const ok = await confirm({
      title: 'Moved in IN4?',
      message: `Confirm you have moved ${formatINR(amount)} in IN4 — out of ${fromLabel} and into ${toLabel}.\n\n`
        + 'The next sync checks both lines against this. If they do not match, the request '
        + 'stays open and says what actually moved, so tick this only once the change is really in.',
      confirmLabel: 'Moved in IN4',
    })
    if (!ok) return
    start(async () => {
      setErr(null)
      const r = await markTransferInIn4(id)
      if (!r.ok) { setErr(r.error); return }
      toast.success(r.status === 'confirmed'
        ? `${formatINR(amount)} confirmed — IN4 already shows both lines moved`
        : `Recorded — the next sync will check IN4 and close it`)
      router.refresh()
    })
  }

  const label = pending
    ? <Loader2 className={variant === 'row' ? 'h-3 w-3 animate-spin' : 'h-4 w-4 animate-spin'} />
    : <Check className={variant === 'row' ? 'h-3 w-3' : 'h-4 w-4'} />

  if (variant === 'row') {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <button
          type="button" onClick={onClick} disabled={pending}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
        >
          {label} Moved in IN4
        </button>
        {err && <span className="text-[10.5px] font-semibold text-rose-700 max-w-[200px] leading-tight text-right">{err}</span>}
      </span>
    )
  }

  return (
    <div className="mt-2">
      <button
        type="button" onClick={onClick} disabled={pending}
        className="flex w-full items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 disabled:opacity-50"
      >
        {label} Moved in IN4
      </button>
      {err && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{err}</p>}
    </div>
  )
}
