'use client'
// Small pieces shared by the person card and the project card.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Result } from '@/lib/revamp/people-grants'

/** One in-flight cell at a time; errors surface inline; success refreshes from the database. */
export function useCellRunner() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const [, start] = useTransition()
  function run(key: string, fn: () => Promise<Result>) {
    setBusy(key); setError(null)
    start(async () => {
      const r = await fn()
      setBusy(null)
      if (!r.ok) { setError(r.message ?? 'Could not save.'); return }
      router.refresh()
    })
  }
  return { busy, error, run }
}

export function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3 flex flex-col gap-2">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {hint && <p className="text-[12px] text-gray-500">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[44px] border-t border-gray-100 first:border-t-0">
      <span className="min-w-0 text-[14px] text-gray-900">{label}{hint && <span className="block text-[12px] text-gray-500">{hint}</span>}</span>
      {children}
    </div>
  )
}

export function Switch({ on, busy, label, onClick }: { on: boolean; busy: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={onClick}
      className={cn('relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-60', on ? 'bg-emerald-600' : 'bg-gray-300')}>
      <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform grid place-items-center', on && 'translate-x-5')}>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-gray-500" />}
      </span>
    </button>
  )
}

export function ToggleChip({ on, busy, label, title, onClick }: { on: boolean; busy: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} disabled={busy} title={title} onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] min-h-[32px] disabled:opacity-60',
        on ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-medium' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800')}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-indigo-500' : 'bg-gray-300')} />}
      {label}
    </button>
  )
}

/** A row of pick-one chips with a search box once the list is long. */
export function Picker({ items, value, onPick, placeholder }: { items: Array<{ key: string; label: string; sub?: string }>; value: string; onPick: (k: string) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const shown = s ? items.filter(i => i.label.toLowerCase().includes(s) || (i.sub ?? '').toLowerCase().includes(s)) : items
  return (
    <div className="flex flex-col gap-2">
      {items.length > 8 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className="h-9 w-full sm:w-64 rounded-lg border border-gray-200 px-3 text-[13px]" />
      )}
      <div className="flex flex-wrap gap-1.5">
        {shown.map(i => (
          <button key={i.key} type="button" aria-pressed={i.key === value} onClick={() => onPick(i.key)} title={i.sub}
            className={cn('rounded-full border px-3 py-1 text-[13px] min-h-[32px]', i.key === value ? 'border-gray-900 bg-gray-900 text-white font-medium' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400')}>
            {i.label}{i.sub && <span className={cn('ml-1 text-[11px]', i.key === value ? 'text-gray-300' : 'text-gray-400')}>{i.sub}</span>}
          </button>
        ))}
        {shown.length === 0 && <span className="text-[13px] text-gray-400 py-1">Nothing matches.</span>}
      </div>
    </div>
  )
}
