'use client'
// "Mark complete" on a sub-category — the HOD's point 3.
//
// Only rendered where WO/PO committed equals Paid, so it is a rare control
// rather than another widget on every row (32 of SRAH's hundreds of rows).
// Built phone-first: on a card it is a full-width 44px button with the saving
// spelled out; on the desktop table it collapses to a compact chip, because
// the row already carries the Budget / WO / Paid columns beside it.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR, formatDate } from '@/lib/utils'
import { setSubSkillCompleted } from './actions'

export function CompleteControl({
  projectId, disciplineId, subSkillId, label,
  savings, completedAt, completedByName, canWrite, variant,
}: {
  projectId: string
  disciplineId: string
  subSkillId: string
  /** "1213 SS Works" — used in the confirm text so he knows what he is closing. */
  label: string
  /** Budget left over once closed. May be 0 on a line spent to the rupee. */
  savings: number
  completedAt: string | null
  completedByName: string | null
  canWrite: boolean
  variant: 'card' | 'row'
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const run = (complete: boolean) => {
    start(async () => {
      setErr(null)
      const r = await setSubSkillCompleted(projectId, subSkillId, disciplineId, complete, null)
      if (!r.ok) { setErr(r.error); return }
      toast.success(complete
        ? (savings > 0 ? `${label} closed — ${formatINR(savings)} released` : `${label} closed`)
        : `${label} reopened`)
      router.refresh()
    })
  }

  const onComplete = async () => {
    // Say what it means in money before he commits to it.
    const ok = await confirm({
      title: `Close ${label}?`,
      message: savings > 0
        ? `Everything committed here has been paid. Closing it records the work as finished and shows ${formatINR(savings)} of unspent budget as released. The ERP budget itself is not changed — that still comes from IN4.`
        : `Everything committed here has been paid, with no budget left over. Closing it records the work as finished. The ERP budget itself is not changed — that still comes from IN4.`,
      confirmLabel: 'Mark complete',
      // Closing a finished line is housekeeping, not a destructive act.
      danger: false,
    })
    if (ok) run(true)
  }

  // ── Already closed ────────────────────────────────────────────────
  if (completedAt) {
    const when = formatDate(completedAt)
    const who = completedByName ? ` by ${completedByName}` : ''
    if (variant === 'row') {
      return (
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap"
            title={`Closed ${when}${who}${savings > 0 ? ` · ${formatINR(savings)} released` : ''}`}
          >
            <CheckCircle2 className="h-3 w-3" /> DONE
          </span>
          {canWrite && (
            <button
              type="button" onClick={() => run(false)} disabled={pending}
              title="Reopen this sub-category"
              className="inline-flex items-center justify-center h-5 w-5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            </button>
          )}
        </span>
      )
    }
    return (
      <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <p className="text-[13px] font-semibold text-emerald-900 inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4" /> Complete
        </p>
        <p className="text-[11px] text-emerald-800 mt-0.5">
          Closed {when}{who}.
          {savings > 0 && <> Budget reduced to what was paid — <b>{formatINR(savings)} released</b>.</>}
        </p>
        {canWrite && (
          <button
            type="button" onClick={() => run(false)} disabled={pending}
            className="mt-2 inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 rounded-md border border-emerald-300 bg-white text-[12px] font-semibold text-emerald-800 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Reopen
          </button>
        )}
        {err && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{err}</p>}
      </div>
    )
  }

  // ── Open, and eligible to close ───────────────────────────────────
  if (!canWrite) return null

  if (variant === 'row') {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button
          type="button" onClick={onComplete} disabled={pending}
          title={savings > 0
            ? `WO and Paid match — close this and release ${formatINR(savings)}`
            : 'WO and Paid match — close this sub-category'}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Mark complete
        </button>
        {err && <span className="text-[10px] font-semibold text-rose-700 max-w-[180px] leading-tight">{err}</span>}
      </span>
    )
  }

  return (
    <div className="mt-2.5">
      <button
        type="button" onClick={onComplete} disabled={pending}
        className="flex w-full items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-800 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        Mark complete
        {savings > 0 && <span className="font-normal">· releases {formatINR(savings)}</span>}
      </button>
      <p className="mt-1 text-[11px] text-gray-500">WO and Paid match, so nothing more is owed here.</p>
      {err && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{err}</p>}
    </div>
  )
}
