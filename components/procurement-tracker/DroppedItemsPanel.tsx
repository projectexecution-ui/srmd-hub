'use client'
// Manage the "not ordering" list. Shows everything the team has hidden, with
// a one-tap Restore. Collapsed by default and hidden entirely when empty, so
// it never adds noise — it's only there when you've dropped something.

import { useState } from 'react'
import type { DroppedLine } from '@/lib/procurement/dropped'
import { Ban, RotateCcw, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const shortIndent = (no: string) => no.replace('IND/SRASSK/', '').replace('IND/SRET/', '').replace('IND/SRJT/', '')

export function DroppedItemsPanel({
  dropped,
  onChanged,
}: {
  dropped: DroppedLine[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  if (dropped.length === 0) return null

  async function restore(lineKey: string) {
    setBusyKey(lineKey)
    try {
      const res = await fetch('/api/procurement-tracker/dropped', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineKey }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) { toast.error(json.error || 'Could not restore.'); return }
      toast.success('Restored to the list')
      onChanged()
    } catch {
      toast.error('Network error — not restored.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50"
        aria-expanded={open}
      >
        <Ban className="h-3.5 w-3.5 text-stone-400 flex-shrink-0" />
        <span className="text-xs font-medium text-stone-600 flex-1">
          {dropped.length} item{dropped.length === 1 ? '' : 's'} marked &ldquo;not ordering&rdquo; &middot; hidden from all lists
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-stone-400" /> : <ChevronRight className="h-4 w-4 text-stone-400" />}
      </button>

      {open && (
        <div className="divide-y divide-stone-100 border-t border-stone-100">
          {dropped.map(d => (
            <div key={d.lineKey} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-700 truncate" title={d.material}>{d.material || '—'}</div>
                <div className="text-[11px] text-stone-400 truncate">
                  {shortIndent(d.indentNo)}{d.block ? ` · ${d.block}` : ''}{d.droppedByName ? ` · by ${d.droppedByName}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => restore(d.lineKey)}
                disabled={busyKey === d.lineKey}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-200 hover:border-emerald-300 px-2.5 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
              >
                {busyKey === d.lineKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
