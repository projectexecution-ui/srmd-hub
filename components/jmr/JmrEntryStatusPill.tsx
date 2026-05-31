// Tiny status pill for jmr_daily_entries.status. Used on /jmr/my and on
// the PM dashboard's approval list. Keep this self-contained so we can
// drop it anywhere a row of entries is shown.
import { cn } from '@/lib/utils'

type Status = 'submitted' | 'pm_approved' | 'flagged'

const LABEL: Record<Status, string> = {
  submitted:   'Pending',
  pm_approved: 'Approved',
  flagged:     'Flagged',
}

const CLS: Record<Status, string> = {
  submitted:   'bg-amber-100 text-amber-800',
  pm_approved: 'bg-emerald-100 text-emerald-800',
  flagged:     'bg-rose-100 text-rose-800',
}

export function JmrEntryStatusPill({ status, className }: { status: string; className?: string }) {
  const s = status as Status
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium',
      CLS[s] ?? 'bg-gray-100 text-gray-700',
      className,
    )}>
      {LABEL[s] ?? status}
    </span>
  )
}
