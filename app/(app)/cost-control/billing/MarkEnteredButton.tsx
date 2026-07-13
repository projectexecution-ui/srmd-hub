'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { markEnteredInIn4 } from './billing-actions'

export function MarkEnteredButton({ wsId, wsCode }: { wsId: string; wsCode: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function confirm() {
    setBusy(true); setErr(null)
    const r = await markEnteredInIn4(wsId, ref)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not mark this sheet'); return }
    setOpen(false); setRef('')
    router.refresh()
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="text-teal-700 border-teal-300 hover:bg-teal-50" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-4 w-4" /> Entered in IN4
      </Button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          value={ref}
          onChange={e => setRef(e.target.value)}
          placeholder="IN4 ref (optional)"
          className="h-8 w-36 text-xs"
          maxLength={60}
        />
        <Button size="sm" onClick={confirm} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setRef(''); setErr(null) }} disabled={busy}>
          Cancel
        </Button>
      </div>
      {err && <p className="text-[11px] text-rose-600 max-w-[260px] text-right">{err}</p>}
      <p className="text-[10px] text-gray-400">Marks {wsCode} as keyed into IN4 — no money moves.</p>
    </div>
  )
}
