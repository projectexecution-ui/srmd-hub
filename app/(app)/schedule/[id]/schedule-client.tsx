'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { ChevronLeft, Plus, CalendarClock, Trash2, User, Pencil } from 'lucide-react'
import { deriveStatus, daysBetween, addDays, STATUS_META } from '@/lib/schedule/formula'
import type { DisplayStatus, SchedItem, LeadDays, FloorStatus } from '@/lib/schedule/types'
import type { ProjectScheduleData } from '@/lib/schedule/data'
import { TEMPLATE_ITEM_COUNT } from '@/lib/schedule/template'
import { addSchedItem, updateSchedItem, setWoIssued, moveSchedDate, deleteSchedItem, applyTemplate, setFloorStatus, setScheduleFloors } from '../actions'

type Row = {
  item: SchedItem
  status: DisplayStatus
  woBy: string | null
  behindDays: number
  woLateDays: number
}

const TONE: Record<'ok' | 'soon' | 'late' | 'calm', string> = {
  ok: 'text-emerald-700 bg-emerald-50',
  soon: 'text-amber-700 bg-amber-50',
  late: 'text-rose-700 bg-rose-50',
  calm: 'text-slate-600 bg-slate-100',
}
const HEX: Record<'ok' | 'soon' | 'late' | 'calm', string> = {
  ok: '#0d9488', soon: '#d97706', late: '#e11d48', calm: '#94a3b8',
}
const NEEDS_ATTENTION: DisplayStatus[] = ['wo_overdue', 'blocked', 'behind', 'wo_soon']

function toneOf(s: DisplayStatus) { return STATUS_META[s].tone }

function whyLabel(row: Row): string {
  const { item, status, woBy, behindDays, woLateDays } = row
  switch (status) {
    case 'done': return 'complete'
    case 'in_progress': return `${item.pct}% · on track`
    case 'behind': return `${behindDays}d behind`
    case 'wo_overdue': return `WO ${woLateDays}d late`
    case 'wo_soon': return woBy ? `raise WO by ${formatDate(woBy)}` : 'raise WO'
    case 'blocked': return 'blocked — drawing'
    case 'on_hold': return 'on hold'
    default: return item.plan_start ? `starts ${formatDate(item.plan_start)}` : 'not scheduled'
  }
}

function StatusChip({ status }: { status: DisplayStatus }) {
  const meta = STATUS_META[status]
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', TONE[meta.tone])}>{meta.label}</span>
}

