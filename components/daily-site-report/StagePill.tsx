import { cn } from '@/lib/utils'
import type { DsrStageKey } from '@/lib/daily-site-report/stages'

const STAGE_STYLE: Record<DsrStageKey, { label: string; cls: string }> = {
  received:     { label: 'Received',        cls: 'bg-slate-100 text-slate-700' },
  bill_with_ct: { label: 'Bill with CT',    cls: 'bg-blue-100 text-blue-700' },
  payment:      { label: 'Payment started', cls: 'bg-amber-100 text-amber-800' },
  grn:          { label: 'GRN done',        cls: 'bg-indigo-100 text-indigo-700' },
  paid:         { label: 'Paid',            cls: 'bg-green-100 text-green-700' },
}

export function StagePill({ stage, className }: { stage: DsrStageKey; className?: string }) {
  const s = STAGE_STYLE[stage]
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', s.cls, className)}>
      {s.label}
    </span>
  )
}
