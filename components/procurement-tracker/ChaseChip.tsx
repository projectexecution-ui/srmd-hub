// A compact signal that an indent has a chase note and/or was chased
// recently — so you can see at a glance what's already been followed up on,
// without opening each line. Renders nothing when there's no note.
import { Check, MessageSquare } from 'lucide-react'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { chasedLabel } from '@/lib/procurement/chase-notes'

export function ChaseChip({ note, className = '' }: { note?: ChaseNote; className?: string }) {
  if (!note) return null
  const chased = chasedLabel(note.lastChasedAt)
  const hasNote = (note.note ?? '').trim().length > 0
  if (!chased && !hasNote) return null

  if (chased) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5 ${className}`}
        title={note.note ? `Chased ${chased}: “${note.note}”` : `Chased ${chased}`}
      >
        <Check className="h-2.5 w-2.5" /> {chased === 'today' ? 'chased today' : `chased ${chased}`}
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-1.5 py-0.5 ${className}`}
      title={note.note ? `Note: “${note.note}”` : 'Has a chase note'}
    >
      <MessageSquare className="h-2.5 w-2.5" /> note
    </span>
  )
}
