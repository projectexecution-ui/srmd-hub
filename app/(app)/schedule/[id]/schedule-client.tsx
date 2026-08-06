'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { ChevronLeft, Plus, CalendarClock, Trash2, User } from 'lucide-react'
import { deriveStatus, workBackDeadlines, STATUS_META } from '@/lib/schedule/formula'
import type { DisplayStatus, SchedItem } from '@/lib/schedule/types'
import type { ProjectScheduleData } from '@/lib/schedule/data'
import { addSchedItem, updateSchedItem, setWoIssued, moveSchedDate, deleteSchedItem } from '../actions'

const TONE: Record<'ok' | 'soon' | 'late' | 'calm', string> = {
  ok: 'text-emerald-700 bg-emerald-50',
  soon: 'text-amber-700 bg-amber-50',
  late: 'text-rose-700 bg-rose-50',
  calm: 'text-slate-600 bg-slate-100',
}
const NEEDS_ATTENTION: DisplayStatus[] = ['wo_overdue', 'blocked', 'behind', 'wo_soon']

function StatusChip({ status }: { status: DisplayStatus }) {
  const meta = STATUS_META[status]
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', TONE[meta.tone])}>{meta.label}</span>
}

export function ScheduleClient({ data, canEdit, meId }: { data: ProjectScheduleData; canEdit: boolean; meId: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [view, setView] = useState<'board' | 'table'>('board')
  const [mineOnly, setMineOnly] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const { project, items, drawings, leads, today } = data

  const blockedByDrawing = useMemo(() => {
    const set = new Set<string>()
    for (const d of drawings) {
      if (!d.item_id || d.status === 'gfc') continue
      if (d.blocking || (d.target_date && d.target_date < today)) set.add(d.item_id)
    }
    return set
  }, [drawings, today])

  const rows = useMemo(() => {
    const list = mineOnly && meId ? items.filter(i => i.owner_user_id === meId) : items
    return list.map(item => {
      const derived = deriveStatus(item, today, { leads, drawingBlocked: blockedByDrawing.has(item.id) })
      return { item, ...derived }
    })
  }, [items, mineOnly, meId, today, leads, blockedByDrawing])

  const overall = useMemo(() => {
    const active = items.filter(i => i.state !== 'on_hold')
    const pct = active.length ? Math.round(active.reduce((s, i) => s + i.pct, 0) / active.length) : 0
    const overdue = rows.filter(r => r.status === 'wo_overdue' || r.status === 'blocked').length
    const soon = rows.filter(r => r.status === 'wo_soon').length
    const behind = rows.filter(r => r.status === 'behind').length
    return { pct, overdue, soon, behind, count: items.length }
  }, [items, rows])

  function run(fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) {
    start(async () => {
      const res = await fn()
      if (res?.error) toast.error(res.error)
      else { if (okMsg) toast.success(okMsg); router.refresh() }
    })
  }

  const attention = rows.filter(r => NEEDS_ATTENTION.includes(r.status))
  const rest = rows.filter(r => !NEEDS_ATTENTION.includes(r.status))

  // group table rows by trade (preserve order)
  const byTrade = useMemo(() => {
    const groups: { trade: string; rows: typeof rows }[] = []
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
        <span className="ml-auto text-sm text-gray-500 font-mono">as of {formatDate(today)}</span>
      </div>

      {/* rollup */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm">
          <span className="text-lg font-bold font-mono">{overall.pct}%</span><span className="text-xs text-gray-500">done</span>
        </span>
        {overall.overdue > 0 && <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-rose-600" />{overall.overdue} WO/drawing overdue</span>}
        {overall.behind > 0 && <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold">{overall.behind} behind</span>}
        {overall.soon > 0 && <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 text-amber-700 px-3 py-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-amber-500" />{overall.soon} WO due soon</span>}
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 text-slate-600 px-3 py-2 text-sm">{overall.count} item{overall.count === 1 ? '' : 's'}</span>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border bg-slate-50 p-1">
          <button onClick={() => setView('board')} className={cn('px-3 py-1.5 text-sm rounded-md', view === 'board' ? 'bg-white text-indigo-700 font-semibold shadow-sm' : 'text-gray-500')}>🗂️ Board</button>
          <button onClick={() => setView('table')} className={cn('px-3 py-1.5 text-sm rounded-md', view === 'table' ? 'bg-white text-indigo-700 font-semibold shadow-sm' : 'text-gray-500')}>📋 Table</button>
        </div>
        {meId && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-indigo-600" />
            <User className="h-3.5 w-3.5" /> My items
          </label>
        )}
        {canEdit && <Button size="sm" onClick={() => setShowAdd(v => !v)} className="ml-auto bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add work item</Button>}
      </div>

      {canEdit && showAdd && <AddItemForm projectId={project.id} pending={pending} onAdd={(input) => run(() => addSchedItem(input), 'Added')} onClose={() => setShowAdd(false)} />}

      {items.length === 0 ? (
        <Card className="p-8 text-center space-y-3">
          <CalendarClock className="h-8 w-8 mx-auto text-indigo-400" />
          <p className="text-gray-600">No work items yet. {canEdit ? 'Add your first item to start the schedule.' : 'The schedule hasn’t been set up yet.'}</p>
          {canEdit && !showAdd && <Button onClick={() => setShowAdd(true)} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add work item</Button>}
        </Card>
      ) : view === 'board' ? (
        <div className="space-y-4">
          {attention.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-rose-600 mb-2">⚑ Needs attention · {attention.length}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {attention.map(r => <BoardCard key={r.item.id} row={r} canEdit={canEdit} today={today} onWo={() => run(() => setWoIssued({ id: r.item.id, projectId: project.id, issued: true, issuedOn: today }), 'WO marked issued')} />)}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Running &amp; upcoming · {rest.length}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rest.map(r => <BoardCard key={r.item.id} row={r} canEdit={canEdit} today={today} onWo={() => run(() => setWoIssued({ id: r.item.id, projectId: project.id, issued: true, issuedOn: today }), 'WO marked issued')} />)}
            </div>
          </div>
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="px-3 py-2">Work</th>
                <th className="px-3 py-2">Site start → finish</th>
                <th className="px-3 py-2">WO</th>
                <th className="px-3 py-2">%</th>
                <th className="px-3 py-2">Status</th>
                {canEdit && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {byTrade.map(g => (
                <TradeGroup key={g.trade} trade={g.trade} rows={g.rows} canEdit={canEdit} projectId={project.id} run={run} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-[11px] text-gray-400 font-mono">
        WO deadline auto-computed: site-start − {leads.procurement}d. Dates move freely (a reason is logged); no amounts here — just WO issued or not.
      </p>
    </div>
  )
}

function ringColor(status: DisplayStatus) {
  const t = STATUS_META[status].tone
  return t === 'late' ? '#e11d48' : t === 'soon' ? '#d97706' : t === 'ok' ? '#0d9488' : '#94a3b8'
}

function BoardCard({ row, canEdit, today, onWo }: {
  row: { item: SchedItem; status: DisplayStatus; woBy: string | null; behindDays: number; woLateDays: number }
  canEdit: boolean; today: string; onWo: () => void
}) {
  const { item, status, woBy, behindDays, woLateDays } = row
  const pct = item.pct
  const sub = [item.trade, item.sub].filter(Boolean).join(' · ')
  let why = ''
  if (status === 'wo_overdue') why = `WO ${woLateDays}d late`
  else if (status === 'wo_soon') why = woBy ? `raise WO by ${formatDate(woBy)}` : 'raise WO'
  else if (status === 'behind') why = `${behindDays}d behind`
  else if (status === 'blocked') why = 'blocked — drawing'
  else if (status === 'in_progress') why = 'on track'
  else if (status === 'upcoming') why = item.plan_start ? `starts ${formatDate(item.plan_start)}` : 'not scheduled'
  else if (status === 'done') why = 'complete'
  else if (status === 'on_hold') why = 'on hold'

  return (
    <Card className="p-4 border-l-4" style={{ borderLeftColor: ringColor(status) }}>
      <div className="flex items-center gap-3">
        <span className="relative h-11 w-11 rounded-full grid place-items-center flex-shrink-0"
          style={{ background: `conic-gradient(${ringColor(status)} ${pct}%, #e5ebf0 0)` }}>
          <span className="absolute h-8 w-8 rounded-full bg-white" />
          <span className="relative text-[11px] font-bold font-mono">{pct}%</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 leading-tight truncate">{item.name}</div>
          <div className="text-[11px] text-gray-500 font-mono truncate">{sub}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusChip status={status} />
        <span className="text-xs text-gray-600">{why}</span>
      </div>
      {canEdit && !item.wo_issued && (status === 'wo_overdue' || status === 'wo_soon') && (
        <Button size="sm" variant="outline" className="mt-3 w-full" onClick={onWo}>Mark WO issued</Button>
      )}
      {item.wo_issued && <div className="mt-3 text-[11px] font-mono text-emerald-700">✓ {item.wo_number || 'WO'}{item.wo_issued_on ? ` · ${formatDate(item.wo_issued_on)}` : ''}</div>}
    </Card>
  )
}

function TradeGroup({ trade, rows, canEdit, projectId, run }: {
  trade: string
  rows: Array<{ item: SchedItem; status: DisplayStatus; woBy: string | null }>
  canEdit: boolean; projectId: string
  run: (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) => void
}) {
  const pct = (() => {
    const a = rows.filter(r => r.item.state !== 'on_hold')
    return a.length ? Math.round(a.reduce((s, r) => s + r.item.pct, 0) / a.length) : 0
  })()
  return (
    <>
      <tr className="bg-slate-50 border-y">
        <td colSpan={canEdit ? 6 : 5} className="px-3 py-2">
          <span className="font-bold text-gray-800 text-xs">{trade}</span>
          <span className="ml-2 text-[11px] font-mono text-indigo-600 font-semibold">{pct}%</span>
          <span className="ml-2 text-[11px] text-gray-400">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
        </td>
      </tr>
      {rows.map(r => <ItemRow key={r.item.id} row={r} canEdit={canEdit} projectId={projectId} run={run} />)}
    </>
  )
}

function ItemRow({ row, canEdit, projectId, run }: {
  row: { item: SchedItem; status: DisplayStatus; woBy: string | null }
  canEdit: boolean; projectId: string
  run: (fn: () => Promise<{ ok?: true; error?: string }>, okMsg?: string) => void
}) {
  const { item, status, woBy } = row
  return (
    <tr className="border-b hover:bg-slate-50/60">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-900 leading-tight">{item.name}</div>
        {item.sub && <div className="text-[11px] text-gray-500">{item.sub}</div>}
      </td>
      <td className="px-3 py-2">
        {canEdit ? (
          <div className="flex items-center gap-1">
            <input type="date" defaultValue={item.plan_start ?? ''} className="text-xs border rounded px-1.5 py-1 font-mono"
              onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_start', from: item.plan_start, to: e.target.value || null }), 'Start date updated')} />
            <span className="text-gray-300">→</span>
            <input type="date" defaultValue={item.plan_end ?? ''} className="text-xs border rounded px-1.5 py-1 font-mono"
              onChange={e => run(() => moveSchedDate({ id: item.id, projectId, field: 'plan_end', from: item.plan_end, to: e.target.value || null }), 'Finish date updated')} />
          </div>
        ) : (
          <span className="text-xs font-mono text-gray-700">{item.plan_start ? formatDate(item.plan_start) : '—'} → {item.plan_end ? formatDate(item.plan_end) : '—'}</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {item.wo_issued
          ? <span className="text-xs font-mono text-emerald-700 font-semibold">✓ {item.wo_number || 'issued'}</span>
          : woBy
            ? (canEdit
              ? <button className="text-xs font-mono text-indigo-600 underline" onClick={() => run(() => setWoIssued({ id: item.id, projectId, issued: true, issuedOn: null }), 'WO marked issued')}>by {formatDate(woBy)} · mark issued</button>
              : <span className="text-xs font-mono text-gray-500">by {formatDate(woBy)}</span>)
            : <span className="text-xs text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2">
        {canEdit
          ? <input type="number" min={0} max={100} defaultValue={item.pct} className="w-14 text-xs border rounded px-1.5 py-1 font-mono"
              onBlur={e => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== item.pct) run(() => updateSchedItem(item.id, projectId, { pct: v, state: v >= 100 ? 'done' : v > 0 ? 'in_progress' : item.state }), 'Progress updated') }} />
          : <span className="text-xs font-mono">{item.pct}%</span>}
      </td>
      <td className="px-3 py-2"><StatusChip status={status} /></td>
      {canEdit && (
        <td className="px-3 py-2 text-right">
          <button className="text-gray-300 hover:text-rose-600" title="Delete"
            onClick={async () => { if (await confirm({ title: 'Delete work item?', message: `Remove "${item.name}" from the schedule?`, confirmLabel: 'Delete', danger: true })) run(() => deleteSchedItem(item.id, projectId), 'Deleted') }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
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
