'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RefreshCw, Loader2 } from 'lucide-react'

// Phase 1: re-reads the triaged items from the DB. Live Gmail sync (fetch +
// re-triage) arrives in Phase 2 once the inbox is connected — until then we
// tell the user plainly rather than pretend to pull new mail.
export function RefreshButton({ connected }: { connected: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  function onClick() {
    setBusy(true)
    if (!connected) {
      setNote('Live inbox sync turns on once your Gmail is connected (Phase 2). Showing your latest saved triage.')
    }
    router.refresh()
    setTimeout(() => setBusy(false), 400)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={onClick} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Refresh
      </Button>
      {note && <p className="text-[10px] text-gray-400 max-w-[220px] text-right">{note}</p>}
    </div>
  )
}
