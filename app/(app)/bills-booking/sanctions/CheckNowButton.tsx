'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Loader2 } from 'lucide-react'

/** Runs the same sweep the cron runs, on demand.
 *
 *  Worth having because the cron is twice a day on the free plan and a
 *  mismatch found on Friday afternoon should not wait until Saturday morning. */
export function CheckNowButton() {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await fetch('/api/cron/bills-reconcile', { method: 'POST' })
          const json = await res.json()
          if (!json.ok) { toast.error(json.error ?? json.reason ?? 'The check could not run.'); return }
          toast.success(json.summary ?? 'Checked.')
          router.refresh()
        } catch {
          toast.error('The check could not run.')
        } finally { setBusy(false) }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 min-h-[44px]"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Check against IN4
    </button>
  )
}