function Ring({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const inner = size - 12
  return (
    <span className="relative grid place-items-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${pct > 0 ? color : '#e5ebf0'} ${pct}%, #e5ebf0 0)` }}>
      <span className="absolute rounded-full bg-white" style={{ width: inner, height: inner }} />
      <span className="relative font-mono font-bold" style={{ fontSize: Math.round(size * 0.27), color: pct > 0 ? '#152230' : '#94a3b8' }}>{pct}</span>
    </span>
  )
}

/** The little "schedule picture": plan window + progress fill + ◆ WO + ┊ today. */
function MiniBar({ row, axisStart, axisEnd, today }: { row: Row; axisStart: string; axisEnd: string; today: string }) {
  const { item, status, woBy } = row
  const total = Math.max(1, daysBetween(axisStart, axisEnd))
  const x = (iso: string) => Math.max(0, Math.min(100, (daysBetween(axisStart, iso) / total) * 100))
  const tone = toneOf(status)
  const col = HEX[tone]
  const hasWin = !!(item.plan_start && item.plan_end)
  return (
    <div className="w-[150px]">
      <div className="text-[10px] font-mono font-semibold mb-1 truncate" style={{ color: col }}>{whyLabel(row)}</div>
      <div className="relative h-3">
        <div className="absolute left-0 right-0 top-1 h-1.5 rounded bg-slate-200" />
        {hasWin && (
          <div className="absolute top-1 h-1.5 rounded overflow-hidden"
            style={{ left: `${x(item.plan_start!)}%`, width: `${Math.max(2, x(item.plan_end!) - x(item.plan_start!))}%`, background: tone === 'calm' ? '#e2e8f0' : '#cdeaf0' }}>
            {item.pct > 0 && <div className="absolute left-0 top-0 bottom-0" style={{ width: `${item.pct}%`, background: col }} />}
          </div>
        )}
        {woBy && (
          <div className="absolute top-0.5 h-2 w-2 rounded-sm" title="WO deadline"
            style={{ left: `${x(woBy)}%`, transform: 'translateX(-50%) rotate(45deg)', background: item.wo_issued ? '#0d9488' : (woBy < today ? '#e11d48' : '#94a3b8') }} />
        )}
        <div className="absolute -top-1 bottom-0 border-l-2 border-dashed border-cyan-600" style={{ left: `${x(today)}%` }} title="today" />
      </div>
    </div>
  )
}

export function ScheduleClient({ data, canEdit, meId }: { data: ProjectScheduleData; canEdit: boolean; meId: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [view, setView] = useState<'board' | 'table' | 'floors'>('board')
  const [mineOnly, setMineOnly] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { project, items, drawings, leads, today, floorNames, progress } = data

  // (itemId|location) → floor status, for the progress matrix
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

  // shared axis for all mini-bars (project min plan_start → max plan_end, incl. today)
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
    const overdue = rows.filter(r => r.status === 'wo_overdue' || r.status === 'blocked').length
    const soon = rows.filter(r => r.status === 'wo_soon').length
    const behind = rows.filter(r => r.status === 'behind').length
    const done = items.filter(i => i.state === 'done' || i.pct >= 100).length
    return { pct, overdue, soon, behind, done, count: items.length }
  }, [items, rows])

  function run(fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) {
    start(async () => {
      const res = await fn()
      if (res?.error) toast.error(res.error)
      else { if (okMsg) toast.success(okMsg); router.refresh() }
    })
  }
  const markWo = (id: string) => run(() => setWoIssued({ id, projectId: project.id, issued: true, issuedOn: today }), 'WO marked issued')

  const attention = rows.filter(r => NEEDS_ATTENTION.includes(r.status))
  const rest = rows.filter(r => !NEEDS_ATTENTION.includes(r.status))

  const byTrade = useMemo(() => {
    const groups: { trade: string; rows: Row[] }[] = []
    for (const r of rows) {
      let g = groups.find(x => x.trade === r.item.trade)
      if (!g) { g = { trade: r.item.trade, rows: [] }; groups.push(g) }
      g.rows.push(r)
    }
    return groups
  }, [rows])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button asChild size="sm" variant="ghost"><Link href="/schedule"><ChevronLeft className="h-4 w-4" /> Projects</Link></Button>
        <h1 className="text-lg md:text-xl font-bold text-gray-900">{project.code ? `${project.code} — ` : ''}{project.name}</h1>
        <span className="ml-auto text-xs text-gray-400 font-mono">as of {formatDate(today)}</span>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border bg-slate-50 p-1">
          <button onClick={() => setView('board')} className={cn('px-3 py-1.5 text-sm rounded-md transition', view === 'board' ? 'bg-white text-indigo-700 font-semibold shadow-sm' : 'text-gray-500 hover:text-gray-700')}>🗂️ Board</button>
          <button onClick={() => setView('table')} className={cn('px-3 py-1.5 text-sm rounded-md transition', view === 'table' ? 'bg-white text-indigo-700 font-semibold shadow-sm' : 'text-gray-500 hover:text-gray-700')}>📋 Table</button>
          <button onClick={() => setView('floors')} className={cn('px-3 py-1.5 text-sm rounded-md transition', view === 'floors' ? 'bg-white text-indigo-700 font-semibold shadow-sm' : 'text-gray-500 hover:text-gray-700')}>🏢 Floors</button>
        </div>
        {meId && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-indigo-600" />
            <User className="h-3.5 w-3.5" /> My items
          </label>
        )}
        {canEdit && items.length > 0 && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyTemplate(project.id), 'Template items added')}>+ From template</Button>
            <Button size="sm" onClick={() => setShowAdd(v => !v)} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add item</Button>
          </div>
        )}
      </div>

      {canEdit && showAdd && <AddItemForm projectId={project.id} pending={pending} onAdd={(input) => { run(() => addSchedItem(input), 'Added') }} onClose={() => setShowAdd(false)} />}

      {items.length === 0 ? (
        <Card className="p-8 text-center space-y-3">
          <CalendarClock className="h-8 w-8 mx-auto text-indigo-400" />
          <p className="text-gray-600 max-w-md mx-auto">No work items yet.{canEdit ? ' Start from the standard template, then just type the quantity for each — or add items manually.' : ' The schedule hasn’t been set up yet.'}</p>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
              <Button disabled={pending} onClick={() => run(() => applyTemplate(project.id), 'Template applied — now add the quantities')} className="bg-indigo-600 hover:bg-indigo-700">Start from template ({TEMPLATE_ITEM_COUNT} items)</Button>
              <Button variant="outline" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add manually</Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          {/* hero rollup */}
          <Card className="p-4 flex items-center gap-4 flex-wrap">
            <Ring pct={overall.pct} color="#4f46e5" size={62} />
            <div className="min-w-[180px] flex-1">
              <div className="text-sm font-semibold text-gray-900">
                {overall.pct}% done · {overall.count} work item{overall.count === 1 ? '' : 's'}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {overall.overdue > 0 && <Chip tone="late" label={`${overall.overdue} WO/drawing overdue`} />}
                {overall.behind > 0 && <Chip tone="late" label={`${overall.behind} behind`} />}
                {overall.soon > 0 && <Chip tone="soon" label={`${overall.soon} WO due soon`} />}
                {overall.done > 0 && <Chip tone="ok" label={`${overall.done} done`} />}
                {overall.overdue === 0 && overall.behind === 0 && overall.soon === 0 && <Chip tone="ok" label="on track" />}
              </div>
            </div>
          </Card>

          {view === 'board' ? (
            <div className="space-y-4">
              {attention.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-600 mb-2">⚑ Needs attention · {attention.length}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {attention.map(r => <BoardCard key={r.item.id} row={r} canEdit={canEdit} onWo={() => markWo(r.item.id)} />)}
                  </div>
                </div>
              )}
              {rest.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Running &amp; upcoming · {rest.length}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {rest.map(r => <BoardCard key={r.item.id} row={r} canEdit={canEdit} onWo={() => markWo(r.item.id)} />)}
                  </div>
                </div>
              )}
            </div>
          ) : view === 'table' ? (
            <Card className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b bg-slate-50/60">
                    <th className="px-3 py-2.5">Work</th>
                    <th className="px-3 py-2.5">Qty</th>
                    <th className="px-3 py-2.5">Schedule</th>
                    <th className="px-3 py-2.5">WO</th>
                    <th className="px-3 py-2.5">Status</th>
                    {canEdit && <th className="px-3 py-2.5"></th>}
                  </tr>
                </thead>
                <tbody>
                  {byTrade.map(g => {
                    const active = g.rows.filter(r => r.item.state !== 'on_hold')
                    const tp = active.length ? Math.round(active.reduce((s, r) => s + r.item.pct, 0) / active.length) : 0
                    const od = g.rows.filter(r => r.status === 'wo_overdue' || r.status === 'blocked' || r.status === 'behind').length
                    return (
                      <FragmentGroup key={g.trade}>
                        <tr className="bg-slate-50 border-y">
                          <td colSpan={canEdit ? 6 : 5} className="px-3 py-2">
                            <span className="font-bold text-gray-800 text-xs">{g.trade}</span>
                            <span className="ml-2 text-[11px] font-mono text-indigo-600 font-semibold">{tp}%</span>
                            <span className="ml-2 text-[11px] text-gray-400">{g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span>
                            {od > 0 && <span className="ml-2 text-[11px] font-semibold text-rose-600">{od} need action</span>}
                          </td>
                        </tr>
                        {g.rows.map(r => (
                          <TableRow
                            key={r.item.id} row={r} canEdit={canEdit} projectId={project.id}
                            axisStart={axisStart} axisEnd={axisEnd} today={today}
                            expanded={expanded === r.item.id}
                            onToggle={() => setExpanded(expanded === r.item.id ? null : r.item.id)}
                            run={run} onWo={() => markWo(r.item.id)}
                          />
                        ))}
                      </FragmentGroup>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          ) : (
            <FloorMatrix
              byTrade={byTrade} floorNames={floorNames} cellStatus={cellStatus}
              canEdit={canEdit} pending={pending}
              onCycle={(itemId, floor, next) => run(() => setFloorStatus({ itemId, projectId: project.id, location: floor, status: next }))}
              onSaveFloors={(floors) => run(() => setScheduleFloors(project.id, floors), 'Floors updated')}
            />
          )}
        </>
      )}

      <p className="text-[11px] text-gray-400 font-mono">
        WO deadline auto-computed: site-start − {leads.procurement}d · dates move freely (reason logged) · no amounts — just WO issued or not.
      </p>
    </div>
  )
}

function FragmentGroup({ children }: { children: React.ReactNode }) { return <>{children}</> }

function Chip({ tone, label }: { tone: 'ok' | 'soon' | 'late' | 'calm'; label: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', TONE[tone])}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEX[tone] }} />{label}
  </span>
}

function BoardCard({ row, canEdit, onWo }: { row: Row; canEdit: boolean; onWo: () => void }) {
  const { item, status } = row
  const col = HEX[toneOf(status)]
  const sub = [item.trade, item.sub].filter(Boolean).join(' · ')
  return (
    <Card className="p-4 border-l-4" style={{ borderLeftColor: col }}>
      <div className="flex items-center gap-3">
        <Ring pct={item.pct} color={col} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 leading-tight truncate">{item.name}</div>
          <div className="text-[11px] text-gray-500 font-mono truncate">{sub}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusChip status={status} />
        <span className="text-xs text-gray-600 truncate">{whyLabel(row)}</span>
      </div>
      {canEdit && !item.wo_issued && (status === 'wo_overdue' || status === 'wo_soon') && (
        <Button size="sm" variant="outline" className="mt-3 w-full" onClick={onWo}>Mark WO issued</Button>
      )}
      {item.wo_issued && <div className="mt-3 text-[11px] font-mono text-emerald-700">✓ {item.wo_number || 'WO issued'}{item.wo_issued_on ? ` · ${formatDate(item.wo_issued_on)}` : ''}</div>}
    </Card>
  )
}

function TableRow({ row, canEdit, projectId, axisStart, axisEnd, today, expanded, onToggle, run, onWo }: {
  row: Row; canEdit: boolean; projectId: string
  axisStart: string; axisEnd: string; today: string
  expanded: boolean; onToggle: () => void
  run: (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) => void
  onWo: () => void
}) {
  const { item, status, woBy } = row
  const rowTint = (status === 'wo_overdue' || status === 'blocked') ? 'bg-rose-50/50'
    : (status === 'behind' || status === 'wo_soon') ? 'bg-amber-50/40' : ''
  return (
    <>
      <tr className={cn('border-b hover:bg-slate-50/60', rowTint)}>
        <td className="px-3 py-2.5">
          <div className="font-medium text-gray-900 leading-tight">{item.name}</div>
          {item.sub && <div className="text-[11px] text-gray-500">{item.sub}</div>}
        </td>
        <td className="px-3 py-2.5">
          {canEdit
            ? <span className="inline-flex items-center gap-1">
                <input type="number" step="0.001" defaultValue={item.qty ?? ''} placeholder="—" className="w-20 text-xs border rounded px-1.5 py-1 font-mono"
                  onBlur={e => { const raw = e.target.value.trim(); const v = raw === '' ? null : Number(raw); if (v !== item.qty) run(() => updateSchedItem(item.id, projectId, { qty: v }), 'Qty updated') }} />
                {item.uom && <span className="text-[10px] text-gray-400 font-mono">{item.uom}</span>}
              </span>
            : <span className="text-xs font-mono text-gray-700">{item.qty != null ? `${item.qty}${item.uom ? ' ' + item.uom : ''}` : '—'}</span>}
        </td>
        <td className="px-3 py-2.5"><MiniBar row={row} axisStart={axisStart} axisEnd={axisEnd} today={today} /></td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {item.wo_issued
            ? <span className="text-xs font-mono text-emerald-700 font-semibold">✓ {item.wo_number || 'issued'}</span>
            : woBy
              ? (canEdit
                ? <button className="text-xs font-mono text-indigo-600 hover:underline" onClick={onWo}>mark issued</button>
                : <span className="text-xs font-mono text-gray-500">by {formatDate(woBy)}</span>)
              : <span className="text-xs text-gray-400">—</span>}
        </td>
        <td className="px-3 py-2.5"><StatusChip status={status} /></td>
        {canEdit && (
          <td className="px-3 py-2.5 text-right">
            <button className="text-gray-400 hover:text-indigo-600 p-1" title="Edit" onClick={onToggle}><Pencil className="h-4 w-4" /></button>
          </td>
        )}
      </tr>
      {canEdit && expanded && (
        <tr className="bg-slate-50/70 border-b">
          <td colSpan={6} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-[11px] font-semibold text-gray-600">Site start
                <input type="date" defaultValue={item.plan_start ?? ''} className="mt-1 block text-xs border rounded px-2 py-1 font-mono"
                  onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_start', from: item.plan_start, to: e.target.value || null }), 'Start date moved')} />
              </label>
              <label className="text-[11px] font-semibold text-gray-600">Finish
                <input type="date" defaultValue={item.plan_end ?? ''} className="mt-1 block text-xs border rounded px-2 py-1 font-mono"
                  onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_end', from: item.plan_end, to: e.target.value || null }), 'Finish date moved')} />
              </label>
              <label className="text-[11px] font-semibold text-gray-600">% done
                <input type="number" min={0} max={100} defaultValue={item.pct} className="mt-1 block w-16 text-xs border rounded px-2 py-1 font-mono"
                  onBlur={e => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== item.pct) run(() => updateSchedItem(item.id, projectId, { pct: v, state: v >= 100 ? 'done' : v > 0 ? 'in_progress' : item.state }), 'Progress updated') }} />
              </label>
              {item.wo_issued
                ? <Button size="sm" variant="outline" onClick={() => run(() => setWoIssued({ id: item.id, projectId, issued: false }), 'WO cleared')}>Clear WO</Button>
                : <Button size="sm" variant="outline" onClick={onWo}>Mark WO issued</Button>}
              <label className="text-[11px] font-semibold text-gray-600">Status
                <select defaultValue={item.state} className="mt-1 block text-xs border rounded px-2 py-1"
                  onChange={e => run(() => updateSchedItem(item.id, projectId, { state: e.target.value }), 'Status updated')}>
                  <option value="planned">Planned</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                  <option value="on_hold">On hold</option>
                </select>
              </label>
              <button className="ml-auto inline-flex items-center gap-1 text-rose-600 text-xs hover:underline"
                onClick={async () => { if (await confirm({ title: 'Delete work item?', message: `Remove "${item.name}"?`, confirmLabel: 'Delete', danger: true })) run(() => deleteSchedItem(item.id, projectId), 'Deleted') }}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

const FLOOR_CELL: Record<FloorStatus, { label: string; cls: string; title: string }> = {
  not_started: { label: '', cls: 'bg-slate-50 text-slate-300 hover:bg-slate-100', title: 'Not started' },
  wip: { label: '◐', cls: 'bg-amber-100 text-amber-700 hover:bg-amber-200', title: 'In progress' },
  done: { label: '✓', cls: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200', title: 'Done' },
  na: { label: '–', cls: 'bg-slate-100 text-slate-400 hover:bg-slate-200', title: 'Not applicable' },
}
const NEXT_FLOOR: Record<FloorStatus, FloorStatus> = { not_started: 'wip', wip: 'done', done: 'na', na: 'not_started' }

/** The item × floor progress matrix — the engineer's daily tap-to-update screen. */
function FloorMatrix({ byTrade, floorNames, cellStatus, canEdit, pending, onCycle, onSaveFloors }: {
  byTrade: { trade: string; rows: Row[] }[]
  floorNames: string[]
  cellStatus: Map<string, FloorStatus>
  canEdit: boolean
  pending: boolean
  onCycle: (itemId: string, floor: string, next: FloorStatus) => void
  onSaveFloors: (floors: string[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(floorNames.join(', '))
  const lookup = (itemId: string, floor: string): FloorStatus =>
    cellStatus.get(`${itemId}|${floor.trim().toLowerCase()}`) ?? 'not_started'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          Tap a cell to advance: blank → <span className="text-amber-700 font-semibold">◐ WIP</span> → <span className="text-emerald-700 font-semibold">✓ done</span> → <span className="text-gray-400">– N/A</span>. Each tap updates the item’s % everywhere.
        </p>
        {canEdit && (
          <button onClick={() => { setText(floorNames.join(', ')); setEditing(v => !v) }} className="ml-auto text-xs text-indigo-600 hover:underline whitespace-nowrap">Edit floors</button>
        )}
      </div>

      {editing && canEdit && (
        <Card className="p-3 border-indigo-200 space-y-2">
          <label className="text-[11px] font-semibold text-gray-600 block">Floors / locations — comma-separated, top to bottom
            <input value={text} onChange={e => setText(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-mono" />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} className="bg-indigo-600 hover:bg-indigo-700" onClick={() => { onSaveFloors(text.split(',').map(s => s.trim()).filter(Boolean)); setEditing(false) }}>Save floors</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 border-b px-3 py-2.5 text-left text-[10px] uppercase tracking-wide text-gray-500 min-w-[180px]">Work</th>
              {floorNames.map(f => (
                <th key={f} className="border-b border-l px-2 py-2.5 text-[10px] font-semibold text-gray-500 whitespace-nowrap min-w-[46px] text-center">{f}</th>
              ))}
              <th className="border-b border-l px-2 py-2.5 text-[10px] uppercase tracking-wide text-gray-500 text-center min-w-[44px]">%</th>
            </tr>
          </thead>
          <tbody>
            {byTrade.map(g => (
              <FragmentGroup key={g.trade}>
                <tr>
                  <td colSpan={floorNames.length + 2} className="sticky left-0 bg-slate-50 border-y px-3 py-1.5 text-xs font-bold text-gray-800">{g.trade}</td>
                </tr>
                {g.rows.map(r => (
                  <tr key={r.item.id} className="hover:bg-slate-50/40">
                    <td className="sticky left-0 z-10 bg-white border-b px-3 py-1.5 min-w-[180px]">
                      <div className="font-medium text-gray-900 text-[13px] leading-tight truncate max-w-[220px]">{r.item.name}</div>
                      {r.item.sub && <div className="text-[10px] text-gray-400 truncate max-w-[220px]">{r.item.sub}</div>}
                    </td>
                    {floorNames.map(f => {
                      const st = lookup(r.item.id, f)
                      const meta = FLOOR_CELL[st]
                      return (
                        <td key={f} className="border-b border-l p-0 text-center">
                          {canEdit
                            ? <button title={meta.title} disabled={pending} onClick={() => onCycle(r.item.id, f, NEXT_FLOOR[st])}
                                className={cn('w-full h-9 text-sm font-semibold transition', meta.cls)}>{meta.label}</button>
                            : <span className={cn('flex items-center justify-center w-full h-9 text-sm', meta.cls)}>{meta.label}</span>}
                        </td>
                      )
                    })}
                    <td className="border-b border-l px-2 text-center font-mono text-[11px] font-semibold text-indigo-600">{r.item.pct}</td>
                  </tr>
                ))}
              </FragmentGroup>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function AddItemForm({ projectId, pending, onAdd, onClose }: {
  projectId: string; pending: boolean
  onAdd: (input: { projectId: string; trade: string; name: string; sub?: string | null; planStart?: string | null; planEnd?: string | null }) => void
  onClose: () => void
}) {
  const [trade, setTrade] = useState('')
  const [name, setName] = useState('')
  const [sub, setSub] = useState('')
  const [planStart, setPlanStart] = useState('')
  const [planEnd, setPlanEnd] = useState('')
  return (
    <Card className="p-4 space-y-3 border-indigo-200">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-gray-600">Trade<input value={trade} onChange={e => setTrade(e.target.value)} placeholder="Civil Works" className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-normal" /></label>
        <label className="text-xs font-semibold text-gray-600">Work item<input value={name} onChange={e => setName(e.target.value)} placeholder="RCC — Raft & footings" className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-normal" /></label>
        <label className="text-xs font-semibold text-gray-600">Sub-category (optional)<input value={sub} onChange={e => setSub(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-normal" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-gray-600">Site start<input type="date" value={planStart} onChange={e => setPlanStart(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-normal font-mono" /></label>
          <label className="text-xs font-semibold text-gray-600">Finish<input type="date" value={planEnd} onChange={e => setPlanEnd(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-normal font-mono" /></label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !trade.trim() || !name.trim()} className="bg-indigo-600 hover:bg-indigo-700"
          onClick={() => { onAdd({ projectId, trade, name, sub: sub || null, planStart: planStart || null, planEnd: planEnd || null }); setTrade(''); setName(''); setSub(''); setPlanStart(''); setPlanEnd('') }}>Add</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Card>
  )
}
