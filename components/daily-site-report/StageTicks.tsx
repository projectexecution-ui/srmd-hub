import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import type { DsrStep } from '@/lib/daily-site-report/stages'

/** Compact six-step tick strip (Received · Checked · Bill w/CT · Payment · GRN · Paid). */
export function StageTicks({ steps, className }: { steps: DsrStep[]; className?: string }) {
  return (
    <div className={cn('flex items-center', className)}>
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center" title={`${s.label}${s.done && s.on ? ' · ' + s.on : s.done ? '' : ' — pending'}`}>
          <span
            className={cn(
              'inline-flex h-4 w-4 items-center justify-center rounded-full',
              s.done ? 'bg-green-500 text-white' : 'border border-gray-300 bg-white',
            )}
          >
            {s.done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </span>
          {i < steps.length - 1 && (
            <span className={cn('h-0.5 w-2.5', s.done ? 'bg-green-300' : 'bg-gray-200')} />
          )}
        </div>
      ))}
    </div>
  )
}
