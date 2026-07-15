'use client'
// Owner engineer's "release the balance" panel on a partly released sheet.
// One click (with confirm) sends the sheet back through the SAME approval
// chain — PH → Atm Head → Trustee — so the remaining money is released with
// fresh sign-offs.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR } from '@/lib/utils'
import { requestBalanceRelease } from '@/components/cost-control/ws-actions'

export function RequestReleaseButton({
  wsId, released, balance,
}: {
  wsId: string
  released: number
  balance: number
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  async function onClick() {
    setErr(null)
    const ok = await confirm({
      title: 'Request release of the balance?',
      message: [
        `${formatINR(released)} has been released so far — ${formatINR(balance)} is still pending.`,
        'This sends the sheet back through the approval chain (Project Head → Atm Head → Trustee) to release the balance.',
      ].join('\n\n'),
      confirmLabel: 'Send request',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await requestBalanceRelease(wsId)
      if (!r.ok) { setErr(r.error ?? 'Could not send the request'); return }
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm font-semibold text-amber-900">
          Partly released — {formatINR(balance)} balance
        </p>
        <p className="text-xs text-amber-800/80 mt-0.5">
          {formatINR(released)} released by the Trustee so far. Ask for the rest when you&apos;re ready.
        </p>
        {err && <p className="text-xs text-rose-700 mt-1">{err}</p>}
      </div>
      <Button size="sm" onClick={onClick} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Request release of balance
      </Button>
    </div>
  )
}
