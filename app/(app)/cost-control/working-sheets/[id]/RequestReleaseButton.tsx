'use client'
// Owner engineer's "release the balance" panel on a partly released sheet.
// A short note is mandatory (why the balance is needed now) — it's posted to
// the sheet's comment thread AND recorded on the approval timeline, then the
// sheet goes back through the SAME approval chain (PH → Atm Head → Trustee) so
// the remaining money is released with fresh sign-offs.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatINR } from '@/lib/utils'
import { requestBalanceRelease } from '@/components/cost-control/ws-actions'
import { addWsComment } from '@/components/cost-control/comment-actions'

export function RequestReleaseButton({
  wsId, released, balance,
}: {
  wsId: string
  released: number
  balance: number
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  function onSend() {
    setErr(null)
    if (note.trim().length < 3) {
      setErr('Add a short note on why the balance is needed before sending.')
      return
    }
    startTransition(async () => {
      // Post to the comment thread first so it shows on everyone's page (same
      // as "Send for approval"), then raise the balance-release request.
      const c = await addWsComment(wsId, note.trim())
      if (!c.ok) { setErr(c.error ?? 'Could not save your note'); return }
      const r = await requestBalanceRelease(wsId, note.trim())
      if (!r.ok) { setErr(r.error ?? 'Could not send the request'); return }
      setNote('')
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 space-y-2.5">
      <div>
        <p className="text-sm font-semibold text-amber-900">
          Partly released — {formatINR(balance)} balance
        </p>
        <p className="text-xs text-amber-800/80 mt-0.5">
          {formatINR(released)} released by the Trustee so far. This sends the sheet back through the
          approval chain (Project Head → Atm Head → Trustee) to release the rest.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-amber-900">
          Note for the approver <span className="text-rose-600">*</span>
        </label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          disabled={busy}
          className="w-full rounded-md border border-amber-300 bg-white p-2 text-sm"
          placeholder="Required — why the balance is needed now (e.g. next work stage starting, materials to be ordered)."
        />
      </div>

      {err && <p className="text-xs text-rose-700">{err}</p>}

      <div className="flex justify-end">
        <Button size="sm" onClick={onSend} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Request release of balance
        </Button>
      </div>
    </div>
  )
}
