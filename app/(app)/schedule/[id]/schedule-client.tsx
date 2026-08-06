'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { ChevronLeft, ChevronRight, Plus, CalendarClock, Trash2, User, Wrench, Check } from 'lucide-react'
import { deriveStatus, daysBetween, addDays, STATUS_META, expectedPct } from '@/lib/schedule/formula'
import type { DisplayStatus, SchedItem, FloorStatus } from '@/lib/schedule/types'
import type { ProjectScheduleData } from '@/lib/schedule/data'
import { TEMPLATE_ITEM_COUNT } from '@/lib/schedule/template'
import { addSchedItem, updateSchedItem, setWoIssued, moveSchedDate, deleteSchedItem, applyTemplate, setFloorStatus, setScheduleFloors, bulkAssignSchedItems } from '../actions'

type Row = { item: SchedItem; status: DisplayStatus; woBy: string | null; behindDays: number; woLateDays: number }

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

function Ring({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const inner = size - 12
  return (
    <span className="relative grid place-items-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${pct > 0 ? color : '#e5ebf0'} ${pct}%, #e9eef3 0)` }}>
      <span className="absolute rounded-full bg-white" style={{ width: inner, height: inner }} />
      <span className="relative font-mono font-bold text-slate-800" style={{ fontSize: Math.round(size * 0.28), color: pct > 0 ? '#0f172a' : '#94a3b8' }}>{pct}</span>
    </span>
  )
}

function Chip({ tone, label }: { tone: 'ok' | 'soon' | 'late' | 'calm'; label: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', TONE[tone])}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEX[tone] }} />{label}
  </span>
}

/** slim progress bar, colour = status tone. `marker` = "planned by today" tick. */
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

/** Plain-language plan-vs-actual: actual fill + a lighter "should be by today"
 *  fill behind it, and a one-word verdict. No Gantt, no chart. */
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

/** the "schedule picture" for the item detail: plan window + fill + ◆ WO + ┊ today */
function ScheduleBar({ row, axisStart, axisEnd, today }: { row: Row; axisStart: string; axisEnd: string; today: string }) {
  const { item, status, woBy } = row
  const total = Math.max(1, daysBetween(axisStart, axisEnd))
  const x = (iso: string) => Math.max(0, Math.min(100, (daysBetween(axisStart, iso) / total) * 100))
  const col = HEX[toneOf(status)]
  const hasWin = !!(item.plan_start && item.plan_end)
  return (
    <div className="relative h-4 w-full">
      <div className="absolute left-0 right-0 top-1.5 h-1.5 rounded bg-slate-200" />
      {hasWin && (
        <div className="absolute top-1.5 h-1.5 rounded overflow-hidden"
          style={{ left: `${x(item.plan_start!)}%`, width: `${Math.max(2, x(item.plan_end!) - x(item.plan_start!))}%`, background: '#cdeaf0' }}>
          {item.pct > 0 && <div className="absolute inset-y-0 left-0" style={{ width: `${item.pct}%`, background: col }} />}
        </div>
      )}
      {woBy && (
        <div className="absolute top-1 h-2 w-2 rounded-sm" title="WO deadline"
          style={{ left: `${x(woBy)}%`, transform: 'translateX(-50%) rotate(45deg)', background: item.wo_issued ? '#0d9488' : (woBy < today ? '#e11d48' : '#94a3b8') }} />
      )}
      <div className="absolute -top-0.5 bottom-0 border-l-2 border-dashed border-cyan-500" style={{ left: `${x(today)}%` }} title="today" />
    </div>
  )
}

/** WO status pill for the row (not a button — the row click opens detail). */
function WoStatus({ row }: { row: Row }) {
  const { item, status, woBy } = row
  if (item.wo_issued) return <span className="text-xs font-mono text-emerald-700 font-semibold whitespace-nowrap">✓ {item.wo_number || 'WO'}</span>
  if (status === 'wo_overdue') return <span className="text-xs font-semibold text-rose-600 whitespace-nowrap">WO overdue</span>
  if (status === 'wo_soon') return <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">Raise WO</span>
  if (woBy) return <span className="text-xs text-slate-400 whitespace-nowrap">WO {formatDate(woBy)}</span>
  return <span className="text-xs text-slate-300">—</span>
}

const FLOOR_CELL: Record<FloorStatus, { label: string; cls: string; title: string }> = {
  not_started: { label: '', cls: 'bg-white text-slate-300 border-slate-200 hover:border-slate-300', title: 'Not started' },
  wip: { label: '◐', cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100', title: 'In progress' },
  done: { label: '✓', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', title: 'Done' },
  na: { label: '–', cls: 'bg-slate-50 text-slate-300 border-slate-200', title: 'Not applicable' },
}
const NEXT_FLOOR: Record<FloorStatus, FloorStatus> = { not_started: 'wip', wip: 'done', done: 'na', na: 'not_started' }

export function ScheduleClient({ data, canEdit, meId }: { data: ProjectScheduleData; canEdit: boolean; meId: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [mineOnly, setMineOnly] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [openTrades, setOpenTrades] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)

  const { project, items, drawings, leads, today, floorNames, progress, people, vendors } = data

  const cellStatus = useMemo(() => {
    const m = new Map<string, FloorStatus>()
    for (const p of progress) m.set(`${p.item_id}|${p.location.trim().toLowerCase()}`, p.status)
    return m
  }, [progress])

  const blockedByDrawing = useMemo(() => {
    const set = new Set<string>()
    for (const d of drawings) {
      if (!d.item_id || d.status === 'gfc') continue
      if (d.blocking || (d.target_date && d.target_date < today)) set.add(d.item_id)
    }
    return set
  }, [drawings, today])

  const rows: Row[] = useMemo(() => {
    const list = mineOnly && meId ? items.filter(i => i.owner_user_id === meId) : items
    return list.map(item => ({ item, ...deriveStatus(item, today, { leads, drawingBlocked: blockedByDrawing.has(item.id) }) }))
  }, [items, mineOnly, meId, today, leads, blockedByDrawing])

  const [axisStart, axisEnd] = useMemo(() => {
    const ds: string[] = []
    for (const i of items) { if (i.plan_start) ds.push(i.plan_start); if (i.plan_end) ds.push(i.plan_end) }
    ds.push(today)
    if (ds.length <= 1) return [addDays(today, -30), addDays(today, 120)] as const
    ds.sort()
    return [ds[0], ds[ds.length - 1]] as const
  }, [items, today])

  const overall = useMemo(() => {
    const active = items.filter(i => i.state !== 'on_hold')
    const pct = active.length ? Math.round(active.reduce((s, i) => s + i.pct, 0) / active.length) : 0
    const needWo = rows.filter(r => r.status === 'wo_overdue' || r.status === 'wo_soon' || r.status === 'blocked').length
    const behind = rows.filter(r => r.status === 'behind').length
    const done = items.filter(i => i.state === 'done' || i.pct >= 100).length
    // plan vs actual — only over scheduled (dated) work
    const dated = active.filter(i => i.plan_start && i.plan_end)
    const actualScheduled = dated.length ? Math.round(dated.reduce((s, i) => s + i.pct, 0) / dated.length) : 0
    const plannedScheduled = dated.length ? Math.round(dated.reduce((s, i) => s + expectedPct(i, today), 0) / dated.length) : 0
    return { pct, needWo, behind, done, count: items.length, datedCount: dated.length, actualScheduled, plannedScheduled }
  }, [items, rows, today])

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

  function run(fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) {
    start(async () => {
      const res = await fn()
      if (res?.error) toast.error(res.error)
      else { if (okMsg) toast.success(okMsg); router.refresh() }
    })
  }
  const toggleTrade = (t: string) => setOpenTrades(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })
  const allOpen = openTrades.size === byTrade.length && byTrade.length > 0

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      {/* header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button asChild size="sm" variant="ghost"><Link href="/schedule"><ChevronLeft className="h-4 w-4" /> Projects</Link></Button>
        <h1 className="text-lg md:text-xl font-bold text-slate-900">{project.code ? `${project.code} — ` : ''}{project.name}</h1>
        <span className="ml-auto text-xs text-slate-400 font-mono">as of {formatDate(today)}</span>
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center space-y-3 shadow-sm">
          <CalendarClock className="h-8 w-8 mx-auto text-indigo-400" />
          <p className="text-slate-600 max-w-md mx-auto">No work items yet.{canEdit ? ' Start from the standard template — then just tick off progress floor by floor.' : ' The schedule hasn’t been set up yet.'}</p>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
              <Button disabled={pending} onClick={() => run(() => applyTemplate(project.id), 'Template applied')} className="bg-indigo-600 hover:bg-indigo-700">Start from template ({TEMPLATE_ITEM_COUNT} items)</Button>
              <Button variant="outline" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add manually</Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          {/* summary — the management snapshot, always on top */}
          <Card className="p-5 flex items-center gap-5 flex-wrap shadow-sm">
            <Ring pct={overall.pct} color="#4f46e5" size={64} />
            <div className="min-w-[180px] flex-1">
              <div className="text-[15px] font-semibold text-slate-900">{overall.pct}% complete · {overall.count} work item{overall.count === 1 ? '' : 's'}</div>
              {overall.datedCount > 0
                ? <PlanVsActual actual={overall.actualScheduled} planned={overall.plannedScheduled} />
                : <div className="text-[11px] text-slate-400 mt-1">Add site-start + finish dates to track plan vs actual.</div>}
              <div className="flex flex-wrap gap-2 mt-2">
                {overall.needWo > 0 && <Chip tone="late" label={`${overall.needWo} need Work Order`} />}
                {overall.behind > 0 && <Chip tone="soon" label={`${overall.behind} behind`} />}
                {overall.done > 0 && <Chip tone="ok" label={`${overall.done} done`} />}
              </div>
            </div>
          </Card>

          {/* WO action list — raise from here, no need to read every line */}
          <WoDuePanel rows={rows} canEdit={canEdit} projectId={project.id} today={today} leadDays={leads.procurement} run={run} />

          {/* controls */}
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <button onClick={() => setOpenTrades(allOpen ? new Set() : new Set(byTrade.map(g => g.trade)))}
              className="text-indigo-600 hover:underline font-medium">{allOpen ? 'Collapse all' : 'Expand all'}</button>
            {meId && (
              <label className="inline-flex items-center gap-2 text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                <User className="h-3.5 w-3.5" /> My items
              </label>
            )}
            {canEdit && (
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowAssign(v => !v)}>👷 Assign team</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyTemplate(project.id), 'Template items added')}>+ Template</Button>
                <Button size="sm" onClick={() => setShowAdd(v => !v)} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add item</Button>
              </div>
            )}
          </div>

          {canEdit && showAssign && (
            <AssignPanel items={items} people={people} vendors={vendors} projectId={project.id} pending={pending} run={run} onClose={() => setShowAssign(false)} />
          )}
          {canEdit && showAdd && <AddItemForm projectId={project.id} pending={pending} onAdd={(input) => run(() => addSchedItem(input), 'Added')} onClose={() => setShowAdd(false)} />}

          {/* the one list — grouped + collapsed by trade */}
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
                    <ProgressBar pct={g.pct} tone={g.need > 0 ? 'late' : g.pct >= 100 ? 'ok' : 'calm'} width="w-20 sm:w-28" />
                    <span className="text-xs font-mono font-semibold text-slate-600 w-9 text-right">{g.pct}%</span>
                    <span className="text-[11px] text-slate-400 w-12 text-right hidden sm:inline">{g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span>
                  </button>

                  {open && (
                    <div className="bg-slate-50/40">
                      {g.rows.map(r => (
                        <ItemRow key={r.item.id} row={r} canEdit={canEdit} projectId={project.id}
                          open={openItem === r.item.id} onToggle={() => setOpenItem(openItem === r.item.id ? null : r.item.id)}
                          axisStart={axisStart} axisEnd={axisEnd} today={today}
                          floorNames={floorNames} cellStatus={cellStatus} pending={pending} run={run} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </Card>

          <p className="text-[11px] text-slate-400 font-mono">
            Work Order deadline = site start − {leads.procurement} days · dates move freely (reason logged) · no amounts — only whether the WO is issued.
          </p>
        </>
      )}
    </div>
  )
}

/** The Work-Order to-do: only items whose WO is overdue or due soon, most urgent
 *  first, each raisable inline — so nobody scans every line to find what's due. */
function WoDuePanel({ rows, canEdit, projectId, today, leadDays, run }: {
  rows: Row[]; canEdit: boolean; projectId: string; today: string; leadDays: number
  run: (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) => void
}) {
  const due = rows
    .filter(r => !r.item.wo_issued && (r.status === 'wo_overdue' || r.status === 'wo_soon'))
    .sort((a, b) => {
      const aov = a.status === 'wo_overdue', bov = b.status === 'wo_overdue'
      if (aov !== bov) return aov ? -1 : 1
      if (aov) return b.woLateDays - a.woLateDays
      return (a.woBy ?? '').localeCompare(b.woBy ?? '')
    })

  if (!due.length) {
    return (
      <Card className="p-4 shadow-sm flex items-center gap-2 text-sm text-emerald-700">
        <Check className="h-4 w-4" /> All Work Orders raised — nothing due.
      </Card>
    )
  }
  const overdue = due.filter(r => r.status === 'wo_overdue').length
  return (
    <Card className="p-0 shadow-sm overflow-hidden border-l-4 border-rose-400">
      <div className="px-4 py-3 border-b border-slate-100 bg-rose-50/40 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-slate-800 text-sm inline-flex items-center gap-1.5"><Wrench className="h-4 w-4 text-rose-500" /> Work Orders to raise · {due.length}</h3>
        <span className="text-[11px] text-slate-500">{overdue > 0 ? `${overdue} overdue` : 'due soon'} · deadline = site start − {leadDays}d</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {due.map(r => <WoDueRow key={r.item.id} row={r} canEdit={canEdit} projectId={projectId} today={today} run={run} />)}
      </ul>
    </Card>
  )
}

function WoDueRow({ row, canEdit, projectId, today, run }: {
  row: Row; canEdit: boolean; projectId: string; today: string
  run: (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) => void
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
        <span className="block text-[11px] text-slate-500 truncate">
          {row.item.trade}
          {row.item.contractor ? ` · 🏗️ ${row.item.contractor}` : ''}
          {row.item.owner_name ? ` · 👷 ${row.item.owner_name}` : ''}
        </span>
      </span>
      {canEdit && (editing ? (
        <span className="flex items-center gap-1">
          <input value={wo} onChange={e => setWo(e.target.value)} placeholder="WO no. (optional)" autoFocus
            className="w-32 text-xs border rounded-lg px-2 py-1.5 font-mono" />
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700"
            onClick={() => run(() => setWoIssued({ id: row.item.id, projectId, issued: true, woNumber: wo || null, issuedOn: today }), 'WO marked issued')}>Save</Button>
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Mark issued</Button>
      ))}
    </li>
  )
}

function ItemRow({ row, canEdit, projectId, open, onToggle, axisStart, axisEnd, today, floorNames, cellStatus, pending, run }: {
  row: Row; canEdit: boolean; projectId: string; open: boolean; onToggle: () => void
  axisStart: string; axisEnd: string; today: string
  floorNames: string[]; cellStatus: Map<string, FloorStatus>; pending: boolean
  run: (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) => void
}) {
  const { item, status } = row
  const tone = toneOf(status)
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button onClick={onToggle} className="w-full flex items-center gap-3 pl-11 pr-4 py-2.5 text-left hover:bg-white transition">
        <span className="flex-1 min-w-0">
          <span className="block font-medium text-slate-800 text-sm truncate">{item.name}</span>
          <span className="block text-[11px] text-slate-500 truncate">{whyLabel(row)}{item.owner_name ? ` · 👷 ${item.owner_name}` : ''}</span>
        </span>
        <ProgressBar pct={item.pct} tone={tone} width="w-16 sm:w-24"
          marker={item.plan_start && item.plan_end ? expectedPct(item, today) : null} />
        <span className="w-20 text-right hidden sm:block"><WoStatus row={row} /></span>
        <span className="text-xs font-mono font-semibold text-slate-600 w-9 text-right">{item.pct}%</span>
        <ChevronRight className={cn('h-4 w-4 text-slate-300 transition-transform flex-shrink-0', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="pl-11 pr-4 pb-4 pt-1 space-y-4 bg-white">
          {/* schedule picture */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <StatusChip status={status} />
              <span className="text-[11px] text-slate-400 font-mono">
                {item.plan_start ? formatDate(item.plan_start) : '—'} → {item.plan_end ? formatDate(item.plan_end) : '—'}
              </span>
            </div>
            <ScheduleBar row={row} axisStart={axisStart} axisEnd={axisEnd} today={today} />
          </div>

          {/* floors */}
          {floorNames.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Floors — tap to advance: blank → <span className="text-amber-700">◐</span> → <span className="text-emerald-700">✓</span> → <span className="text-slate-400">– N/A</span></div>
              <div className="flex flex-wrap gap-1.5">
                {floorNames.map(f => {
                  const st = cellStatus.get(`${item.id}|${f.trim().toLowerCase()}`) ?? 'not_started'
                  const meta = FLOOR_CELL[st]
                  return (
                    <button key={f} disabled={!canEdit || pending} title={meta.title}
                      onClick={() => run(() => setFloorStatus({ itemId: item.id, projectId, location: f, status: NEXT_FLOOR[st] }))}
                      className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60', meta.cls)}>
                      <span className="w-3 text-center">{meta.label}</span>{f}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* who's responsible + who executes */}
          {canEdit ? (
            <div className="flex flex-wrap gap-3">
              <label className="text-[11px] font-semibold text-slate-500">👷 Responsible engineer
                <input defaultValue={item.owner_name ?? ''} placeholder="name" className="mt-1 block w-40 text-xs border rounded-lg px-2 py-1.5"
                  onBlur={e => { const v = e.target.value.trim() || null; if (v !== item.owner_name) run(() => updateSchedItem(item.id, projectId, { owner_name: v }), 'Saved') }} />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">🏗️ Contractor
                <input defaultValue={item.contractor ?? ''} placeholder="agency" className="mt-1 block w-40 text-xs border rounded-lg px-2 py-1.5"
                  onBlur={e => { const v = e.target.value.trim() || null; if (v !== item.contractor) run(() => updateSchedItem(item.id, projectId, { contractor: v }), 'Saved') }} />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">✔ Approver
                <input defaultValue={item.approver_name ?? ''} placeholder="name" className="mt-1 block w-40 text-xs border rounded-lg px-2 py-1.5"
                  onBlur={e => { const v = e.target.value.trim() || null; if (v !== item.approver_name) run(() => updateSchedItem(item.id, projectId, { approver_name: v }), 'Saved') }} />
              </label>
            </div>
          ) : (item.owner_name || item.contractor || item.approver_name) ? (
            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              {item.owner_name && <span>👷 {item.owner_name}</span>}
              {item.contractor && <span>🏗️ {item.contractor}</span>}
              {item.approver_name && <span>✔ {item.approver_name}</span>}
            </div>
          ) : null}

          {/* controls */}
          {canEdit && (
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <label className="text-[11px] font-semibold text-slate-500">Site start
                <input type="date" defaultValue={item.plan_start ?? ''} className="mt-1 block text-xs border rounded-lg px-2 py-1.5 font-mono"
                  onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_start', from: item.plan_start, to: e.target.value || null }), 'Start moved')} />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">Finish
                <input type="date" defaultValue={item.plan_end ?? ''} className="mt-1 block text-xs border rounded-lg px-2 py-1.5 font-mono"
                  onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_end', from: item.plan_end, to: e.target.value || null }), 'Finish moved')} />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">% done
                <input type="number" min={0} max={100} defaultValue={item.pct} className="mt-1 block w-16 text-xs border rounded-lg px-2 py-1.5 font-mono"
                  onBlur={e => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== item.pct) run(() => updateSchedItem(item.id, projectId, { pct: v, state: v >= 100 ? 'done' : v > 0 ? 'in_progress' : item.state }), 'Progress updated') }} />
              </label>
              {item.wo_issued
                ? <Button size="sm" variant="outline" onClick={() => run(() => setWoIssued({ id: item.id, projectId, issued: false }), 'WO cleared')}>Clear WO</Button>
                : <Button size="sm" variant="outline" onClick={() => run(() => setWoIssued({ id: item.id, projectId, issued: true, issuedOn: today }), 'WO marked issued')}>Mark WO issued</Button>}
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

/** Bulk assignment — set contractor / engineer / approver once per trade (or
 *  for all trades), instead of item by item. */
function AssignPanel({ items, people, vendors, projectId, pending, run, onClose }: {
  items: SchedItem[]; people: string[]; vendors: string[]; projectId: string; pending: boolean
  run: (fn: () => Promise<{ ok?: true; count?: number; error?: string }>, okMsg?: string) => void
  onClose: () => void
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
    <input list={list} defaultValue={def} placeholder="—"
      className="w-full text-xs border rounded-lg px-2 py-1.5 bg-white"
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
      <p className="text-[11px] text-slate-500">Set once per trade — it applies to <b>every item</b> in that trade. Pick from your vendors / team, or type a new name. Use the top row to set all trades at once.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-3 min-w-[130px]">Trade</th>
              <th className="py-1.5 px-2 min-w-[150px]">🏗️ Contractor</th>
              <th className="py-1.5 px-2 min-w-[140px]">👷 Engineer</th>
              <th className="py-1.5 px-2 min-w-[140px]">✔ Approver</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-indigo-50/50">
              <td className="py-1.5 pr-3 font-semibold text-indigo-800">All trades →</td>
              <td className="py-1 px-2"><Cell list="dl-vendors" def="" onSet={v => setAll('contractor', v, 'Contractor')} /></td>
              <td className="py-1 px-2"><Cell list="dl-people" def="" onSet={v => setAll('ownerName', v, 'Engineer')} /></td>
              <td className="py-1 px-2"><Cell list="dl-people" def="" onSet={v => setAll('approverName', v, 'Approver')} /></td>
            </tr>
            {trades.map(g => (
              <tr key={g.trade} className="border-t border-slate-100">
                <td className="py-1.5 pr-3 text-slate-700">{g.trade} <span className="text-slate-400">({g.items.length})</span></td>
                <td className="py-1 px-2"><Cell list="dl-vendors" def={common(g.items, 'contractor')} onSet={v => setTrade(g.trade, 'contractor', v, 'Contractor', g.items.length)} /></td>
                <td className="py-1 px-2"><Cell list="dl-people" def={common(g.items, 'owner_name')} onSet={v => setTrade(g.trade, 'ownerName', v, 'Engineer', g.items.length)} /></td>
                <td className="py-1 px-2"><Cell list="dl-people" def={common(g.items, 'approver_name')} onSet={v => setTrade(g.trade, 'approverName', v, 'Approver', g.items.length)} /></td>
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
  onAdd: (input: { projectId: string; trade: string; name: string; sub?: string | null; planStart?: string | null; planEnd?: string | null }) => void
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
