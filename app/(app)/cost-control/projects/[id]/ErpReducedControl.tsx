'use client'
// "The ERP budget has been reduced too."
//
// Closing a line does not take the leftover money out of IN4 — somebody has to
// go and do that. This is the tick that says they did, and until it is ticked
// the amount shows as still sitting in the ERP.
//
// Deliberately a different permission from closing: management decides the work
// is finished, the person who keys IN4 (cost-control role `billing` or
// `coordinator`) says the money actually came out. Everyone else sees the state
// but no control — the pending amount is worth knowing even if you can't act on
// it, which is why this renders as text rather than disappearing.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Loader2, Check, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatINR, formatDate } from '@/lib/utils'
import { setErpReduced } from './actions'

export function ErpReducedControl({
  projectId, disciplineId, subSkillId, label,
  savings, reducedAt, reducedAmt, reducedByName, canTick, variant,
}: {
  projectId: string
  disciplineId: string
  subSkillId: string
  label: string
  /** Leftover budget as it stands right now, from the live budget line. */
  savings: number
  reducedAt: string | null
  /** What the saving was when it was ticked — frozen, so a later BPH sync
   *  moving the live figure doesn't rewrite history. */
  reducedAmt: number | null
  reducedByName: string | null
  canTick: boolean
  variant: 'card' | 'row'
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const run = (reduced: boolean) => {
    start(async () => {
      setErr(null)
      const r = await setErpReduced(projectId, disciplineId, subSkillId, reduced, null)
      if (!r.ok) { setErr(r.error); return }
      toast.success(reduced ? `${label} — ERP budget marked reduced` : `${label} — ERP reduction undone`)
      router.refresh()
    })
  }

  // Nothing left over and nobody has ticked anything: there is no story here.
  if (!reducedAt && savings <= 0) return null

  const done = reducedAt != null
  const shown = done ? (reducedAmt ?? savings) : savings

  if (variant === 'row') {
    return (
      <span className="inline-flex items-center gap-1">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap border ${
            done
              ? 'bg-teal-50 text-teal-800 border-teal-200'
              : 'bg-amber-50 text-amber-800 border-amber-300'
          }`}
          title={done
            ? `${formatINR(shown)} removed from the ERP budget on ${formatDate(reducedAt!)}${reducedByName ? ` by ${reducedByName}` : ''}`
            : `${formatINR(shown)} of unspent budget is still sitting in IN4 and needs to be removed`}
        >
          <Landmark className="h-3 w-3" />
          {done ? `ERP −${formatINR(shown)}` : `ERP: ${formatINR(shown)} to remove`}
        </span>
        {canTick && (
          <button
            type="button" onClick={() => run(!done)} disabled={pending}
            title={done ? 'Undo — the budget is still in IN4' : 'I have removed this from the IN4 budget'}
            className="inline-flex items-center justify-center h-5 w-5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" />
              : done ? <Undo2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}
          </button>
        )}
        {err && <span className="text-[10px] font-semibold text-rose-700 max-w-[180px] leading-tight">{err}</span>}
      </span>
    )
  }

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 ${done ? 'border-teal-200 bg-teal-50' : 'border-amber-300 bg-amber-50'}`}>
      <p className={`text-[12.5px] font-semibold inline-flex items-center gap-1.5 ${done ? 'text-teal-900' : 'text-amber-900'}`}>
        <Landmark className="h-4 w-4" />
        {done ? 'ERP budget reduced' : 'ERP budget still to be reduced'}
      </p>
      <p className={`text-[11px] mt-0.5 ${done ? 'text-teal-800' : 'text-amber-800'}`}>
        {done
          ? <>{formatINR(shown)} removed from IN4 on {formatDate(reducedAt!)}{reducedByName ? ` by ${reducedByName}` : ''}.</>
          : <><b>{formatINR(shown)}</b> of unspent budget is still sitting in IN4 for this sub-category and needs to be taken out.</>}
      </p>
      {canTick && (
        <button
          type="button" onClick={() => run(!done)} disabled={pending}
          className={`mt-2 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-md border bg-white text-[12px] font-semibold disabled:opacity-50 ${
            done ? 'border-teal-300 text-teal-800' : 'border-amber-400 text-amber-900'
          }`}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : done ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {done ? 'Undo — still in IN4' : 'ERP budget reduced'}
        </button>
      )}
      {err && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{err}</p>}
    </div>
  )
}
