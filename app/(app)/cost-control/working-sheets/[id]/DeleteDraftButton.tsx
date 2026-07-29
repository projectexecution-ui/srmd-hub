'use client'
// Owner (or admin) can delete a DRAFT budget request — e.g. it was raised in
// the wrong sub-category. Shown only while the sheet is a draft; once it's sent
// for approval this control is gone and the RPC refuses anyway.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { deleteDraftWorkingSheet } from '@/components/cost-control/ws-actions'

export function DeleteDraftButton({
  wsId, wsCode, projectId,
}: {
  wsId: string
  wsCode: string
  projectId: string
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  async function onDelete() {
    const ok = await confirm({
      title: `Delete draft ${wsCode}?`,
      message: 'This permanently removes this draft budget request and the file you uploaded. It has not been sent for approval, so nothing downstream is affected. This cannot be undone.',
      confirmLabel: 'Delete draft',
      danger: true,
    })
    if (!ok) return
    setErr(null)
    startTransition(async () => {
      const r = await deleteDraftWorkingSheet(wsId)
      if (!r.ok) { setErr(r.error || 'Could not delete the draft'); return }
      router.push(`/cost-control/projects/${projectId}`)
    })
  }

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-rose-900">Raised in the wrong place, or a mistake?</p>
        <p className="text-xs text-rose-800/80 mt-0.5">
          This is still a draft — delete it and raise a fresh one. Once you send it for approval it can no longer be deleted.
        </p>
        {err && <p className="text-xs text-rose-700 mt-1">{err}</p>}
      </div>
      <button
        onClick={onDelete}
        disabled={busy}
        className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 h-10 px-3.5 rounded-md bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Delete draft
      </button>
    </div>
  )
}
