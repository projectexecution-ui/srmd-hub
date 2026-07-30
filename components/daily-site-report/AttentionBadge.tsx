import { cn } from '@/lib/utils'
import type { DsrAttention, Severity } from '@/lib/daily-site-report/stages'

const SEV_STYLE: Record<Severity, string> = {
  none:   'bg-green-50 text-green-700 border-green-200',
  ok:     'bg-slate-50 text-slate-600 border-slate-200',
  warn:   'bg-amber-50 text-amber-800 border-amber-200',
  urgent: 'bg-red-50 text-red-700 border-red-200',
}

/** Shows the current bottleneck + how long it's been waiting once over SLA. */
export function AttentionBadge({ attention, className }: { attention: DsrAttention; className?: string }) {
  if (attention.severity === 'none') {
    return (
      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', SEV_STYLE.none, className)}>
        Complete
      </span>
    )
  }
  const showDays = attention.severity === 'warn' || attention.severity === 'urgent'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', SEV_STYLE[attention.severity], className)}>
      {attention.label}{showDays ? ` · ${attention.waitingDays}d` : ''}
    </span>
  )
}
