'use client'
// "Completed" — closing finished work, at sub-category OR whole work category.
//
// Only rendered where WO/PO committed equals Paid, so it stays a rare control
// rather than another widget on every row (32 of SRAH's hundreds of rows).
// A work category offers it once every sub-category under it that carries
// money is closed or closable; clicking it closes the lot in one transaction,
// and reopening it reopens the lot — one click undone by one click.
//
// Closing is not cosmetic any more: a closed line REFUSES new budget requests
// in the database until somebody reopens it. So the confirm says that plainly,
// and says how many rows are about to move.
//
// Built phone-first: on a card it is a full-width 44px button with the saving
// spelled out; on the desktop table it collapses to a compact chip, because
// the row already carries the Budget / WO / Paid columns beside it.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR, formatDate } from '@/lib/utils'
import { setSubSkillCompleted, setDisciplineCompleted } from './actions'

export function CompleteControl({
  projectId, disciplineId, subSkillId, label, level = 'sub',
  savings, completedAt, completedByName, canWrite, variant,
  cascadeCount = 0, reopenCount = 0,
}: {
  projectId: string
  disciplineId: string
  /** Null for a whole work category. */
  subSkillId: string | null
  /** "1213 SS Works" — used in the confirm text so he knows what he is closing. */
  label: string
  level?: 'sub' | 'discipline'
  /** Budget left over once closed. May be 0 on a line spent to the rupee. */
  savings: number
  completedAt: string | null
  completedByName: string | null
  canWrite: boolean
  variant: 'card' | 'row'
  /** Category only: still-open sub-categories this click will close. */
  cascadeCount?: number
  /** Category only: closed sub-categories a reopen will reopen. */
  reopenCount?: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const isDisc = level === 'discipline'
  const noun = isDisc ? 'work category' : 'sub-category'

  const run = (complete: boolean) => {
    start(async () => {
      setErr(null)
      const r = isDisc
        ? await setDisciplineCompleted(projectId, disciplineId, complete, null)
        : await setSubSkillCompleted(projectId, subSkillId!, disciplineId, complete, null)
      if (!r.ok) { setErr(r.error); return }
      const n = r.touched ?? 0
      const also = isDisc && n > 0 ? ` · ${n} sub-categor${n === 1 ? 'y' : 'ies'}` : ''
      toast.success(complete
        ? (savings > 0 ? `${label} closed — ${formatINR(savings)} to remove from ERP${also}` : `${label} closed${also}`)
        : `${label} reopened${also}`)
      router.refresh()
    })
  }

  const onComplete = async () => {
    // Say what it means — in money, in rows, and in what stops working.
    const money = savings > 0
      ? `${formatINR(savings)} of unspent budget is left over and will show as still to be removed from IN4, for Billing to confirm once they have done it.`
      : 'Nothing is left over — everything budgeted here was paid.'
    const cascade = isDisc && cascadeCount > 0
      ? `\n\nThis also closes ${cascadeCount} sub-categor${cascadeCount === 1 ? 'y' : 'ies'} under it.`
      : ''
    const ok = await confirm({
      title: `Close ${label}?`,
      message: `Everything committed here has been paid, so the work is finished.\n\nNo new budget request can be raised on this ${noun} until it is reopened.\n\n${money}${cascade}`,
      confirmLabel: 'Completed',
      // Closing a finished line is housekeeping, not a destructive act.
      danger: false,
    })
    if (ok) run(true)
  }

  const onReopen = async () => {
    // Reopening a category pulls its sub-categories back open too. Never do
    // that silently — say how many.
    if (isDisc && reopenCount > 0) {
      const ok = await confirm({
        title: `Reopen ${label}?`,
        message: `This reopens the work category and the ${reopenCount} sub-categor${reopenCount === 1 ? 'y' : 'ies'} closed under it, so new budget requests can be raised again.`,
        confirmLabel: 'Reopen',
        danger: false,
      })
      if (!ok) return
    }
    run(false)
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
            title={`Completed ${when}${who}${savings > 0 ? ` · ${formatINR(savings)} to remove from ERP` : ''} · new requests are blocked`}
          >
            <CheckCircle2 className="h-3 w-3" /> COMPLETED
          </span>
          {canWrite && (
            <button
              type="button" onClick={onReopen} disabled={pending}
              title={`Reopen this ${noun} so requests can be raised again`}
              className="inline-flex items-center justify-center h-5 w-5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            </button>
          )}
          {err && <span className="text-[10px] font-semibold text-rose-700 max-w-[180px] leading-tight">{err}</span>}
        </span>
      )
    }
    return (
      <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <p className="text-[13px] font-semibold text-emerald-900 inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4" /> Completed
        </p>
        <p className="text-[11px] text-emerald-800 mt-0.5">
          Closed {when}{who}. No new request can be raised here until it is reopened.
        </p>
        {canWrite && (
          <button
            type="button" onClick={onReopen} disabled={pending}
            className="mt-2 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-md border border-emerald-300 bg-white text-[12px] font-semibold text-emerald-800 disabled:opacity-50"
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
            ? `WO and Paid match — close this and flag ${formatINR(savings)} to come out of ERP`
            : `WO and Paid match — close this ${noun}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Completed
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
        Completed
        {savings > 0 && <span className="font-normal">· {formatINR(savings)} to remove from ERP</span>}
      </button>
      <p className="mt-1 text-[11px] text-gray-500">
        WO and Paid match, so nothing more is owed here.
        {isDisc && cascadeCount > 0 && ` Closes ${cascadeCount} sub-categor${cascadeCount === 1 ? 'y' : 'ies'} with it.`}
      </p>
      {err && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{err}</p>}
    </div>
  )
}
