'use client'

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'
import { formatDateTime, formatNumber } from '@/lib/utils'
import type { Stage, Register } from '@/lib/stores/core'

/**
 * The shared chrome for the Stores section.
 *
 * Everything here is mobile-first: a guard fills the gate form on a phone in
 * the rain, so tap targets are 44px and no table squashes — wide ones scroll
 * inside their own box rather than pushing the page sideways.
 */

/* ── Feedback ───────────────────────────────────────────────────────────── */

export function Notice({ kind, children }: { kind: 'ok' | 'bad' | 'info'; children: ReactNode }) {
  const tone = kind === 'ok'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
    : kind === 'bad'
      ? 'bg-rose-50 border-rose-200 text-rose-900'
      : 'bg-blue-50 border-blue-200 text-blue-900'
  return (
    <div role="alert" className={`rounded-lg border px-3 py-2.5 text-[13px] whitespace-pre-line ${tone}`}>
      {children}
    </div>
  )
}

/** Empty is a sentence, never a blank panel. */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-4 py-9 text-center">
      <p className="text-[14px] font-semibold text-gray-800">{title}</p>
      {hint && <p className="text-[12.5px] text-gray-500 mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── Form fields ────────────────────────────────────────────────────────── */

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11.5px] text-gray-500 mt-1 leading-snug">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] min-h-[44px] ' +
  'focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200 disabled:bg-gray-50 disabled:text-gray-500'

export function Btn({
  children, onClick, kind = 'primary', disabled, busy, type = 'button', full,
}: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean; busy?: boolean; type?: 'button' | 'submit'; full?: boolean
}) {
  const tone = kind === 'primary'
    ? 'bg-indigo-700 text-white hover:bg-indigo-800 disabled:bg-indigo-300'
    : kind === 'danger'
      ? 'bg-white text-rose-700 border border-rose-300 hover:bg-rose-50'
      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
  return (
    <button
      type={type} onClick={onClick} disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold min-h-[44px] disabled:cursor-not-allowed ${tone} ${full ? 'w-full' : ''}`}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

/* ── Status ─────────────────────────────────────────────────────────────── */

const STAGE_LOOK: Record<Stage, { label: string; cls: string }> = {
  gate:     { label: 'Waiting on storekeeper', cls: 'bg-amber-100 text-amber-900' },
  complete: { label: 'Complete',               cls: 'bg-emerald-100 text-emerald-800' },
  closed:   { label: 'Closed',                 cls: 'bg-gray-200 text-gray-700' },
  void:     { label: 'Voided',                 cls: 'bg-rose-100 text-rose-800' },
}

export function StageChip({ stage }: { stage: Stage }) {
  const s = STAGE_LOOK[stage] ?? STAGE_LOOK.gate
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold ${s.cls}`}>{s.label}</span>
}

const REGISTER_LOOK: Record<Register, { label: string; cls: string }> = {
  vendor:   { label: 'Vendor → site', cls: 'bg-sky-100 text-sky-900' },
  srm:      { label: 'SRMD stock',    cls: 'bg-violet-100 text-violet-900' },
  transfer: { label: 'Transfer',      cls: 'bg-teal-100 text-teal-900' },
}

export function RegisterChip({ register }: { register: Register }) {
  const r = REGISTER_LOOK[register] ?? REGISTER_LOOK.srm
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${r.cls}`}>{r.label}</span>
}

export function StatusChip({ status }: { status: string }) {
  const cls = {
    pending:  'bg-amber-100 text-amber-900',
    approved: 'bg-blue-100 text-blue-900',
    rejected: 'bg-rose-100 text-rose-800',
    issued:   'bg-emerald-100 text-emerald-800',
    closed:   'bg-gray-200 text-gray-700',
  }[status] ?? 'bg-gray-200 text-gray-700'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold capitalize ${cls}`}>{status}</span>
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

/** A live count on a tile — Aksha's V1 rule: the tile says what is waiting. */
export function Tile({ href, label, count, sub, tone = 'slate' }: {
  href: string; label: string; count?: number; sub: string; tone?: 'amber' | 'blue' | 'emerald' | 'slate'
}) {
  const waiting = (count ?? 0) > 0
  const ring = waiting
    ? { amber: 'border-amber-300 bg-amber-50', blue: 'border-blue-300 bg-blue-50', emerald: 'border-emerald-300 bg-emerald-50', slate: 'border-gray-300 bg-white' }[tone]
    : 'border-gray-200 bg-white'
  return (
    <Link href={href} className={`block rounded-xl border p-4 hover:shadow-sm transition-shadow min-h-[44px] ${ring}`}>
      <p className="text-[13px] font-bold text-gray-900">{label}</p>
      {count != null && (
        <p className={`text-2xl font-bold mt-1 tabular-nums ${waiting ? 'text-gray-900' : 'text-gray-400'}`}>
          {formatNumber(count, 0)}
        </p>
      )}
      <p className="text-[11.5px] text-gray-500 mt-0.5 leading-snug">{sub}</p>
    </Link>
  )
}

export function Section({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
          {note && <p className="text-[12px] text-gray-500 mt-0.5">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

/** Wide tables scroll inside their own box; the page never goes sideways. */
export function Scroller({ children, min = 720 }: { children: ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
      <div style={{ minWidth: min }}>{children}</div>
    </div>
  )
}

export const th = 'text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 px-3 py-2 border-b border-gray-200 bg-gray-50 whitespace-nowrap'
/** Right-aligned header, for a column of numbers. NOT :
 *  both are text-align utilities of equal specificity, so which one wins is
 *  decided by their order in the generated stylesheet rather than by the order
 *  they are written in — the header drifted left while its column sat right. */
export const thNum = 'text-right text-[10px] font-bold uppercase tracking-wider text-gray-500 px-3 py-2 border-b border-gray-200 bg-gray-50 whitespace-nowrap'

export const td = 'px-3 py-2.5 text-[13px] text-gray-800 border-b border-gray-100 align-top'
export const tdNum = `${td} text-right tabular-nums whitespace-nowrap`

/* ── Action button that reports what happened ───────────────────────────── */

export function ActionButton({
  run, children, kind = 'primary', confirm, disabled, onDone,
}: {
  run: () => Promise<{ ok: boolean; message: string }>
  children: ReactNode
  kind?: 'primary' | 'ghost' | 'danger'
  confirm?: string
  disabled?: boolean
  onDone?: (ok: boolean) => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  return (
    <div className="space-y-2">
      <Btn
        kind={kind} busy={pending} disabled={disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          start(async () => {
            const r = await run()
            setResult(r)
            onDone?.(r.ok)
          })
        }}
      >
        {children}
      </Btn>
      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
    </div>
  )
}

export function When({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="text-gray-400">—</span>
  return <span className="text-[12px] text-gray-500 whitespace-nowrap">{formatDateTime(at)}</span>
}

/* ── Pickers ────────────────────────────────────────────────────────────── */

// Moved to components/ui/grouped-options.tsx when the other eleven project
// pickers in the app needed it too. Re-exported so nothing in Stores had to
// move with it.
export { GroupedOptions } from '@/components/ui/grouped-options'
