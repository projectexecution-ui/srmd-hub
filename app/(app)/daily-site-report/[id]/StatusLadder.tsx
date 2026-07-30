'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { DSR_LADDER } from '@/lib/daily-site-report/stages'
import { todayISO, formatDateIN } from '@/lib/jmr/format'
import type { DsrReport } from '@/lib/types'

type StepState = { done: boolean; on: string | null }

export function StatusLadder({ reportId, report, canEdit }: { reportId: string; report: DsrReport; canEdit: boolean }) {
  const router = useRouter()
  const supabase = createClient()

  const [state, setState] = useState<Record<string, StepState>>(() => {
    const s: Record<string, StepState> = {}
    for (const step of DSR_LADDER) {
      s[step.flag as string] = {
        done: !!report[step.flag],
        on: (report[step.dateField] as string | null) ?? null,
      }
    }
    return s
  })
  const [busy, setBusy] = useState<string | null>(null)

  async function toggle(flag: string, dateField: string, label: string) {
    if (!canEdit || busy) return
    const cur = state[flag]
    const next = !cur.done

    // Confirm turning ON the terminal "Paid" step.
    if (next && flag === 'paid') {
      const ok = await confirm({
        title: 'Mark as Paid?',
        message: 'Confirm the payment for this bill is completed.',
        danger: false,
        confirmLabel: 'Mark Paid',
      })
      if (!ok) return
    }

    const onDate = next ? todayISO() : null
    setState(prev => ({ ...prev, [flag]: { done: next, on: onDate } })) // optimistic
    setBusy(flag)
    const { error } = await supabase
      .from('dsr_reports')
      .update({ [flag]: next, [dateField]: onDate })
      .eq('id', reportId)
    setBusy(null)
    if (error) {
      setState(prev => ({ ...prev, [flag]: cur })) // revert
      toast.error(`Couldn't update "${label}" — ${error.message}`)
      return
    }
    router.refresh()
  }

  return (
    <ol className="space-y-1.5">
      {DSR_LADDER.map(step => {
        const flag = step.flag as string
        const s = state[flag]
        const isBusy = busy === flag
        return (
          <li key={flag}>
            <button
              type="button"
              disabled={!canEdit || isBusy}
              onClick={() => toggle(flag, step.dateField as string, step.label)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                s.done ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white',
                canEdit && !isBusy ? 'hover:border-gray-300' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full',
                  s.done ? 'bg-green-500 text-white' : 'border border-gray-300 bg-white',
                )}
              >
                {isBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                ) : s.done ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : null}
              </span>
              <span className="flex-1">
                <span className={cn('font-medium', s.done ? 'text-green-900' : 'text-gray-800')}>{step.label}</span>
                {step.hint && !s.done && <span className="block text-[11px] text-gray-400">{step.hint}</span>}
              </span>
              {s.done && s.on && <span className="text-xs text-green-700">{formatDateIN(s.on)}</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
