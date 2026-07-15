'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CockpitBill } from '@/lib/bills-pipeline/transform'

// ── money helpers (Indian) ──────────────────────────────────────────────────
function inr(n: number): string {
  const v = Math.round(n || 0); const s = Math.abs(v).toString(); const neg = v < 0 ? '-' : ''
  if (s.length <= 3) return neg + s
  return neg + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
}
function cr(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + inr(n)
}
const sum = (a: CockpitBill[]) => a.reduce((s, b) => s + b.claimed, 0)
function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function rotColor(md: number): string {
  return md > 21 ? '#c0392b' : md > 7 ? '#c68a1a' : '#2e7d54'
}
// Order stages internal-first, Trust last.
const STAGE_ORDER = ['Site Head', 'CT Billing', 'CT Head', 'CT Disc Head']
function stageRank(stage: string, atTrust: boolean): number {
  if (atTrust) return 90
  const i = STAGE_ORDER.findIndex(s => stage.toLowerCase().includes(s.toLowerCase()))
  return i >= 0 ? i : 50
}

type Filter = { kind: 'all' } | { kind: 'pending' } | { kind: 'trust' } | { kind: 'stalled' } | { kind: 'stage'; stage: string }

export default function Cockpit({ bills, asOf }: { bills: CockpitBill[]; asOf: string }) {
  const [project, setProject] = useState<string>('ALL')
  const [mode, setMode] = useState<'value' | 'count'>('value')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [open, setOpen] = useState<CockpitBill | null>(null)

  const projects = useMemo(() => [...new Set(bills.map(b => b.project).filter(Boolean))].sort(), [bills])
  const scoped = useMemo(() => bills.filter(b => project === 'ALL' || b.project === project), [bills, project])

  const internal = useMemo(() => scoped.filter(b => !b.atTrust), [scoped])
  const trust = useMemo(() => scoped.filter(b => b.atTrust), [scoped])
  const stalled = useMemo(() => internal.filter(b => b.idle > 21), [internal])

  const fnum = (a: CockpitBill[]) => (mode === 'value' ? cr(sum(a)) : String(a.length))

  // KPI tiles
  const kpis = [
    { key: 'all' as const, cap: 'Live pipeline', a: scoped, col: '#22344f', sub: `${scoped.length} bills` },
    { key: 'pending' as const, cap: 'Pending with CT', a: internal, col: '#c68a1a', sub: `${internal.length} bills` },
    { key: 'trust' as const, cap: 'At Trust A/c', a: trust, col: '#2e7d54', sub: `${trust.length} bills` },
    { key: 'stalled' as const, cap: 'Stalled > 21d', a: stalled, col: '#c0392b', sub: `${stalled.length} bills` },
  ]

  // Push Today
  const pushBase = useMemo(() => {
    if (filter.kind === 'trust') return trust
    if (filter.kind === 'stalled') return stalled
    if (filter.kind === 'stage') return scoped.filter(b => b.stage === filter.stage || (filter.stage === 'Submitted to Trust A/c' && b.atTrust))
    if (filter.kind === 'pending') return internal
    return internal // default: what's in our court
  }, [filter, internal, trust, stalled, scoped])

  const push = useMemo(() => {
    return [...pushBase]
      .map(b => ({ b, sc: b.claimed * (1 + b.idle / 20) * (b.idle > 21 ? 1.8 : 1) * (b.noWO ? 1.4 : 1) }))
      .sort((x, y) => y.sc - x.sc).slice(0, 12).map(o => o.b)
  }, [pushBase])

  // Rot funnel — dynamic stages present among live bills
  const funnel = useMemo(() => {
    const map = new Map<string, CockpitBill[]>()
    for (const b of scoped) {
      const key = b.atTrust ? 'Submitted to Trust A/c' : (b.stage || '—')
      const arr = map.get(key) ?? []; arr.push(b); map.set(key, arr)
    }
    const segs = [...map.entries()].map(([stage, group]) => ({
      stage, group, val: sum(group),
      md: median(group.map(b => b.idle)),
      oldest: group.reduce((m, b) => Math.max(m, b.idle), 0),
      atTrust: group[0]?.atTrust ?? false,
    }))
    segs.sort((a, b) => stageRank(a.stage, a.atTrust) - stageRank(b.stage, b.atTrust))
    const max = Math.max(...segs.map(s => s.val), 1)
    return { segs, max }
  }, [scoped])

  // Whose desk (internal, grouped by stage)
  const desks = useMemo(() => {
    const map = new Map<string, CockpitBill[]>()
    for (const b of internal) { const arr = map.get(b.stage) ?? []; arr.push(b); map.set(b.stage, arr) }
    const rows = [...map.entries()].map(([stage, g]) => ({
      stage, bills: g.length, val: sum(g),
      oldest: g.reduce((m, b) => Math.max(m, b.idle), 0),
      stall: g.filter(b => b.idle > 21).length,
    })).sort((a, b) => b.val - a.val)
    return { rows, max: Math.max(...rows.map(r => r.val), 1) }
  }, [internal])

  const dispStage = (s: string) => s.replace('Submitted to Trust A/c', 'At Trust A/c')
  const briefStalledVal = cr(sum(stalled))
  const noWoCount = internal.filter(b => b.noWO).length

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Site</span>
        {['ALL', ...projects].map(p => (
          <button key={p} onClick={() => setProject(p)}
            className={cn('rounded-full border px-3 py-1 text-[13px] font-semibold transition',
              project === p ? 'border-slate-800 bg-slate-800 text-white' : 'border-gray-300 text-gray-500 hover:border-amber-500 hover:text-gray-800')}>
            {p === 'ALL' ? 'All sites' : p}
          </button>
        ))}
        <div className="ml-1 inline-flex overflow-hidden rounded-full border border-gray-300">
          {(['value', 'count'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('px-3 py-1 text-[13px] font-bold', mode === m ? 'bg-amber-500 text-amber-950' : 'bg-white text-gray-500')}>
              {m === 'value' ? '₹ Value' : '＃ Count'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12.5px] text-gray-500">
          {project === 'ALL' ? 'All sites' : project}
          {filter.kind !== 'all' && <> › <b className="text-gray-700">{filter.kind === 'stage' ? dispStage(filter.stage) : filter.kind}</b></>}
          {' '}— <b className="text-gray-700">{scoped.length} bills · {cr(sum(scoped))}</b>
        </span>
      </div>

      {/* Briefing */}
      <div className="flex items-start gap-3 rounded-xl border border-gray-200 border-l-4 border-l-amber-500 bg-white p-3.5 shadow-sm">
        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Morning briefing</div>
          <p className="m-0 text-[14.5px] text-gray-800">
            <b>{stalled.length} bills stalled &gt; 21 days ({briefStalledVal})</b> · {internal.length} pending with CT · {trust.length} at Trust · {noWoCount} missing a WO. Tap any number to see the exact bills.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map(t => (
          <button key={t.key} onClick={() => setFilter(f => (f.kind === t.key ? { kind: 'all' } : { kind: t.key } as Filter))}
            className={cn('relative rounded-xl border bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5',
              filter.kind === t.key ? 'border-slate-800 ring-1 ring-slate-800' : 'border-gray-200')}>
            <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-xl" style={{ background: t.col }} />
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{t.cap}</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">{fnum(t.a)}</div>
            <div className="mt-0.5 text-[12.5px] text-gray-500">{t.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        {/* Push Today */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-baseline gap-2 px-4 pb-2 pt-3.5">
            <h2 className="m-0 text-base font-bold">Push today</h2>
            <span className="ml-auto text-xs text-gray-400">{push.length} to push · ranked by ₹ × age</span>
          </div>
          <div className="px-2 pb-3">
            {push.length === 0 && <div className="p-5 text-center text-sm text-gray-500">Nothing to push in this slice.</div>}
            {push.map((b, i) => (
              <button key={b.id} onClick={() => setOpen(b)}
                className="grid w-full grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-gray-50">
                <span className="text-center text-xs font-bold text-gray-400 tabular-nums">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-gray-900">{b.vendor}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-500">
                    <span className="rounded bg-slate-800 px-1.5 py-px text-[11px] font-bold text-white">{b.project}</span>
                    {b.area} · {dispStage(b.stage)}
                    {b.noWO && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-800">No WO</span>}
                    {b.idle > 21 && <span className="rounded-full bg-red-100 px-1.5 py-px text-[11px] font-bold text-red-700">Stalled {b.idle}d</span>}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-[14px] font-bold tabular-nums text-gray-900">₹{inr(b.claimed)}</span>
                  <span className={cn('block text-[12px] tabular-nums', b.idle > 21 ? 'text-red-600' : 'text-gray-500')}>{b.idle}d idle</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Whose desk */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-baseline gap-2 px-4 pb-2 pt-3.5">
            <h2 className="m-0 text-base font-bold">Whose desk is choking it</h2>
            <span className="ml-auto text-xs text-gray-400">by ₹ held</span>
          </div>
          <div className="px-2 pb-3">
            {desks.rows.length === 0 && <div className="p-5 text-center text-sm text-gray-500">Nothing pending with CT.</div>}
            {desks.rows.map(r => {
              const col = r.oldest > 21 ? '#c0392b' : r.oldest > 7 ? '#c68a1a' : '#2e7d54'
              return (
                <button key={r.stage} onClick={() => setFilter({ kind: 'stage', stage: r.stage })}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-gray-800">{dispStage(r.stage)}</span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded bg-gray-100">
                      <span className="block h-full rounded" style={{ width: `${Math.round(r.val / desks.max * 100)}%`, background: col }} />
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13px] font-bold tabular-nums">{mode === 'value' ? cr(r.val) : r.bills}</span>
                    <span className="block text-[11.5px] text-gray-500 tabular-nums">{r.bills} bills · oldest {r.oldest}d{r.stall ? ` · ${r.stall} stalled` : ''}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Rot funnel */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-baseline gap-2 px-4 pb-2 pt-3.5">
          <h2 className="m-0 text-base font-bold">Where the money sits — by stage</h2>
          <span className="ml-auto text-xs text-gray-400">width = ₹ · colour = how long it sits · tap to drill</span>
        </div>
        <div className="px-3 pb-4">
          <div className="flex gap-1 overflow-x-auto pb-1 pt-1">
            {funnel.segs.map(s => {
              const w = Math.max(6, Math.round(s.val / funnel.max * 100))
              const col = s.atTrust ? '#2f6fb0' : rotColor(s.md)
              const active = filter.kind === 'stage' && filter.stage === s.stage
              return (
                <button key={s.stage} onClick={() => setFilter(f => (active ? { kind: 'all' } : { kind: 'stage', stage: s.stage }))}
                  title={`${dispStage(s.stage)} — oldest ${s.oldest}d`}
                  className={cn('relative flex h-16 min-w-[42px] flex-col items-center justify-center overflow-hidden rounded-md text-white transition',
                    active && 'outline outline-2 outline-offset-2 outline-slate-800')}
                  style={{ flex: `${w} 1 0`, background: col }}>
                  <span className="absolute right-1 top-1 rounded bg-black/25 px-1 text-[9px]">{s.oldest}d</span>
                  <span className="text-[15px] font-bold leading-none tabular-nums">{mode === 'value' ? cr(s.val).replace('₹', '') : s.group.length}</span>
                  <span className="mt-0.5 text-[10.5px] opacity-90">{mode === 'value' ? `${s.group.length} bills` : cr(s.val)}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-1 flex gap-1 overflow-x-auto">
            {funnel.segs.map(s => {
              const w = Math.max(6, Math.round(s.val / funnel.max * 100))
              return <div key={s.stage} className="min-w-[42px] text-center text-[10px] leading-tight text-gray-500" style={{ flex: `${w} 1 0` }}>{dispStage(s.stage)}</div>
            })}
          </div>
        </div>
      </div>

      <p className="text-center text-[11.5px] text-gray-400">
        Read-only tracking · as on {asOf} · auto-synced from Zoho twice daily · IN4 processing view is the next module. Nothing here needs data entry.
      </p>

      {/* Journey modal */}
      {open && <Journey bill={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

// ── Per-bill journey (Zoho portion live; IN4 tail shown as pending sync) ──────
function Journey({ bill, onClose }: { bill: CockpitBill; onClose: () => void }) {
  const zohoStages = ['Site Head', 'CT Billing', 'CT Head', 'CT Disc Head', 'Submitted to Trust A/c']
  const curIdx = bill.atTrust ? 4 : Math.max(0, zohoStages.findIndex(s => bill.stage.toLowerCase().includes(s.toLowerCase())))
  const nodes = [...zohoStages.map((s, i) => ({ label: s.replace('Submitted to Trust A/c', 'Submitted to Trust'), sys: 'Zoho', done: i < curIdx, cur: i === curIdx, pending: false })),
    { label: 'Entered in IN4', sys: 'IN4', done: false, cur: false, pending: true },
    { label: 'Paid', sys: 'IN4', done: false, cur: false, pending: true }]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-gray-200 p-5">
          <div>
            <h2 className="m-0 text-lg font-bold">{bill.vendor}</h2>
            <p className="mt-1 text-[13px] text-gray-500">
              <span className="rounded bg-slate-800 px-1.5 py-px text-[11px] font-bold text-white">{bill.project}</span>{' '}
              {bill.area}{bill.disc ? ` · ${bill.disc}` : ''} · Bill {bill.billNo || '—'} · {bill.raNo || ''} · {bill.prefix}
              {bill.noWO && <span className="ml-1 font-bold text-red-600">· No WO</span>}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto h-8 w-8 rounded-lg bg-gray-100 text-lg">×</button>
        </div>
        <div className="p-5">
          <div className="mb-5 flex flex-wrap gap-2.5">
            {[['Claimed (Zoho)', bill.claimed, '#1f2d3d'], ['Certified', bill.certified, '#1f2d3d'], ['Paid in IN4', bill.paid, bill.paid ? '#2e7d54' : '#94a3b8']].map(([k, v, c]) => (
              <div key={k as string} className="min-w-[120px] flex-1 rounded-lg border border-gray-200 p-2.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{k as string}</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: c as string }}>{(v as number) ? '₹' + inr(v as number) : '—'}</div>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-0 overflow-x-auto pb-2">
            {nodes.map((n, i) => (
              <div key={i} className="relative min-w-[92px] shrink-0 text-center">
                {i > 0 && <div className={cn('absolute left-[-50%] top-3 -z-0 h-[3px] w-full', n.done ? 'bg-green-600' : 'bg-gray-200')} />}
                <div className={cn('relative z-10 mx-auto flex h-7 w-7 items-center justify-center rounded-full border-2 text-[13px] font-extrabold',
                  n.done ? 'border-green-600 bg-green-600 text-white'
                    : n.cur ? 'border-amber-500 bg-amber-500 text-amber-950 ring-4 ring-amber-500/25'
                      : n.pending ? 'border-dashed border-gray-300 bg-white text-gray-300' : 'border-gray-200 bg-white text-gray-400')}>
                  {n.done ? '✓' : i + 1}
                </div>
                <div className="mt-1.5 text-[11px] font-semibold leading-tight text-gray-800">{n.label}</div>
                <div className={cn('mt-1 inline-block rounded px-1.5 text-[9px] font-bold', n.sys === 'IN4' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>{n.sys}</div>
                {n.cur && <div className="mt-1 text-[10px] text-gray-500">{bill.idle}d here</div>}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-gray-400">
            Zoho checking stages are live. The IN4 entry/paid nodes light up once the IN4 reconciliation module is added — no entry needed, it reads the IN4 data already in the app.
          </p>
        </div>
      </div>
    </div>
  )
}
