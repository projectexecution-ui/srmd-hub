'use client'

// One-click "run the daily jobs now" — for mornings the free-plan cron is late.
// Posts to /api/cron/run-now (admin-gated). The ledger makes it safe to press
// any time: jobs already done today are skipped, so nothing double-sends.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, Send, CheckCircle2, AlertTriangle } from 'lucide-react'

export function CronRunNowButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  async function run() {
    setBusy(true); setResult(null)
    try {
      const r = await fetch('/api/cron/run-now', { method: 'POST' })
      const d = await r.json().catch(() => ({} as { ok?: boolean; ran?: number; error?: string }))
      if (r.ok && d.ok) {
        setResult({ ok: true, msg: `Sent — ran ${d.ran ?? 0} job${d.ran === 1 ? '' : 's'}` })
        router.refresh()
      } else {
        setResult({ ok: false, msg: d.error || 'Could not run the jobs' })
      }
    } catch {
      setResult({ ok: false, msg: 'Could not reach the server' })
    }
    setBusy(false)
  }

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {busy ? 'Sending…' : 'Send daily jobs now'}
      </Button>
      {result && (
        <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {result.msg}
        </span>
      )}
    </div>
  )
}
