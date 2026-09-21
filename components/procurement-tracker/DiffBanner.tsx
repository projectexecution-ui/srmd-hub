'use client'
import type { SnapshotDiff } from '@/lib/procurement'
import { formatSavedAt } from '@/lib/procurement/storage'
import { Sparkles } from 'lucide-react'

export function DiffBanner({ diff }: { diff: SnapshotDiff }) {
  const newCount = diff.newLineIds.size
  const updatedCount = diff.changedLineIds.size
  const total = newCount + updatedCount
  if (total === 0) return null
  return (
    <div className="bg-gradient-to-r from-emerald-50 via-amber-50 to-orange-50 border border-orange-200 rounded-xl p-3 flex items-start gap-3">
      <Sparkles className="h-4 w-4 text-orange-700 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-stone-800 flex-1">
        <p>
          Since your last upload
          {diff.prevSavedAt && <> on <span className="text-stone-600">{formatSavedAt(diff.prevSavedAt)}</span></>}
          :{' '}
          {newCount > 0 && (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 align-middle">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                {newCount} New
              </span>{' '}
            </>
          )}
          {updatedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 align-middle">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
              {updatedCount} Updated
            </span>
          )}
          {' '}line{total === 1 ? '' : 's'} in the lists below.
        </p>
        <p className="text-xs text-stone-600 mt-1">
          {diff.newlyGrnDone > 0 && <span className="text-emerald-700"><b>{diff.newlyGrnDone}</b> moved to GRN Done · </span>}
          {diff.newlyInProgress > 0 && <span className="text-amber-700"><b>{diff.newlyInProgress}</b> new POs raised · </span>}
          {diff.newlyOverdue > 0 && <span className="text-rose-700"><b>{diff.newlyOverdue}</b> still no-PO ≥7 days · </span>}
          <span className="text-stone-500">scroll the list — each changed row has its own pill.</span>
        </p>
      </div>
    </div>
  )
}
