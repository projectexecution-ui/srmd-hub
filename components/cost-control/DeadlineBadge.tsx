import { CalendarClock, AlertTriangle, CalendarCheck } from 'lucide-react'

// Days between two dates, ignoring time-of-day.
function daysBetween(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((db - da) / ms)
}

export function DeadlineBadge({
  deadlineDate,
  notes,
  approved,
  compact,
  className = '',
}: {
  deadlineDate: string | null
  notes?: string | null
  /** When true the work is already approved — render in a calm tone regardless of days remaining. */
  approved?: boolean
  /** Tight single-line variant for use inside narrow table columns. Strips
   *  the year + notes, drops the icon, halves the padding. */
  compact?: boolean
  className?: string
}) {
  if (!deadlineDate) return null
  const today = new Date()
  const deadline = new Date(deadlineDate + 'T00:00:00')
  const days = daysBetween(today, deadline)

  let tone = 'bg-gray-100 text-gray-700 border-gray-200'
  let label: string
  let Icon = CalendarClock
  if (approved) {
    tone = 'bg-emerald-50 text-emerald-800 border-emerald-200'
    Icon = CalendarCheck
    label = `Deadline ${deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`
  } else if (days < 0) {
    tone = 'bg-rose-50 text-rose-800 border-rose-300'
    Icon = AlertTriangle
    label = `Overdue by ${Math.abs(days)}d`
  } else if (days === 0) {
    tone = 'bg-rose-50 text-rose-800 border-rose-300'
    Icon = AlertTriangle
    label = 'Due today'
  } else if (days <= 3) {
    tone = 'bg-amber-50 text-amber-900 border-amber-300'
    label = `${days}d left`
  } else if (days <= 7) {
    tone = 'bg-amber-50 text-amber-800 border-amber-200'
    label = `${days}d left`
  } else {
    label = `${days}d left`
  }

  const dateLong  = deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const dateShort = deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' })

  if (compact) {
    // Tight single-line variant. Just the date + a short urgency suffix
    // (e.g. "31 Dec 26 · 207d"). Full info on hover.
    const shortLabel = approved
      ? '✓'
      : days < 0 ? `−${Math.abs(days)}d`
      : days === 0 ? '0d'
      : `${days}d`
    return (
      <span
        className={`inline-flex items-center gap-1 rounded border ${tone} px-1.5 py-0.5 text-[11px] whitespace-nowrap font-mono ${className}`}
        title={`${label} · ${dateLong}${notes ? ` — ${notes}` : ''}`}
      >
        {dateShort}
        <span className="opacity-70">· {shortLabel}</span>
      </span>
    )
  }

  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border ${tone} px-3 py-1.5 text-sm ${className}`}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{label}</span>
        <span className="text-xs opacity-80">· {dateLong}</span>
      </div>
      {notes && <span className="text-xs opacity-80 truncate max-w-xs hidden md:inline">— {notes}</span>}
    </div>
  )
}
