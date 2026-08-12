// A compact signal of the LAST vendor follow-up on an indent — so you can see
// at a glance what's already been chased, and whether it's due for another
// nudge. The colour carries the meaning:
//   recent (≤3d)  green  — just followed up, handled
//   aging  (4–7d) amber  — keep an eye
//   stale  (>7d)  rose   — "Follow up again" (a week-old chase is NOT reassuring)
// Renders nothing when there's no note and no follow-up date.
import { Check, Clock, MessageSquare } from 'lucide-react'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { chasedLabel, chasedLabelShort, chaseTier } from '@/lib/procurement/chase-notes'

const STYLE: Record<'recent' | 'aging' | 'stale', string> = {
  recent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  aging:  'bg-amber-50 text-amber-800 border-amber-200',
  stale:  'bg-rose-50 text-rose-700 border-rose-200',
}

export function ChaseChip({ note, className = '' }: { note?: ChaseNote; className?: string }) {
  if (!note) return null
  const tier = chaseTier(note.lastChasedAt)
  const short = chasedLabelShort(note.lastChasedAt)
  const long = chasedLabel(note.lastChasedAt)
  const hasNote = (note.note ?? '').trim().length > 0
  if (!tier || !short) {
    // No follow-up recorded, but there's a written note.
    if (!hasNote) return null
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-1.5 py-0.5 ${className}`}
        title={`Note: “${note.note.trim()}”`}
      >
        <MessageSquare className="h-2.5 w-2.5" /> note
      </span>
    )
  }

  const who = note.updatedByName ? ` by ${note.updatedByName}` : ''
  const noteBit = hasNote ? ` — “${note.note.trim()}”` : ''
  const title = `Last followed up ${long}${who}${noteBit}`

  // Recent/aging: reassure. Stale: prompt another nudge.
  const label = tier === 'stale'
    ? `Follow up again · ${short}`
    : short === 'today' ? 'Followed up today' : `Followed up · ${short}`

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium border rounded-full px-1.5 py-0.5 ${STYLE[tier]} ${className}`}
      title={title}
    >
      {tier === 'stale' ? <Clock className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
      {label}
    </span>
  )
}
