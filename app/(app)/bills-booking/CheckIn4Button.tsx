'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { checkIn4Now } from '@/app/actions/bills-advance'

/** "Has IN4 approved anything since we last looked?"
 *
 *  Aksha, 15 Sep 2026, asking for this on the Disc Head's screen and the desks
 *  above it. The mirror refreshes twice a day and the automatic sweep rides on
 *  that, so an abstract approved at eleven would leave a bill sitting with the
 *  Site Head until the evening even though it is ready. This runs the same
 *  sweep now.
 *
 *  It always says what happened, including when the answer is nothing — a
 *  refresh button that goes quiet leaves you wondering whether it worked. */
export function CheckIn4Button() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [last, setLast] = useState<string | null>(null)

  function run() {
    start(async () => {
      const r = await checkIn4Now()
      if (!r.ok) { toast.error(r.error ?? 'Could not check IN4'); return }
      const moved = r.moved ?? 0
      setLast(moved > 0 ? `${moved} moved on` : 'nothing new')
      toast.success(
        moved > 0
          ? `${moved} ${moved === 1 ? 'bill' : 'bills'} moved to the CT Disc Head — IN4 has approved the measurement`
          : `Nothing new. ${r.checked ?? 0} ${r.checked === 1 ? 'bill is' : 'bills are'} with the Site Head, still waiting on IN4.`,
      )
      router.refresh()
    })
  }

  return (
    <button type="button" onClick={run} disabled={busy}
            title="Check IN4 for newly approved abstracts and goods receipts, and move those bills on"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Checking IN4…' : 'Check IN4'}
      {last && !busy && <span className="text-[11px] font-normal text-gray-400">· {last}</span>}
    </button>
  )
}
