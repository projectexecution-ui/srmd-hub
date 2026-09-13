'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { sanctionCertificate } from '@/app/actions/bills-sanction'
import { formatINR } from '@/lib/utils'

/** One click, with the figure it is fixing shown on the button itself.
 *
 *  The amount is deliberately NOT posted — the server reads it from the IN4
 *  mirror. This label is only so the person can see what they are agreeing to
 *  before they press it; if the two ever disagreed, the server's figure is the
 *  one that binds, and the reconciliation would catch the difference anyway. */
export function SanctionButton({ certificateId, amount, displayNo }: {
  certificateId: number
  amount: number
  displayNo: string
}) {
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  const router = useRouter()

  if (done) return <span className="text-[11px] font-semibold text-emerald-700">Sanctioned</span>

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await sanctionCertificate({ certificateId })
        if (!res.ok) { toast.error(res.error ?? 'Could not record the sanction.'); return }
        setDone(true)
        toast.success(`${displayNo} sanctioned at ${formatINR(res.amount ?? amount)}`)
        router.refresh()
      })}
      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 min-h-[32px] whitespace-nowrap"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      Sanction {formatINR(amount)}
    </button>
  )
}
