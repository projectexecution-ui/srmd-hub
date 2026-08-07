'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { ChevronLeft, ChevronRight, Plus, CalendarClock, Trash2, Wrench, Check } from 'lucide-react'
import { deriveStatus, daysBetween, addDays, STATUS_META, expectedPct } from '@/lib/schedule/formula'
import { deriveSchedule, readyFloors, actualCycleDays, type DerivedPlan } from '@/lib/schedule/sequence'
import type { DisplayStatus, SchedItem, FloorStatus, SchedPromise } from '@/lib/schedule/types'
import type { ProjectScheduleData } from '@/lib/schedule/data'
import { TEMPLATE_ITEM_COUNT } from '@/lib/schedule/template'
import { addSchedItem, updateSchedItem, setWoIssued, moveSchedDate, deleteSchedItem, applyTemplate, setFloorStatus, setScheduleFloors, bulkAssignSchedItems, setPromiseStatus, addPromise, setSequence, bulkIssueWo, bulkClearWo } from '../actions'

type Row = { item: SchedItem; status: DisplayStatus; woBy: string | null; behindDays: number; woLateDays: number }
type Runner = (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string, undo?: () => Promise<{ ok?: true; error?: string }>) => void

const TONE: Record<'ok' | 'soon' | 'late' | 'calm', string> = {
  ok: 'text-emerald-700 bg-emerald-50',
  soon: 'text-amber-700 bg-amber-50',
  late: 'text-rose-700 bg-rose-50',
  calm: 'text-slate-600 bg-slate-100',
}
const HEX: Record<'ok' | 'soon' | 'late' | 'calm', string> = { ok: '#0d9488', soon: '#d97706', late: '#e11d48', calm: '#94a3b8' }
const NEEDS_ATTENTION: DisplayStatus[] = ['wo_overdue', 'blocked', 'behind', 'wo_soon']
const toneOf = (s: DisplayStatus) => STATUS_META[s].tone

function whyLabel(row: Row): string {
  const { item, status, woBy, behindDays, woLateDays } = row
  switch (status) {
    case 'done': return 'Complete'
    case 'in_progress': return `${item.pct}% · on track`
    case 'behind': return `${behindDays}d behind schedule`
    case 'wo_overdue': return `WO ${woLateDays}d overdue`
    case 'wo_soon': return woBy ? `Raise WO by ${formatDate(woBy)}` : 'Raise WO soon'
    case 'blocked': return 'Blocked — drawing pending'
    case 'on_hold': return 'On hold'
    default: return item.plan_start ? `Starts ${formatDate(item.plan_start)}` : 'Not scheduled'
  }
}

