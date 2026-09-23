'use client'
// Data › From IN4 — the waiting IN4 sub-projects, grouped by IN4 project, with
// a tick each. "Bring in" creates the hub projects (Not finished) and their
// links; "Skip" puts them aside so the sync stops offering them. Filter chips
// by kind, because Execution is what usually comes in and Design /
// Consultancy usually does not.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowDownToLine, EyeOff, Check } from 'lucide-react'
import { INTAKE_KIND_LABEL, type IntakeKind } from '@/lib/in4/intake'
import type { IntakeRow } from '@/lib/in4/intake.server'
import { bringInFromIn4, skipFromIn4 } from './intake-actions'

const KINDS: IntakeKind[] = ['execution', 'design', 'consultancy', 'other']
const TONE: Record<IntakeKind, string> = {
  execution: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  design: 'border-sky-300 bg-sky-50 text-sky-800',
  consultancy: 'border-violet-300 bg-violet-50 text-violet-800',
  other: 'border-gray-300 bg-gray-50 text-gray-700',
}

export function IntakeClient({ rows, canAct }: { rows: IntakeRow[]; canAct: boolean }) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [kindFilter, setKindFilter] = useState<IntakeKind | 'all'>('all')
  const [busy, setBusy] = useState<'add' | 'skip' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [, start] = useTransition()

  const shown = useMemo(() => rows.filter(r => kindFilter === 'all' || r.kind === kindFilter), [rows, kindFilter])
  const counts = useMemo(() => {
    const c: Record<IntakeKind, number> = { execution: 0, design: 0, consultancy: 0, other: 0 }
    for (const r of rows) c[r.kind]++
    return c
  }, [rows])
  const byProject = useMemo(() => {
    const m = new Map<string, IntakeRow[]>()
    for (const r of shown) (m.get(r.in4ProjectName) ?? m.set(r.in4ProjectName, []).get(r.in4ProjectName)!).push(r)
    return [...m.entries()]
  }, [shown])

  const toggle = (id: number) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pickAllShown = () => setPicked(new Set(shown.map(r => r.subprojectId)))
  const clear = () => setPicked(new Set())

  async function act(kind: 'add' | 'skip') {
    const ids = [...picked]
    if (ids.length === 0) return
    setBusy(kind); setMsg(null); setErr(null)
    const r = kind === 'add' ? await bringInFromIn4(ids) : await skipFromIn4(ids)
    setBusy(null)
    if (!r.ok) { setErr(r.error ?? 'Could not do that.'); return }
    if (kind === 'add') {
      const a = r as { added: number; groupsCreated: number }
      setMsg(`${a.added} brought in${a.groupsCreated ? `, ${a.groupsCreated} new group${a.groupsCreated === 1 ? '' : 's'}` : ''} — each is “Not finished” until it has an Atm Head and categories. Budget (ERP) fills on the next IN4 run.`)
    } else {
      setMsg(`${(r as { skipped: number }).skipped} skipped — the sync will not offer them again.`)
    }
    clear()
    start(() => router.refresh())
  }

  if (rows.length === 0) {
    return <p className="rounded-r-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Nothing is waiting. Every active IN4 sub-project is either in the hub or was skipped. New ones arrive with the twice-daily sync.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setKindFilter('all')} className={`h-9 px-3 rounded-full border text-[12.5px] font-semibold ${kindFilter === 'all' ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300 text-gray-700 bg-white'}`}>All {rows.length}</button>
        {KINDS.filter(k => counts[k] > 0).map(k => (
          <button key={k} type="button" onClick={() => setKindFilter(k)} className={`h-9 px-3 rounded-full border text-[12.5px] font-semibold ${kindFilter === k ? 'bg-gray-900 border-gray-900 text-white' : `${TONE[k]}`}`}>{INTAKE_KIND_LABEL[k]} {counts[k]}</button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 text-[12px]">
          <button type="button" onClick={pickAllShown} className="h-9 px-2.5 rounded-md border border-gray-300 bg-white font-medium text-gray-700">Tick all shown</button>
          <button type="button" onClick={clear} className="h-9 px-2.5 rounded-md border border-gray-300 bg-white font-medium text-gray-700">Clear</button>
        </span>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {byProject.map(([project, list]) => (
          <div key={project}>
            <div className="px-4 py-1.5 bg-gray-50 border-y border-gray-100 text-[11px] font-bold uppercase tracking-wider text-gray-500 first:border-t-0">{project} <span className="font-normal normal-case tracking-normal">· goes under {list[0].goesUnder}</span></div>
            <ul className="divide-y divide-gray-100">
              {list.map(r => {
                const on = picked.has(r.subprojectId)
                return (
                  <li key={r.subprojectId}>
                    <label className={`flex items-start gap-3 px-4 py-2.5 min-h-[44px] cursor-pointer hover:bg-gray-50 ${on ? 'bg-indigo-50/50' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(r.subprojectId)} className="mt-1 h-4 w-4 accent-indigo-600" aria-label={`Bring in ${r.name}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{r.name}</span>
                        <span className="block text-[11.5px] text-gray-500 tabular-nums">
                          {r.exCode && <span className="font-mono mr-2">{r.exCode}</span>}
                          {r.areaFt ? `${r.areaFt.toLocaleString('en-IN')} sft` : 'no area in IN4'}
                          {r.budget ? ` · IN4 budget ₹${Math.round(r.budget).toLocaleString('en-IN')}` : ''}
                        </span>
                      </span>
                      <span className={`inline-flex items-center h-6 px-2 rounded-full border text-[10.5px] font-semibold whitespace-nowrap ${TONE[r.kind]}`}>{INTAKE_KIND_LABEL[r.kind]}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white/95 backdrop-blur px-3 py-2.5">
        <span className="text-[13px] text-gray-700 tabular-nums flex-1 min-w-[140px]">{picked.size} ticked</span>
        {canAct ? (
          <>
            <button type="button" onClick={() => act('skip')} disabled={busy !== null || picked.size === 0} className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-gray-300 bg-white text-[13px] font-semibold text-gray-700 disabled:opacity-50">
              {busy === 'skip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />} Skip
            </button>
            <button type="button" onClick={() => act('add')} disabled={busy !== null || picked.size === 0} className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50">
              {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />} Bring in {picked.size > 0 ? picked.size : ''}
            </button>
          </>
        ) : (
          <span className="text-[12px] text-gray-500">Only an admin, or someone given “Bring in from IN4” under People › Powers, can bring these in.</span>
        )}
      </div>
      {msg && <p className="text-[13px] text-emerald-800 inline-flex items-start gap-1.5"><Check className="h-4 w-4 mt-0.5 flex-shrink-0" /> {msg}</p>}
      {err && <p className="text-[13px] text-rose-700">{err}</p>}
    </div>
  )
}
