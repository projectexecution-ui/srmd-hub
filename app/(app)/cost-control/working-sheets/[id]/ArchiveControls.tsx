'use client'
// Archive / restore / delete controls for a Working Sheet.
// - Not archived + caller granted → subtle "Archive" button.
// - Archived → banner "Archived by X on date" with Restore (granted users)
//   and Delete forever (admin only, confirmed).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Trash2, Loader2 } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { archiveWorkingSheet } from '@/components/cost-control/ws-actions'

export function ArchiveControls({
  wsId, wsCode, archivedAt, archivedByName, canArchive, isAdmin,
}: {
  wsId: string
  wsCode: string
  archivedAt: string | null
  archivedByName: string | null
  canArchive: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function run(action: 'archive' | 'restore' | 'delete') {
    setErr(null)
    startTransition(async () => {
      const res = await archiveWorkingSheet(wsId, action)
      if (!res.ok) { setErr(res.error || 'Failed'); return }
      if (action === 'delete') { router.push('/cost-control/working-sheets?status=archived'); return }
      router.refresh()
    })
  }

  if (archivedAt) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-700 inline-flex items-center gap-2">
          <Archive className="h-4 w-4 text-gray-500" />
          <span>
            <b>Archived</b> by {archivedByName ?? 'unknown'} on{' '}
            {new Date(archivedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
            <span className="text-gray-500"> — hidden from all lists and totals.</span>
          </span>
        </p>
        <span className="inline-flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {canArchive && !busy && (
            <button
              onClick={() => run('restore')}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100"
            >
              <ArchiveRestore className="h-3.5 w-3.5" /> Restore
            </button>
          )}
          {isAdmin && !busy && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${wsCode} forever?`,
                  message: 'This permanently removes the working sheet, its parsed rows and comments. This cannot be undone.',
                  confirmLabel: 'Delete forever',
                  danger: true,
                })
                if (ok) run('delete')
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete forever
            </button>
          )}
        </span>
        {err && <p className="w-full text-xs text-rose-700">{err}</p>}
      </div>
    )
  }

  if (!canArchive) return null
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={async () => {
          const ok = await confirm({
            title: `Archive ${wsCode}?`,
            message: 'The sheet disappears from lists and totals but nothing is deleted — you can restore it from the Archived filter anytime.',
            confirmLabel: 'Archive',
            danger: false,
          })
          if (ok) run('archive')
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-gray-300 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50"
        title="Archive this working sheet (restorable)"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
        Archive
      </button>
      {err && <span className="text-xs text-rose-700">{err}</span>}
    </span>
  )
}