function StatusChip({ status }: { status: DisplayStatus }) {
  const meta = STATUS_META[status]
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[meta.tone])}>{meta.label}</span>
}
function Chip({ tone, label }: { tone: 'ok' | 'soon' | 'late' | 'calm'; label: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', TONE[tone])}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEX[tone] }} />{label}
  </span>
}
function Ring({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const inner = size - 12
  return (
    <span className="relative grid place-items-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${pct > 0 ? color : '#e5ebf0'} ${pct}%, #e9eef3 0)` }}>
      <span className="absolute rounded-full bg-white" style={{ width: inner, height: inner }} />
      <span className="relative font-mono font-bold" style={{ fontSize: Math.round(size * 0.28), color: pct > 0 ? '#0f172a' : '#94a3b8' }}>{pct}</span>
    </span>
  )
}
function ProgressBar({ pct, tone, width = 'w-28', marker }: { pct: number; tone: 'ok' | 'soon' | 'late' | 'calm'; width?: string; marker?: number | null }) {
  return (
    <div className={cn('relative h-2 rounded-full bg-slate-100 overflow-hidden', width)}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(pct === 0 ? 0 : 4, pct)}%`, background: HEX[tone] }} />
      {marker != null && marker > 0 && marker < 100 && (
        <div className="absolute inset-y-0 w-0.5 bg-slate-500" style={{ left: `${marker}%` }} title="planned by today" />
      )}
    </div>
  )
}
function PlanVsActual({ actual, planned }: { actual: number; planned: number }) {
  const gap = planned - actual
  const tone: 'ok' | 'soon' | 'late' = gap > 10 ? 'late' : gap > 3 ? 'soon' : 'ok'
  const label = gap > 3 ? `${Math.round(gap)}% behind plan` : (actual - planned > 5 ? 'Ahead of plan' : 'On track')
  return (
    <div className="mt-2 max-w-sm">
      <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-slate-300" style={{ width: `${planned}%` }} title="planned by today" />
        <div className="absolute inset-y-0 left-0 rounded-r-full" style={{ width: `${actual}%`, background: HEX[tone] }} title="done now" />
      </div>
      <div className="flex items-center justify-between text-[11px] mt-1">
        <span className="text-slate-500">Now <b className="text-slate-700">{actual}%</b></span>
        <span className={cn('font-semibold', tone === 'late' ? 'text-rose-600' : tone === 'soon' ? 'text-amber-600' : 'text-emerald-600')}>{label}</span>
        <span className="text-slate-400">Plan {planned}%</span>
      </div>
    </div>
  )
}

/** The tower's story: which trades belong to which build phase. */
const PHASES: { name: string; trades: string[] }[] = [
  { name: 'Structure', trades: ['civil', 'waterproofing'] },
  { name: 'Services', trades: ['plumbing', 'electrical', 'fire', 'mechanical', 'ict'] },
  { name: 'Finishes', trades: ['finishes', 'external facade'] },
  { name: 'Handover', trades: ['interiors', 'cleaning'] },
]

const FLOOR_META: Record<FloorStatus, { sym: string; chip: string; label: string }> = {
  not_started: { sym: '', chip: 'bg-white text-slate-300 border-slate-200', label: 'Not started' },
  wip: { sym: '◐', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'In progress' },
  done: { sym: '✓', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Done' },
  na: { sym: '–', chip: 'bg-slate-50 text-slate-300 border-slate-200', label: 'Not applicable' },
}

/* ============================== root ============================== */

export function ScheduleClient({ data, canEdit, meId }: { data: ProjectScheduleData; canEdit: boolean; meId: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [tab, setTab] = useState<'week' | 'pulse' | 'plan'>('week')
  const [deskTab, setDeskTab] = useState<'act' | 'week' | 'map' | 'plan'>('act')

  const { project, items, drawings, leads, today, floorNames, progress, people, vendors, promises, lastWeek, weekStart } = data

  const cellStatus = useMemo(() => {
    const m = new Map<string, FloorStatus>()
    for (const p of progress) m.set(`${p.item_id}|${p.location.trim().toLowerCase()}`, p.status)
    return m
  }, [progress])
  const cellOf = (itemId: string, floor: string): FloorStatus =>
    cellStatus.get(`${itemId}|${floor.trim().toLowerCase()}`) ?? 'not_started'

  // when each floor was ticked done (drives readiness + actual pace)
  const doneStamp = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of progress) if (p.status === 'done') m.set(`${p.item_id}|${p.location.trim().toLowerCase()}`, p.updated_at)
    return m
  }, [progress])
  const doneAt = (itemId: string, floor: string) => doneStamp.get(`${itemId}|${floor.trim().toLowerCase()}`) ?? null

  // sequencing: derive every item's plan (floor windows + start/end) from the chain
  const derivedMap = useMemo(() => deriveSchedule(items, floorNames, cellOf), [items, floorNames, cellStatus]) // eslint-disable-line react-hooks/exhaustive-deps
  const effItems = useMemo(() => items.map(it => {
    const d = derivedMap.get(it.id)
    return d?.derived ? { ...it, plan_start: d.start, plan_end: d.end } : it
  }), [items, derivedMap])
  const ready = useMemo(() => readyFloors(items, floorNames, cellOf, doneAt, today), [items, floorNames, cellStatus, doneStamp, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const blockedByDrawing = useMemo(() => {
    const set = new Set<string>()
    for (const d of drawings) {
      if (!d.item_id || d.status === 'gfc') continue
      if (d.blocking || (d.target_date && d.target_date < today)) set.add(d.item_id)
    }
    return set
  }, [drawings, today])

  const rows: Row[] = useMemo(() =>
    effItems.map(item => ({ item, ...deriveStatus(item, today, { leads, drawingBlocked: blockedByDrawing.has(item.id) }) })),
    [effItems, today, leads, blockedByDrawing])
  const rowById = useMemo(() => new Map(rows.map(r => [r.item.id, r])), [rows])

  const run: Runner = (fn, okMsg, undo) => {
    start(async () => {
      const res = await fn()
      if (res?.error) { toast.error(res.error); return }
      if (okMsg) {
        if (undo) toast.success(okMsg, { duration: 6000, action: { label: 'Undo', onClick: () => start(async () => { const r = await undo(); if (r?.error) toast.error(r.error); else { toast.success('Undone'); router.refresh() } }) } })
        else toast.success(okMsg)
      }
      router.refresh()
    })
  }

  const overall = useMemo(() => {
    const active = effItems.filter(i => i.state !== 'on_hold')
    const pct = active.length ? Math.round(active.reduce((s, i) => s + i.pct, 0) / active.length) : 0
    const dated = active.filter(i => i.plan_start && i.plan_end)
    const actualScheduled = dated.length ? Math.round(dated.reduce((s, i) => s + i.pct, 0) / dated.length) : 0
    const plannedScheduled = dated.length ? Math.round(dated.reduce((s, i) => s + expectedPct(i, today), 0) / dated.length) : 0
    return { pct, count: effItems.length, datedCount: dated.length, actualScheduled, plannedScheduled }
  }, [effItems, today])

  // actual pace per item (days/floor) from real tick dates
  const paceById = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) {
      const stamps: string[] = []
      for (const f of floorNames) { const d = doneAt(it.id, f); if (d) stamps.push(d) }
      const pace = actualCycleDays(stamps)
      if (pace != null && pace > 0) m.set(it.id, pace)
    }
    return m
  }, [items, floorNames, doneStamp]) // eslint-disable-line react-hooks/exhaustive-deps

  // hero inputs: how many TRADES are waiting on WOs, and the worst pace slip
  const wodueTradeCount = useMemo(() => new Set(rows
    .filter(r => !r.item.wo_issued && (r.status === 'wo_overdue' || r.status === 'wo_soon'))
    .map(r => r.item.trade)).size, [rows])
  const actCount = useMemo(() =>
    wodueTradeCount + ready.length + rows.filter(r => r.status === 'blocked' || r.status === 'behind').length,
    [wodueTradeCount, ready, rows])
  const heroPace = useMemo(() => {
    let worst: { plan: number; actual: number } | null = null
    for (const it of items) {
      const actual = paceById.get(it.id)
      if (actual == null || !it.cycle_days) continue
      if (!worst || actual - it.cycle_days > worst.actual - worst.plan) worst = { plan: it.cycle_days, actual }
    }
    return worst
  }, [items, paceById])

  const week = <MyWeek promises={promises} lastWeek={lastWeek} rowById={rowById} cellOf={cellOf} canEdit={canEdit} projectId={project.id} pending={pending} run={run} />
  const pulse = <SitePulse rows={rows} promises={promises} lastWeek={lastWeek} floorNames={floorNames} cellOf={cellOf} overall={overall} today={today} drawings={drawings} ready={ready} derivedMap={derivedMap} doneAt={doneAt} />

  return (
    <div className="p-4 md:p-6 max-w-3xl lg:max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button asChild size="sm" variant="ghost"><Link href="/schedule"><ChevronLeft className="h-4 w-4" /> Projects</Link></Button>
        <h1 className="text-lg md:text-xl font-bold text-slate-900">{project.code ? `${project.code} — ` : ''}{project.name}</h1>
        {/* desktop page switch — keeps each page one screen tall */}
        <div className="hidden lg:inline-flex ml-3 rounded-lg border bg-slate-100 p-0.5">
          {(([
            ['act', 'Act now', actCount, actCount > 0 ? 'red' : ''],
            ['week', 'My Week', promises.length ? `${promises.filter(p => p.status === 'done').length}/${promises.length}` : 0, ''],
            ['map', 'Map', 0, ''],
            ['plan', 'Plan Room', 0, ''],
          ]) as const).map(([k, label, badge, tone]) => (
            <button key={k} onClick={() => setDeskTab(k)}
              className={cn('inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md transition', deskTab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              {label}
              {badge !== 0 && <span className={cn('rounded-full px-1.5 py-px text-[9.5px] font-extrabold',
                tone === 'red' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500')}>{badge}</span>}
            </button>
          ))}
        </div>
        {/* state strip — the verdict follows you across tabs */}
        <span className="ml-auto flex items-center gap-2">
          {wodueTradeCount > 0 && <span className="inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold bg-rose-50 text-rose-700">{wodueTradeCount} need WO</span>}
          {ready.length > 0 && <span className="inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold bg-emerald-50 text-emerald-700">{ready.length} ready</span>}
          <span className="text-xs text-slate-400 font-mono">week of {formatDate(weekStart)}</span>
        </span>
      </div>

      {/* tabs are a phone thing — the desktop cockpit shows everything at once */}
      <div className="lg:hidden sticky top-0 z-30 flex rounded-xl border bg-slate-100 p-1 shadow-sm">
        {([['week', 'My Week'], ['pulse', 'Site Pulse'], ['plan', 'Plan Room']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('flex-1 py-2 text-[13px] font-bold rounded-lg transition', tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center space-y-3 shadow-sm">
          <CalendarClock className="h-8 w-8 mx-auto text-indigo-400" />
          <p className="text-slate-600 max-w-md mx-auto">No work items yet.{canEdit ? ' Start from the standard template.' : ''}</p>
          {canEdit && <Button disabled={pending} onClick={() => run(() => applyTemplate(project.id), 'Template applied')} className="bg-indigo-600 hover:bg-indigo-700">Start from template ({TEMPLATE_ITEM_COUNT} items)</Button>}
        </Card>
      ) : (
        <>
          {/* MOBILE: one tab at a time */}
          <div className="lg:hidden">
            {tab === 'week' && week}
            {tab === 'pulse' && pulse}
          </div>

          {/* DESKTOP pages — one purpose per tab, each a single screen */}
          <div className={cn('max-w-3xl space-y-3', deskTab === 'act' ? 'hidden lg:block' : 'hidden')}>
            <HeroVerdict overall={overall} wodueTrades={wodueTradeCount} ready={ready.length}
              promises={{ kept: promises.filter(p => p.status === 'done').length, total: promises.length }}
              pace={heroPace} today={today} />
            <ActionCentre rows={rows} ready={ready} canEdit={canEdit} projectId={project.id} today={today} leadDays={leads.procurement} run={run} />
          </div>
          <div className={cn('max-w-2xl', deskTab === 'week' ? 'hidden lg:block' : 'hidden')}>
            {week}
          </div>
          <div className={cn(deskTab === 'map' ? 'hidden lg:block' : 'hidden')}>
            {pulse}
          </div>

          {/* PLAN: third tab on mobile, its own page on desktop */}
          <div className={cn(tab === 'plan' ? 'block' : 'hidden', deskTab === 'plan' ? 'lg:block' : 'lg:hidden')}>
            <p className="hidden lg:block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3 mt-2">Plan Room — all trades</p>
            <PlanRoom rows={rows} floorNames={floorNames} cellOf={cellOf} canEdit={canEdit} project={project} people={people} vendors={vendors}
              promises={promises} weekStart={weekStart} today={today} leads={leads} pending={pending} run={run} items={items}
              derivedMap={derivedMap} paceById={paceById} ready={ready} />
          </div>
        </>
      )}
    </div>
  )
}

/** Hero verdict — the page answers "how are we doing" before any row is read. */
function HeroVerdict({ overall, wodueTrades, ready, promises, pace, today }: {
  overall: { pct: number; count: number; datedCount: number; actualScheduled: number; plannedScheduled: number }
  wodueTrades: number; ready: number; promises: { kept: number; total: number }
  pace: { plan: number; actual: number } | null; today: string
}) {
  const gap = overall.plannedScheduled - overall.actualScheduled
  const behind = overall.datedCount > 0 && gap > 3
  const verdict = wodueTrades > 0
    ? <>Waiting on paperwork — <span className="text-rose-600">{wodueTrades} trade{wodueTrades === 1 ? '' : 's'} need Work Orders</span></>
    : behind ? <>Behind plan — <span className="text-amber-600">{Math.round(gap)}% short of where we should be</span></>
      : <>On track — <span className="text-emerald-600">nothing blocking</span></>
  const sub = ready > 0
    ? `${ready} floor${ready === 1 ? '' : 's'} can start today · ${overall.pct}% of the tower complete`
    : `${overall.pct}% of the tower complete`
  return (
    <Card className="p-4 shadow-sm flex items-center gap-4 flex-wrap">
      <Ring pct={overall.pct} color="#4f46e5" size={64} />
      <div className="min-w-[220px] flex-1">
        <div className="text-[15px] font-bold text-slate-900 leading-snug">{verdict}</div>
        <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <KpiTile value={wodueTrades} label="WO due" tone={wodueTrades > 0 ? 'late' : 'ok'} />
        <KpiTile value={ready} label="ready" tone={ready > 0 ? 'ok' : 'calm'} />
        <KpiTile value={`${promises.kept}/${promises.total}`} label="promises" tone="calm" />
        {pace && <KpiTile value={`${pace.actual}d`} label="pace/floor" tone={pace.actual > pace.plan ? 'soon' : 'ok'} />}
      </div>
    </Card>
  )
}
function KpiTile({ value, label, tone }: { value: number | string; label: string; tone: 'ok' | 'soon' | 'late' | 'calm' }) {
  return (
    <div className="border rounded-xl px-3 py-2 text-center min-w-[76px] bg-white">
      <div className="text-lg font-extrabold font-mono leading-tight" style={{ color: tone === 'calm' ? '#334155' : HEX[tone] }}>{value}</div>
      <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  )
}

/* ==================== Action Centre — ONE "act here" panel ====================
   Merges what were three cards (WOs to raise · needs-you · ready-to-start)
   into a single prioritised to-do: raise WO → unblock → start now. */

function ActionCentre({ rows, ready, canEdit, projectId, today, leadDays, run }: {
  rows: Row[]; ready: ReturnType<typeof readyFloors>
  canEdit: boolean; projectId: string; today: string; leadDays: number; run: Runner
}) {
  const wodue = rows.filter(r => !r.item.wo_issued && (r.status === 'wo_overdue' || r.status === 'wo_soon'))
    .sort((a, b) => b.woLateDays - a.woLateDays)
  const blocked = rows.filter(r => r.status === 'blocked' || r.status === 'behind')
  const total = wodue.length + blocked.length + ready.length
  if (total === 0) {
    return <Card className="p-3.5 shadow-sm flex items-center gap-2 text-sm text-emerald-700"><Check className="h-4 w-4" /> Nothing needs action — all clear.</Card>
  }
  // one WO goes to ONE contractor per trade — so group the paperwork by trade
  const woTrades: { trade: string; list: Row[] }[] = []
  for (const r of wodue) {
    let g = woTrades.find(x => x.trade === r.item.trade)
    if (!g) { g = { trade: r.item.trade, list: [] }; woTrades.push(g) }
    g.list.push(r)
  }
  // estimate-noise guard: if nearly everything is hugely overdue, the anchor date is the story
  const noisy = wodue.length > 15 && wodue.filter(r => r.woLateDays > 60).length / wodue.length > 0.8
  return (
    <Card className="p-0 shadow-sm overflow-hidden border-l-4 border-rose-400">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-rose-50/40 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-slate-800 text-sm inline-flex items-center gap-1.5"><Wrench className="h-4 w-4 text-rose-500" /> Action centre</h3>
        <span className="text-[11px] text-slate-500">{woTrades.length} trades need WOs · {blocked.length} stuck · {ready.length} ready</span>
      </div>
      {noisy && (
        <p className="px-4 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100">
          Most deadlines trace back to the Slab start date (currently an estimate) — set the real date in Plan Room → Civil → Slab and this list cleans itself up.
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {ready.slice(0, 3).map(r => (
          <li key={`${r.item.id}|${r.floor}`} className="flex items-center gap-3 px-4 py-2.5 bg-emerald-50/30">
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-700 whitespace-nowrap">start now</span>
            <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{r.item.name} — {r.floor}</span>
            <span className="text-[11px] text-slate-400 whitespace-nowrap">after {r.predName}</span>
          </li>
        ))}
        {ready.length > 3 && <li className="px-4 py-1.5 text-[11px] text-slate-400">+{ready.length - 3} more ready floors</li>}
        {blocked.slice(0, 3).map(r => (
          <li key={r.item.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', r.status === 'blocked' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>
              {r.status === 'blocked' ? 'blocked' : `${r.behindDays}d behind`}
            </span>
            <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{r.item.name}<span className="text-slate-400"> · {r.item.trade}</span></span>
          </li>
        ))}
        {woTrades.map(g => {
          const worst = g.list[0]
          const contractor = g.list.map(r => r.item.contractor).find(Boolean)
          return (
            <li key={g.trade}>
              <details className="group">
                <summary className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 list-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90 flex-shrink-0" />
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', worst.woLateDays > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>
                    {worst.woLateDays > 0 ? `${worst.woLateDays}d overdue` : `by ${formatDate(worst.woBy!)}`}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-800">{g.trade}
                    <span className="font-normal text-slate-400"> · {g.list.length} WO{g.list.length === 1 ? '' : 's'}{contractor ? ` · ${contractor}` : ''}</span>
                  </span>
                  {canEdit && (
                    <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
                      onClick={e => {
                        e.preventDefault(); e.stopPropagation()
                        run(() => bulkIssueWo({ projectId, trade: g.trade, issuedOn: today }),
                          `${g.list.length} ${g.trade} WO${g.list.length === 1 ? '' : 's'} marked issued`,
                          () => bulkClearWo({ projectId, trade: g.trade, issuedOn: today }))
                      }}>
                      Raise all {g.list.length}
                    </Button>
                  )}
                </summary>
                <ul className="bg-slate-50/60 divide-y divide-slate-100">
                  {g.list.map(r => <WoDueRow key={r.item.id} row={r} canEdit={canEdit} projectId={projectId} today={today} run={run} />)}
                </ul>
              </details>
            </li>
          )
        })}
      </ul>
      <p className="px-4 py-2 text-[10.5px] text-slate-400 border-t border-slate-100">WO deadline = site start − {leadDays}d · full history in the WO register</p>
    </Card>
  )
}

/** WO register — the history: when each Work Order was planned (derived
 *  work-back) vs when it was actually issued, with the early/late delta. */
function WoRegister({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false)
  const issued = rows.filter(r => r.item.wo_issued)
    .sort((a, b) => (b.item.wo_issued_on ?? '').localeCompare(a.item.wo_issued_on ?? ''))
  const pending = rows.filter(r => !r.item.wo_issued && r.woBy && r.item.pct < 100 && r.item.state !== 'on_hold')
    .sort((a, b) => (a.woBy ?? '').localeCompare(b.woBy ?? ''))
  if (!issued.length && !pending.length) return null
  const late = issued.filter(r => r.item.wo_issued_on && r.woBy && r.item.wo_issued_on > r.woBy).length
  return (
    <Card className="p-0 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 transition">
        <ChevronRight className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-90')} />
        <span className="font-bold text-slate-800 text-sm">WO register — planned vs issued</span>
        <span className="ml-auto text-[11px] text-slate-500">{issued.length} issued{late > 0 ? ` (${late} late)` : ''} · {pending.length} pending</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">
              <th className="px-4 py-2">Work</th><th className="px-2 py-2">Planned by</th><th className="px-2 py-2">Issued on</th><th className="px-2 py-2">Result</th><th className="px-2 py-2">WO no.</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pending.map(r => (
                <tr key={r.item.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{r.item.name} <span className="text-slate-400">· {r.item.trade}</span></td>
                  <td className="px-2 py-2 font-mono">{formatDate(r.woBy!)}</td>
                  <td className="px-2 py-2 text-slate-300">—</td>
                  <td className="px-2 py-2">{r.woLateDays > 0
                    ? <span className="font-semibold text-rose-600">{r.woLateDays}d overdue</span>
                    : <span className="text-slate-500">pending</span>}</td>
                  <td className="px-2 py-2 text-slate-300">—</td>
                </tr>
              ))}
              {issued.map(r => {
                const delta = r.item.wo_issued_on && r.woBy ? daysBetween(r.woBy, r.item.wo_issued_on) : null
                return (
                  <tr key={r.item.id} className="bg-emerald-50/20">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.item.name} <span className="text-slate-400">· {r.item.trade}</span></td>
                    <td className="px-2 py-2 font-mono">{r.woBy ? formatDate(r.woBy) : '—'}</td>
                    <td className="px-2 py-2 font-mono text-emerald-700">{r.item.wo_issued_on ? formatDate(r.item.wo_issued_on) : '✓'}</td>
                    <td className="px-2 py-2">{delta == null ? <span className="text-slate-400">issued</span>
                      : delta > 0 ? <span className="font-semibold text-rose-600">{delta}d late</span>
                      : <span className="font-semibold text-emerald-700">{delta === 0 ? 'on time' : `${-delta}d early`}</span>}</td>
                    <td className="px-2 py-2 font-mono">{r.item.wo_number ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ============================== ① MY WEEK ============================== */

function HoldTick({ done, blocked, onDone }: { done: boolean; blocked: boolean; onDone: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const raf = useRef<number | null>(null)
  const HOLD = 550
  const cancel = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; if (ref.current) ref.current.style.background = '' }
  const startHold = () => {
    if (done || blocked) return
    const t0 = performance.now()
    const tick = (ts: number) => {
      const p = Math.min(1, (ts - t0) / HOLD)
      if (ref.current) ref.current.style.background = `conic-gradient(#0d9488 ${p * 360}deg, #fff 0deg)`
      if (p >= 1) { cancel(); onDone(); return }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  return (
    <button ref={ref} disabled={blocked}
      onPointerDown={e => { e.preventDefault(); startHold() }} onPointerUp={cancel} onPointerLeave={cancel} onContextMenu={e => e.preventDefault()}
      className={cn('h-11 w-11 rounded-xl border-2 grid place-items-center text-lg font-extrabold flex-shrink-0 select-none touch-none transition-colors',
        done ? 'bg-emerald-50 border-emerald-500 text-emerald-600'
          : blocked ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
            : 'bg-white border-slate-300 text-slate-300')}
      title={done ? 'Done' : blocked ? 'Blocked' : 'Press and hold to mark done'}>
      {done ? '✓' : blocked ? '✗' : ''}
    </button>
  )
}

function MyWeek({ promises, lastWeek, rowById, cellOf, canEdit, projectId, pending, run }: {
  promises: SchedPromise[]; lastWeek: { kept: number; total: number } | null
  rowById: Map<string, Row>; cellOf: (i: string, f: string) => FloorStatus
  canEdit: boolean; projectId: string; pending: boolean; run: Runner
}) {
  const kept = promises.filter(p => p.status === 'done').length
  const total = promises.length
  return (
    <div className="space-y-3">
      {/* one compact strip: this week + last week side by side */}
      <Card className="p-3.5 shadow-sm flex items-center gap-4 divide-x divide-slate-100">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xl font-extrabold font-mono text-indigo-700 whitespace-nowrap">{kept}/{total}</span>
          <div className="flex-1 min-w-0 text-[11px] text-slate-500">this week{promises[0]?.owner_name ? ` · ${promises[0].owner_name}` : ''}
            <div className="h-1.5 mt-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${total ? kept / total * 100 : 0}%` }} /></div>
          </div>
        </div>
        {lastWeek && (
          <div className="pl-4 text-right whitespace-nowrap">
            <div className="text-sm font-extrabold font-mono text-slate-600">{lastWeek.kept}/{lastWeek.total}</div>
            <div className="text-[10px] text-slate-400">last week ({lastWeek.total ? Math.round(lastWeek.kept / lastWeek.total * 100) : 0}%)</div>
          </div>
        )}
      </Card>

      {total === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500 shadow-sm">No promises this week yet — add them from the <b>Plan Room</b> (open an item → “+ this week”).</Card>
      ) : (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 px-1">Hold ✓ when done — a brush does nothing</p>
          <Card className="shadow-sm divide-y divide-slate-100">
            {promises.map(p => {
              const row = rowById.get(p.item_id)
              const blocked = row ? row.status === 'blocked' : false
              const woOk = row?.item.wo_issued
              const done = p.status === 'done'
              const prevCell = cellOf(p.item_id, p.location)
              return (
                <div key={p.id} className={cn('flex items-center gap-3 px-4 py-3', done && 'opacity-70')}>
                  {canEdit
                    ? <HoldTick done={done} blocked={blocked} onDone={() =>
                        run(() => setPromiseStatus({ id: p.id, projectId, itemId: p.item_id, location: p.location, status: 'done' }),
                          `✓ ${row?.item.name ?? 'Item'} — ${p.location} done`,
                          () => setPromiseStatus({ id: p.id, projectId, itemId: p.item_id, location: p.location, status: 'open', prevCell }))} />
                    : <span className={cn('h-11 w-11 rounded-xl border-2 grid place-items-center text-lg font-extrabold', done ? 'bg-emerald-50 border-emerald-500 text-emerald-600' : 'border-slate-200 text-slate-300')}>{done ? '✓' : ''}</span>}
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm font-semibold text-slate-800 leading-tight', done && 'line-through text-slate-400')}>{row?.item.name ?? '—'} — {p.location}</div>
                    <div className="text-[11px] text-slate-400 truncate">{row?.item.trade}{row?.item.contractor ? ` · ${row.item.contractor}` : ''}</div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold', woOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>📄 {woOk ? 'WO ✓' : 'WO pending'}</span>
                      {blocked && <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-600">📐 Drawing pending</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </Card>
          <p className="text-[11px] text-slate-400 text-center">Hold ~½ second · every change offers <b>Undo</b> for 6 s · ticking also fills the floor map</p>
        </>
      )}
    </div>
  )
}

/* ============================== ② SITE PULSE ============================== */

function SitePulse({ rows, promises, lastWeek, floorNames, cellOf, overall, today, drawings, ready, derivedMap, doneAt }: {
  rows: Row[]; promises: SchedPromise[]; lastWeek: { kept: number; total: number } | null
  floorNames: string[]; cellOf: (i: string, f: string) => FloorStatus
  overall: { pct: number; count: number; datedCount: number; actualScheduled: number; plannedScheduled: number }
  today: string; drawings: ProjectScheduleData['drawings']
  ready: ReturnType<typeof readyFloors>
  derivedMap: Map<string, DerivedPlan>; doneAt: (itemId: string, floor: string) => string | null
}) {
  const [openMap, setOpenMap] = useState<Set<string>>(new Set())
  const toggleMap = (t: string) => setOpenMap(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n })
  // the "live front" — highest floor with work in progress, else the last done one
  const todayCol = useMemo(() => {
    let wip = -1, done = -1
    floorNames.forEach((f, i) => {
      for (const r of rows) {
        const st = cellOf(r.item.id, f)
        if (st === 'wip') wip = i
        else if (st === 'done' && done < i) done = i
      }
    })
    return wip >= 0 ? wip : done
  }, [floorNames, rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const kept = promises.filter(p => p.status === 'done').length
  const ppc = promises.length ? Math.round(kept / promises.length * 100) : (lastWeek && lastWeek.total ? Math.round(lastWeek.kept / lastWeek.total * 100) : null)

  const trades = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, Row[]>()
    for (const r of rows) { if (!map.has(r.item.trade)) { map.set(r.item.trade, []); order.push(r.item.trade) } map.get(r.item.trade)!.push(r) }
    return order.map(t => ({ trade: t, rows: map.get(t)! }))
  }, [rows])

  const gfc = drawings.filter(d => d.status === 'gfc').length
  const comingUp = rows.filter(r => r.item.plan_start && r.item.plan_start > today && daysBetween(today, r.item.plan_start) <= 42)
    .sort((a, b) => (a.item.plan_start ?? '').localeCompare(b.item.plan_start ?? '')).slice(0, 6)

  return (
    <div className="space-y-3">
      <Card className="p-4 flex items-center gap-4 flex-wrap shadow-sm">
        <Ring pct={overall.pct} color="#4f46e5" size={62} />
        <div className="min-w-[180px] flex-1">
          <div className="text-[15px] font-semibold text-slate-900">{overall.pct}% complete · {overall.count} work items</div>
          {overall.datedCount > 0
            ? <PlanVsActual actual={overall.actualScheduled} planned={overall.plannedScheduled} />
            : <div className="text-[11px] text-slate-400 mt-1">Set site dates in the Plan Room to track plan vs actual.</div>}
        </div>
        {ppc != null && (
          <div className="text-center px-3">
            <div className="text-2xl font-extrabold font-mono" style={{ color: ppc >= 70 ? '#0d9488' : ppc >= 50 ? '#d97706' : '#e11d48' }}>{ppc}%</div>
            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">promises kept</div>
          </div>
        )}
      </Card>

      <Card className="p-4 shadow-sm overflow-x-auto">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="text-sm font-bold text-slate-800">Building map — trade × floor</div>
          <div className="text-[10.5px] text-slate-400">tap a trade for its items · hover a cell for dates</div>
        </div>
        {/* phase band — the tower's story, not 11 equal rows */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {PHASES.map(ph => {
            const rs = rows.filter(r => ph.trades.some(t => r.item.trade.toLowerCase().startsWith(t)))
            if (!rs.length) return null
            const pct = Math.round(rs.reduce((s, r) => s + r.item.pct, 0) / rs.length)
            return (
              <span key={ph.name} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold',
                pct > 0 ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500')}>
                {ph.name} <span className="font-mono">{pct}%</span>
              </span>
            )
          })}
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `150px repeat(${floorNames.length}, minmax(46px,1fr)) 130px`, minWidth: 280 + floorNames.length * 48 }}>
          <div />
          {floorNames.map((f, i) => <div key={f} className={cn('text-[9px] text-center truncate', i === todayCol ? 'text-indigo-600 font-bold' : 'text-slate-400')}>{f.replace(' Floor', '')}</div>)}
          <div className="text-[9px] text-slate-400 pl-2">WO · contractor · ends</div>
          {trades.map(g => {
            const open = openMap.has(g.trade)
            const contractors = Array.from(new Set(g.rows.map(r => r.item.contractor).filter(Boolean))) as string[]
            const ends = g.rows.map(r => derivedMap.get(r.item.id)?.end ?? r.item.plan_end).filter(Boolean).sort() as string[]
            const tradeEnd = ends.length === g.rows.length && ends.length > 0 ? ends[ends.length - 1] : null
            const cellTip = (label: string, id: string, f: string) => {
              const st = cellOf(id, f)
              if (st === 'na') return `${label} · ${f}: not applicable`
              if (st === 'done') { const d = doneAt(id, f); return `${label} · ${f}: done${d ? ' ' + formatDate(d.slice(0, 10)) : ''}` }
              const w = derivedMap.get(id)?.floors[f]
              return `${label} · ${f}: ${st === 'wip' ? 'in progress' : 'not started'}${w ? ` · planned ${formatDate(w.start)} → ${formatDate(w.end)}` : ''}`
            }
            return (
              <FragmentGroup key={g.trade}>
                <button onClick={() => toggleMap(g.trade)} className="flex items-center gap-1 text-[10.5px] font-semibold text-slate-600 hover:text-indigo-700 justify-end pr-1.5 truncate text-right">
                  <ChevronRight className={cn('h-3 w-3 flex-shrink-0 transition-transform', open && 'rotate-90')} />{g.trade}
                </button>
                {floorNames.map((f, fi) => {
                  const cs = g.rows.map(r => cellOf(r.item.id, f)).filter(c => c !== 'na')
                  let bg = '#fafbfc', border = '1px dashed #eaeff5'
                  if (cs.length) {
                    const sc = cs.reduce((a, c) => a + (c === 'done' ? 1 : c === 'wip' ? 0.5 : 0), 0) / cs.length
                    bg = sc === 0 ? '#eef2f7' : sc >= 0.99 ? '#0f9b8e' : sc >= 0.5 ? '#5bbfae' : '#e8a33d'
                    border = 'none'
                  }
                  return <div key={f} className={cn('h-6 rounded-md', fi === todayCol && 'ring-2 ring-indigo-500 ring-offset-1')}
                    style={{ background: bg, border }} title={`${g.trade} · ${f.replace(' Floor', '')}`} />
                })}
                <div className="text-[9.5px] text-slate-500 pl-2 truncate self-center flex items-center gap-1.5" title={contractors.join(', ')}>
                  {(() => {
                    const issued = g.rows.filter(r => r.item.wo_issued).length
                    const full = issued === g.rows.length, part = issued > 0 && !full
                    return (
                      <span className="inline-flex items-center gap-1 text-slate-500 flex-shrink-0" title={`Work Orders: ${issued} of ${g.rows.length} issued`}>
                        <span className="h-3.5 w-3.5 rounded-full grid place-items-center text-[7.5px] font-bold text-white flex-shrink-0"
                          style={{ background: full ? '#0f9b8e' : part ? '#e8a33d' : '#dbe2ea', color: full || part ? '#fff' : '#8b98a8' }}>
                          {full ? '✓' : part ? '◐' : '○'}
                        </span>
                        <span className="font-mono text-[8.5px] font-bold">{issued}/{g.rows.length}</span>
                      </span>
                    )
                  })()}
                  <span className="truncate">{contractors.length ? contractors[0] + (contractors.length > 1 ? ` +${contractors.length - 1}` : '') : '—'}</span>
                  {tradeEnd ? <span className="text-indigo-600 font-mono whitespace-nowrap">· {formatDate(tradeEnd)}</span> : ''}
                </div>
                {open && g.rows.map(r => (
                  <FragmentGroup key={r.item.id}>
                    <div className="flex items-center justify-end gap-1.5 pr-1.5 truncate border-r-2 border-indigo-200">
                      <span className="text-[10px] font-semibold text-slate-600 truncate">{r.item.name}</span>
                      <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: HEX[toneOf(r.status)] }} />
                    </div>
                    {floorNames.map(f => {
                      const st = cellOf(r.item.id, f)
                      const bg = st === 'na' ? '#f8fafc' : st === 'done' ? '#0d9488' : st === 'wip' ? '#f5c56b' : '#eef2f7'
                      // the date INSIDE the box: done = tick date · wip = finishes-by · upcoming = starts-on
                      let txt = '', col = '#94a3b8'
                      if (st === 'done') { const d = doneAt(r.item.id, f); txt = d ? `${+d.slice(8, 10)}/${+d.slice(5, 7)}` : '✓'; col = '#ffffff' }
                      else if (st !== 'na') {
                        const w = derivedMap.get(r.item.id)?.floors[f]
                        if (w) { txt = st === 'wip' ? `${+w.end.slice(8, 10)}/${+w.end.slice(5, 7)}` : `${+w.start.slice(8, 10)}/${+w.start.slice(5, 7)}`; col = st === 'wip' ? '#78350f' : '#94a3b8' }
                      }
                      return (
                        <div key={f} className="h-6 rounded-md flex items-center justify-center font-mono text-[9px] font-semibold"
                          title={cellTip(r.item.name, r.item.id, f)}
                          style={{ background: bg, color: col, border: st === 'na' ? '1px solid #eef2f6' : 'none' }}>
                          {txt}
                        </div>
                      )
                    })}
                    <div className="text-[9px] text-slate-400 pl-2 truncate self-center font-mono flex items-center gap-1">
                      <span className={cn('font-sans font-bold', r.item.wo_issued ? 'text-emerald-600' : 'text-rose-400')} title={r.item.wo_issued ? `WO issued${r.item.wo_number ? ' · ' + r.item.wo_number : ''}` : 'WO pending'}>
                        {r.item.wo_issued ? '✓' : '○'}
                      </span>
                      {(derivedMap.get(r.item.id)?.end ?? r.item.plan_end) ? formatDate((derivedMap.get(r.item.id)?.end ?? r.item.plan_end)!) : ''}
                    </div>
                  </FragmentGroup>
                ))}
              </FragmentGroup>
            )
          })}
        </div>
        <div className="flex gap-4 mt-2.5 text-[10.5px] text-slate-500 flex-wrap">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px] mr-1" style={{ background: '#0d9488' }} />done</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px] mr-1" style={{ background: '#f5c56b' }} />in progress</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px] mr-1" style={{ background: '#e9edf3' }} />not started</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm align-[-1px] mr-1 border border-slate-200" style={{ background: '#f8fafc' }} />N/A</span>
          <span className="text-slate-400">date in box (d/m): green = done on · amber = finishes by · grey = starts on</span>
        </div>
      </Card>

      {/* Needs-you + Ready-to-start now live in the Action Centre (cockpit left / Plan tab) */}
      <Card className="p-4 shadow-sm">
        <div className="text-sm font-bold text-slate-800 mb-1">Coming up — next 6 weeks</div>
        {drawings.length > 0 && <p className="text-[11px] text-slate-400 mb-1">Drawings: {gfc} GFC · {drawings.length} total</p>}
        {comingUp.length === 0 ? (
          <p className="text-xs text-slate-400 mt-1">No dated starts in the next 6 weeks — set site dates in the Plan Room and the look-ahead fills in.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {comingUp.map(r => (
              <li key={r.item.id} className="flex items-center gap-3 py-2">
                <span className="text-xs font-mono text-slate-500 whitespace-nowrap">{formatDate(r.item.plan_start!)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{r.item.name}<span className="text-slate-400"> · {r.item.trade}</span></span>
                {r.item.wo_issued
                  ? <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">all clear</span>
                  : <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-rose-50 text-rose-600">📄 WO not raised</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[11px] text-slate-400 text-center">Read-only — management just reads. Engineers update in My Week; planning lives in the Plan Room.</p>
    </div>
  )
}

/* ============================== ③ PLAN ROOM ============================== */

function PlanRoom({ rows, floorNames, cellOf, canEdit, project, people, vendors, promises, weekStart, today, leads, pending, run, items, derivedMap, paceById, ready }: {
  rows: Row[]; floorNames: string[]; cellOf: (i: string, f: string) => FloorStatus
  canEdit: boolean; project: ProjectScheduleData['project']
  people: string[]; vendors: string[]; promises: SchedPromise[]; weekStart: string; today: string
  leads: ProjectScheduleData['leads']; pending: boolean; run: Runner; items: SchedItem[]
  derivedMap: Map<string, DerivedPlan>; paceById: Map<string, number>
  ready: ReturnType<typeof readyFloors>
}) {
  const [openTrades, setOpenTrades] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [picker, setPicker] = useState<{ item: SchedItem; floor: string; prev: FloorStatus } | null>(null)

  const byTrade = useMemo(() => {
    const groups: { trade: string; rows: Row[]; pct: number; need: number }[] = []
    for (const r of rows) {
      let g = groups.find(x => x.trade === r.item.trade)
      if (!g) { g = { trade: r.item.trade, rows: [], pct: 0, need: 0 }; groups.push(g) }
      g.rows.push(r)
    }
    for (const g of groups) {
      const active = g.rows.filter(r => r.item.state !== 'on_hold')
      g.pct = active.length ? Math.round(active.reduce((s, r) => s + r.item.pct, 0) / active.length) : 0
      g.need = g.rows.filter(r => NEEDS_ATTENTION.includes(r.status)).length
    }
    return groups
  }, [rows])
  const promised = useMemo(() => new Set(promises.map(p => `${p.item_id}|${p.location.trim().toLowerCase()}`)), [promises])
  const allOpen = openTrades.size === byTrade.length && byTrade.length > 0
  const toggleTrade = (t: string) => setOpenTrades(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n })

  return (
    <div className="space-y-3">
      {/* on desktop the Action Centre lives in the cockpit's left column */}
      <div className="lg:hidden">
        <ActionCentre rows={rows} ready={ready} canEdit={canEdit} projectId={project.id} today={today} leadDays={leads.procurement} run={run} />
      </div>

      <WoRegister rows={rows} />

      <div className="flex items-center gap-3 flex-wrap text-sm">
        <button onClick={() => setOpenTrades(allOpen ? new Set() : new Set(byTrade.map(g => g.trade)))} className="text-indigo-600 hover:underline font-medium">{allOpen ? 'Collapse all' : 'Expand all'}</button>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowAssign(v => !v)}>👷 Assign team</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyTemplate(project.id), 'Template items added')}>+ Template</Button>
            <Button size="sm" onClick={() => setShowAdd(v => !v)} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add</Button>
          </div>
        )}
      </div>

      {canEdit && showAssign && <AssignPanel items={items} people={people} vendors={vendors} projectId={project.id} run={run} onClose={() => setShowAssign(false)} />}
      {canEdit && showAdd && <AddItemForm projectId={project.id} pending={pending} onAdd={(input) => run(() => addSchedItem(input), 'Added')} onClose={() => setShowAdd(false)} />}

      <Card className="shadow-sm divide-y divide-slate-100 overflow-hidden">
        {byTrade.map(g => {
          const open = openTrades.has(g.trade)
          return (
            <div key={g.trade}>
              <button onClick={() => toggleTrade(g.trade)}
                className={cn('w-full flex items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50', g.need > 0 && 'border-l-[3px] border-rose-400')}>
                <ChevronRight className={cn('h-4 w-4 text-slate-400 transition-transform flex-shrink-0', open && 'rotate-90')} />
                <span className="font-semibold text-slate-800 flex-1 min-w-0 truncate">{g.trade}</span>
                {g.need > 0 && <span className="text-[11px] font-semibold text-rose-600 whitespace-nowrap">{g.need} need action</span>}
                <ProgressBar pct={g.pct} tone={g.need > 0 ? 'late' : g.pct >= 100 ? 'ok' : 'calm'} width="w-16 sm:w-24" />
                <span className="text-xs font-mono font-semibold text-slate-600 w-9 text-right">{g.pct}%</span>
              </button>
              {open && (
                <div className="bg-slate-50/40">
                  {g.rows.map(r => (
                    <PlanItem key={r.item.id} row={r} floorNames={floorNames} cellOf={cellOf} promised={promised}
                      open={openItem === r.item.id} onToggle={() => setOpenItem(openItem === r.item.id ? null : r.item.id)}
                      canEdit={canEdit} projectId={project.id} weekStart={weekStart} today={today} run={run}
                      allItems={items} derived={derivedMap.get(r.item.id)} pace={paceById.get(r.item.id) ?? null}
                      onPick={(floor) => canEdit && setPicker({ item: r.item, floor, prev: cellOf(r.item.id, floor) })} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </Card>

      <p className="text-[11px] text-slate-400 font-mono">WO deadline = site start − {leads.procurement}d · dates move freely (reason logged) · no amounts.</p>

      {picker && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-end justify-items-center" onClick={e => { if (e.target === e.currentTarget) setPicker(null) }}>
          <div className="w-full max-w-3xl bg-white rounded-t-2xl p-5 pb-8">
            <div className="text-sm font-bold text-slate-800">{picker.item.name}</div>
            <div className="text-[11px] text-slate-400 mb-3">{picker.item.trade} · {picker.floor} — choose status (a tap never cycles)</div>
            <div className="grid grid-cols-4 gap-2">
              {(['not_started', 'wip', 'done', 'na'] as FloorStatus[]).map(s => (
                <button key={s}
                  onClick={() => {
                    const { item, floor, prev } = picker
                    setPicker(null)
                    if (s === prev) return
                    run(() => setFloorStatus({ itemId: item.id, projectId: project.id, location: floor, status: s }),
                      `${item.name} · ${floor} → ${FLOOR_META[s].label}`,
                      () => setFloorStatus({ itemId: item.id, projectId: project.id, location: floor, status: prev }))
                  }}
                  className={cn('rounded-xl border-2 py-3.5 text-xs font-bold text-center', picker.prev === s ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200 hover:border-slate-300')}>
                  <span className="block text-lg mb-0.5">{FLOOR_META[s].sym || '·'}</span>{FLOOR_META[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanItem({ row, floorNames, cellOf, promised, open, onToggle, canEdit, projectId, weekStart, today, run, onPick, allItems, derived, pace }: {
  row: Row; floorNames: string[]; cellOf: (i: string, f: string) => FloorStatus
  promised: Set<string>; open: boolean; onToggle: () => void
  canEdit: boolean; projectId: string; weekStart: string; today: string; run: Runner
  onPick: (floor: string) => void
  allItems: SchedItem[]; derived: DerivedPlan | undefined; pace: number | null
}) {
  const { item, status } = row
  const pred = item.follows_item_id ? allItems.find(i => i.id === item.follows_item_id) : null
  const paceNote = pace != null && item.cycle_days
    ? (pace > item.cycle_days ? ` · 🐢 ${pace}d/floor (plan ${item.cycle_days})` : ` · ⚡ ${pace}d/floor`)
    : ''
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button onClick={onToggle} className="w-full flex items-center gap-3 pl-10 pr-4 py-2.5 text-left hover:bg-white transition">
        <span className="flex-1 min-w-0">
          <span className="block font-medium text-slate-800 text-sm truncate">{item.name}</span>
          <span className="block text-[11px] text-slate-500 truncate">{whyLabel(row)}{paceNote}{item.contractor ? ` · 🏗️ ${item.contractor}` : ''}{item.owner_name ? ` · 👷 ${item.owner_name}` : ''}</span>
        </span>
        <ProgressBar pct={item.pct} tone={toneOf(status)} width="w-14 sm:w-24" marker={item.plan_start && item.plan_end ? expectedPct(item, today) : null} />
        <span className="text-xs font-mono font-semibold text-slate-600 w-9 text-right">{item.pct}%</span>
        <ChevronRight className={cn('h-4 w-4 text-slate-300 transition-transform flex-shrink-0', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="pl-10 pr-4 pb-4 pt-1 space-y-3 bg-white">
          <div className="flex flex-wrap gap-1.5">
            {floorNames.map(f => {
              const st = cellOf(item.id, f)
              const m = FLOOR_META[st]
              const isPromised = promised.has(`${item.id}|${f.trim().toLowerCase()}`)
              const win = derived?.floors[f]
              return (
                <button key={f} disabled={!canEdit} onClick={() => onPick(f)}
                  title={win ? `planned ${formatDate(win.start)} → ${formatDate(win.end)}` : undefined}
                  className={cn('relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition disabled:opacity-70', m.chip, canEdit && 'hover:border-slate-400')}>
                  <span className="w-3 text-center">{m.sym}</span>{f}
                  {isPromised && <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-indigo-600 text-white rounded-full px-1 font-bold" title="promised this week">W</span>}
                </button>
              )
            })}
          </div>

          {/* the one-sentence sequence — no MSP vocabulary */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
              <span className="font-semibold">Starts</span>
              <select defaultValue={item.follows_item_id ?? ''} className="border rounded-lg px-2 py-1.5 text-xs bg-white max-w-[210px]"
                onChange={e => run(() => setSequence({ id: item.id, projectId, followsItemId: e.target.value || null, gapDays: item.gap_days, cycleDays: item.cycle_days }), 'Sequence updated')}>
                <option value="">on its own date</option>
                {allItems.filter(i => i.id !== item.id).map(i => (
                  <option key={i.id} value={i.id}>after {i.name} ({i.trade})</option>
                ))}
              </select>
              {item.follows_item_id ? (
                <>
                  <span>+</span>
                  <input type="number" min={0} defaultValue={item.gap_days} className="w-14 border rounded-lg px-2 py-1.5 text-xs font-mono"
                    onBlur={e => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== item.gap_days) run(() => setSequence({ id: item.id, projectId, followsItemId: item.follows_item_id, gapDays: v, cycleDays: item.cycle_days }), 'Gap updated') }} />
                  <span>days gap</span>
                </>
              ) : (
                <input type="date" defaultValue={item.plan_start ?? ''} className="border rounded-lg px-2 py-1.5 text-xs font-mono"
                  onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_start', from: item.plan_start, to: e.target.value || null }), 'Start set')} />
              )}
              <span>·</span>
              <input type="number" min={1} defaultValue={item.cycle_days ?? ''} placeholder="—" className="w-14 border rounded-lg px-2 py-1.5 text-xs font-mono"
                onBlur={e => { const v = Number(e.target.value) || null; if (v !== item.cycle_days) run(() => setSequence({ id: item.id, projectId, followsItemId: item.follows_item_id, gapDays: item.gap_days, cycleDays: v }), 'Cycle updated') }} />
              <span>days/floor</span>
              {derived?.derived && derived.start && derived.end && (
                <span className="ml-auto text-[11px] text-indigo-600 font-mono whitespace-nowrap">→ {formatDate(derived.start)} – {formatDate(derived.end)} (auto)</span>
              )}
            </div>
          )}
          {!canEdit && pred && (
            <p className="text-[11px] text-slate-500">Starts after <b>{pred.name}</b>{item.gap_days ? ` + ${item.gap_days} days` : ''}{item.cycle_days ? ` · ${item.cycle_days} days/floor` : ''}</p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-end gap-3">
              {item.wo_issued
                ? <Button size="sm" variant="outline" onClick={() => run(() => setWoIssued({ id: item.id, projectId, issued: false }), 'WO cleared')}>Clear WO</Button>
                : <Button size="sm" variant="outline" onClick={() => run(() => setWoIssued({ id: item.id, projectId, issued: true, issuedOn: today }), 'WO marked issued')}>Mark WO issued</Button>}
              <PromisePicker item={item} floorNames={floorNames} cellOf={cellOf} promised={promised} projectId={projectId} weekStart={weekStart} run={run} />
              <button className="ml-auto inline-flex items-center gap-1 text-rose-600 text-xs hover:underline self-center"
                onClick={async () => { if (await confirm({ title: 'Delete work item?', message: `Remove "${item.name}"?`, confirmLabel: 'Delete', danger: true })) run(() => deleteSchedItem(item.id, projectId), 'Deleted') }}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "+ this week" — promise a floor of this item for the current week. */
function PromisePicker({ item, floorNames, cellOf, promised, projectId, weekStart, run }: {
  item: SchedItem; floorNames: string[]; cellOf: (i: string, f: string) => FloorStatus
  promised: Set<string>; projectId: string; weekStart: string; run: Runner
}) {
  const [open, setOpen] = useState(false)
  const candidates = floorNames.filter(f => {
    const st = cellOf(item.id, f)
    return st !== 'done' && st !== 'na' && !promised.has(`${item.id}|${f.trim().toLowerCase()}`)
  })
  if (!candidates.length) return null
  return (
    <span className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen(v => !v)}>+ this week</Button>
      {open && (
        <span className="absolute z-40 bottom-full mb-1 left-0 bg-white border rounded-xl shadow-lg p-2 flex gap-1.5 flex-wrap w-64">
          {candidates.map(f => (
            <button key={f} className="text-xs border rounded-lg px-2.5 py-1.5 hover:bg-indigo-50 hover:border-indigo-300 font-medium"
              onClick={() => { setOpen(false); run(() => addPromise({ projectId, itemId: item.id, location: f, weekStart, ownerName: item.owner_name }), `${item.name} · ${f} promised this week`) }}>
              {f}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function WoDueRow({ row, canEdit, projectId, today, run }: {
  row: Row; canEdit: boolean; projectId: string; today: string; run: Runner
}) {
  const [editing, setEditing] = useState(false)
  const [wo, setWo] = useState('')
  const overdue = row.status === 'wo_overdue'
  const urgency = overdue ? `${row.woLateDays}d overdue` : row.woBy ? `by ${formatDate(row.woBy)}` : 'soon'
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', overdue ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>{urgency}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800 truncate">{row.item.name}</span>
        <span className="block text-[11px] text-slate-500 truncate">{row.item.trade}{row.item.contractor ? ` · 🏗️ ${row.item.contractor}` : ''}{row.item.owner_name ? ` · 👷 ${row.item.owner_name}` : ''}</span>
      </span>
      {canEdit && (editing ? (
        <span className="flex items-center gap-1">
          <input value={wo} onChange={e => setWo(e.target.value)} placeholder="WO no. (optional)" autoFocus className="w-32 text-xs border rounded-lg px-2 py-1.5 font-mono" />
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700"
            onClick={() => run(() => setWoIssued({ id: row.item.id, projectId, issued: true, woNumber: wo || null, issuedOn: today }), 'WO marked issued')}>Save</Button>
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Mark issued</Button>
      ))}
    </li>
  )
}

function AssignPanel({ items, people, vendors, projectId, run, onClose }: {
  items: SchedItem[]; people: string[]; vendors: string[]; projectId: string
  run: Runner; onClose: () => void
}) {
  const trades = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, SchedItem[]>()
    for (const it of items) { if (!map.has(it.trade)) { map.set(it.trade, []); order.push(it.trade) } map.get(it.trade)!.push(it) }
    return order.map(t => ({ trade: t, items: map.get(t)! }))
  }, [items])
  const allIds = items.map(i => i.id)
  const common = (list: SchedItem[], key: 'owner_name' | 'contractor' | 'approver_name') => {
    const set = new Set(list.map(i => i[key] ?? '')); return set.size === 1 ? [...set][0] : ''
  }
  const setTrade = (trade: string, field: 'ownerName' | 'contractor' | 'approverName', value: string, label: string, n: number) =>
    run(() => bulkAssignSchedItems({ projectId, trade, [field]: value || null }), `${label} set for ${n} ${trade} item${n === 1 ? '' : 's'}`)
  const setAll = (field: 'ownerName' | 'contractor' | 'approverName', value: string, label: string) =>
    run(() => bulkAssignSchedItems({ projectId, itemIds: allIds, [field]: value || null }), `${label} set for all ${allIds.length} items`)
  const Cell = ({ list, def, onSet }: { list: string; def: string; onSet: (v: string) => void }) => (
    <input list={list} defaultValue={def} placeholder="—" className="w-full text-xs border rounded-lg px-2 py-1.5 bg-white"
      onBlur={e => { const v = e.target.value.trim(); if (v !== def) onSet(v) }} />
  )
  return (
    <Card className="p-4 shadow-sm space-y-3 border-indigo-200">
      <datalist id="dl-vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-people">{people.map(p => <option key={p} value={p} />)}</datalist>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-sm">Assign team &amp; contractors</h3>
        <button onClick={onClose} className="text-xs text-indigo-600 hover:underline">Done</button>
      </div>
      <p className="text-[11px] text-slate-500">Set once per trade — applies to every item in it. Top row = all trades at once.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="py-1.5 pr-3 min-w-[120px]">Trade</th><th className="py-1.5 px-2 min-w-[150px]">🏗️ Contractor</th>
            <th className="py-1.5 px-2 min-w-[140px]">👷 Engineer</th>
          </tr></thead>
          <tbody>
            <tr className="bg-indigo-50/50">
              <td className="py-1.5 pr-3 font-semibold text-indigo-800">All trades →</td>
              <td className="py-1 px-2"><Cell list="dl-vendors" def="" onSet={v => setAll('contractor', v, 'Contractor')} /></td>
              <td className="py-1 px-2"><Cell list="dl-people" def="" onSet={v => setAll('ownerName', v, 'Engineer')} /></td>
            </tr>
            {trades.map(g => (
              <tr key={g.trade} className="border-t border-slate-100">
                <td className="py-1.5 pr-3 text-slate-700">{g.trade} <span className="text-slate-400">({g.items.length})</span></td>
                <td className="py-1 px-2"><Cell list="dl-vendors" def={common(g.items, 'contractor')} onSet={v => setTrade(g.trade, 'contractor', v, 'Contractor', g.items.length)} /></td>
                <td className="py-1 px-2"><Cell list="dl-people" def={common(g.items, 'owner_name')} onSet={v => setTrade(g.trade, 'ownerName', v, 'Engineer', g.items.length)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AddItemForm({ projectId, pending, onAdd, onClose }: {
  projectId: string; pending: boolean
  onAdd: (input: { projectId: string; trade: string; name: string; planStart?: string | null; planEnd?: string | null }) => void
  onClose: () => void
}) {
  const [trade, setTrade] = useState('')
  const [name, setName] = useState('')
  const [planStart, setPlanStart] = useState('')
  const [planEnd, setPlanEnd] = useState('')
  return (
    <Card className="p-4 space-y-3 border-indigo-200 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-slate-600">Trade<input value={trade} onChange={e => setTrade(e.target.value)} placeholder="Civil" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-normal" /></label>
        <label className="text-xs font-semibold text-slate-600">Work item<input value={name} onChange={e => setName(e.target.value)} placeholder="Internal Plaster" className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-normal" /></label>
        <label className="text-xs font-semibold text-slate-600">Site start<input type="date" value={planStart} onChange={e => setPlanStart(e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-mono" /></label>
        <label className="text-xs font-semibold text-slate-600">Finish<input type="date" value={planEnd} onChange={e => setPlanEnd(e.target.value)} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm font-mono" /></label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !trade.trim() || !name.trim()} className="bg-indigo-600 hover:bg-indigo-700"
          onClick={() => { onAdd({ projectId, trade, name, planStart: planStart || null, planEnd: planEnd || null }); setTrade(''); setName(''); setPlanStart(''); setPlanEnd('') }}>Add</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Card>
  )
}

function FragmentGroup({ children }: { children: React.ReactNode }) { return <>{children}</> }
