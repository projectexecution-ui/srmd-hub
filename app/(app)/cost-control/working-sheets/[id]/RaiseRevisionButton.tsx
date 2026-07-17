'use client'
// "Raise revision" on an approved sheet (cc_cumulative_versions). Creates the
// next version as a clone of this one and opens it for editing.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { GitBranch, Loader2 } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { raiseNextVersion } from './version-actions'

export function RaiseRevisionButton({ wsId }: { wsId: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onClick() {
    const ok = await confirm({
      title: 'Raise a revision?',
      message: 'This starts a new version carrying the whole approved BOQ forward. The current version stays frozen and downloadable — you edit only the changed / new items on the copy.',
      confirmLabel: 'Raise revision',
    })
    if (!ok) return
    setBusy(true); setError(null)
    const res = await raiseNextVersion(wsId)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    router.push(`/cost-control/working-sheets/${res.id}`)
    router.refresh()
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-indigo-900">Need to revise this budget?</p>
        <p className="text-xs text-indigo-800/80">Drawings changed, quantities grew — raise a revision. Already-approved money is carried forward; the Trustee sees only what&apos;s new.</p>
        {error && <p className="text-xs text-rose-700 mt-1">{error}</p>}
      </div>
      <Button type="button" size="sm" onClick={onClick} disabled={busy} className="flex-shrink-0">
        {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <GitBranch className="h-4 w-4 mr-1.5" />}
        Raise revision
      </Button>
    </div>
  )
}
