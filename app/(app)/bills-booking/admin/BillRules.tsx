'use client'
// "Bill rules" — the three switches for a bill that changes (Aksha, 11 Oct
// 2026: "can u make it in settings"). One line of plain words under each, so
// whoever reads it knows what turning it off would stop.

import { useState, useTransition } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { BILL_RULES, type BillRuleKey } from '@/lib/bills-booking/rules'
import { setBillRule } from './rules-actions'

export function BillRules({ initial }: { initial: Record<BillRuleKey, boolean> }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState<BillRuleKey | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [, start] = useTransition()

  const flip = (key: BillRuleKey) => {
    const next = !state[key]
    setBusy(key); setErr(null)
    start(async () => {
      const r = await setBillRule(key, next)
      setBusy(null)
      if (!r.ok) { setErr(r.error ?? 'Could not save'); return }
      setState(s => ({ ...s, [key]: next }))
      toast.success(`${BILL_RULES.find(x => x.key === key)?.label} — ${next ? 'on' : 'off'}`)
    })
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70">
        <p className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-indigo-600" /> Bill rules
        </p>
        <p className="text-xs text-gray-600 mt-0.5">Each can be switched off here, and the bill goes back to how it worked before. They act on the next IN4 check (twice a day, or Check IN4).</p>
      </div>
      <div className="divide-y divide-gray-100">
        {BILL_RULES.map((r, i) => {
          const on = state[r.key]
          return (
            <div key={r.key}>
            {(i === 0 || BILL_RULES[i - 1].group !== r.group) && (
              <p className="bg-gray-50/60 px-4 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-wide text-gray-500">{r.group}</p>
            )}
            <div className="flex items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-gray-900">{r.label}</p>
                <p className="mt-0.5 text-[12px] text-gray-600">{r.detail}</p>
              </div>
              <button type="button" role="switch" aria-checked={on} aria-label={r.label}
                      disabled={busy != null} onClick={() => flip(r.key)}
                      className={cn('relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-60 min-h-[24px]',
                        on ? 'bg-emerald-600' : 'bg-gray-300')}>
                <span className={cn('absolute top-0.5 left-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-transform',
                  on && 'translate-x-5')}>
                  {busy === r.key && <Loader2 className="h-3 w-3 animate-spin text-gray-500" />}
                </span>
              </button>
            </div>
            </div>
          )
        })}
      </div>
      {err && <p className="px-4 pb-3 text-[12px] font-semibold text-rose-700">{err}</p>}
    </Card>
  )
}
