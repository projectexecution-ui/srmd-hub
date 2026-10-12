'use client'
// "Refresh from IN4" — one click on the bill re-reads its work order from IN4
// and re-runs the bill checks (Aksha, 12 Oct 2026). Says how fresh the figures
// are, and what the read found.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { refreshBillFromIn4 } from './refresh-actions'

export function RefreshFromIn4({ billId, asOf }: { billId: string; asOf: string | null }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const run = () => start(async () => {
    setErr(null)
    const r = await refreshBillFromIn4(billId)
    if (!r.ok) { setErr(r.error); return }
    toast.success(r.moved ? `${r.summary} The bill moved on.` : r.summary)
    router.refresh()
  })

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button type="button" onClick={run} disabled={busy}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {busy ? 'Reading IN4…' : 'Refresh from IN4'}
      </button>
      {asOf && !err && <span className="text-[11px] text-gray-500">IN4 figures as of {asOf}</span>}
      {err && <span className="max-w-[280px] text-right text-[11px] font-semibold text-rose-700">{err}</span>}
    </div>
  )
}
