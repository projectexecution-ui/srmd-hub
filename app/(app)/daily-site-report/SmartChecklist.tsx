'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Search, Star, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatINR } from '@/lib/jmr/format'
import { StatPill } from '@/components/ui/stat-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { StageTicks } from '@/components/daily-site-report/StageTicks'
import { AttentionBadge } from '@/components/daily-site-report/AttentionBadge'
import {
  deriveStage, deriveAttention, deriveSteps, needsAttention, isComplete,
  type Severity,
} from '@/lib/daily-site-report/stages'

export interface ChecklistRow {
  id: string
  projectId: string
  project: string
  supplier: string
  material: string
  amount: number | null
  billNo: string
  received_on: string
  checked_against_bill: boolean
  checked_against_bill_on: string | null
  bill_submitted_to_ct: boolean
  bill_submitted_to_ct_on: string | null
  payment_started: boolean
  payment_started_on: string | null
  grn_done: boolean
  grn_done_on: string | null
  paid: boolean
  paid_on: string | null
  headNote: string
  flagged: boolean
  followUpOn: string | null
}

const SEV_RANK: Record<Severity, number> = { urgent: 3, warn: 2, ok: 1, none: 0 }

export function SmartChecklist({
  rows, today, canTrack, isHead, myProjectIds,
}: {
  rows: ChecklistRow[]
  today: string
  canTrack: boolean
  isHead: boolean
  myProjectIds: string[]
}) {
  const hasScope = isHead && myProjectIds.length > 0
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Per-row tracking state (note + flag), edited in place by management.
  const [track, setTrack] = useState<Record<string, { note: string; flagged: boolean }>>(() => {
    const m: Record<string, { note: string; flagged: boolean }> = {}
    for (const r of rows) m[r.id] = { note: r.headNote, flagged: r.flagged }
    return m
  })

  // Enrich every row once with derived stage / attention / steps.
  const enriched = useMemo(
    () => rows.map(r => {
      const attention = deriveAttention(r, today)
      return {
        r,
        stage: deriveStage(r),
        attention,
        steps: deriveSteps(r),
        sev: SEV_RANK[attention.severity],
        done: isComplete(r),
      }
    }),
    [rows, today],
  )

  // 1) Head scope (default to their projects, unless "show all").
  const scoped = useMemo(() => {
    const base = hasScope && !showAll
      ? enriched.filter(e => myProjectIds.includes(e.r.projectId))
      : enriched
    return base.filter(e => {
      if (siteFilter && e.r.project !== siteFilter) return false
      if (from && e.r.received_on < from) return false
      if (to && e.r.received_on > to) return false
      return true
    })
  }, [enriched, hasScope, showAll, myProjectIds, siteFilter, from, to])

  // 2) User filters (attention / flag / stage / search).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = scoped.filter(e => {
      if (attentionOnly && !needsAttention(e.attention)) return false
      if (flaggedOnly && !track[e.r.id]?.flagged) return false
      if (stageFilter && e.stage.label !== stageFilter) return false
      if (q && ![e.r.supplier, e.r.material, e.r.billNo, e.r.project].some(v => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
    // Worst attention first, then longest-waiting, then biggest value.
    return list.sort((a, b) =>
      b.sev - a.sev ||
      b.attention.waitingDays - a.attention.waitingDays ||
      (b.r.amount ?? 0) - (a.r.amount ?? 0),
    )
  }, [scoped, attentionOnly, flaggedOnly, stageFilter, query, track])

  // Summary tiles reflect the head-scoped set (before user filters).
  const summary = useMemo(() => {
    const arrivedToday = scoped.filter(e => e.r.received_on === today).length
    const billNotCt = scoped.filter(e => !e.r.bill_submitted_to_ct).length
    const awaitingPay = scoped.filter(e => !e.r.paid && !e.done).length
    const grnPending = scoped.filter(e => !e.r.grn_done && !e.done).length
    const attention = scoped.filter(e => needsAttention(e.attention)).length
    return { arrivedToday, billNotCt, awaitingPay, grnPending, attention }
  }, [scoped, today])

  const sites = useMemo(() => {
    const base = hasScope && !showAll ? enriched.filter(e => myProjectIds.includes(e.r.projectId)) : enriched
    return [...new Set(base.map(e => e.r.project).filter(Boolean))].sort()
  }, [enriched, hasScope, showAll, myProjectIds])
  const stages = useMemo(() => [...new Set(scoped.map(e => e.stage.label))], [scoped])

  const anyFilter = !!(query || siteFilter || stageFilter || attentionOnly || flaggedOnly || from || to)
  function clearFilters() {
    setQuery(''); setSiteFilter(''); setStageFilter(''); setAttentionOnly(false); setFlaggedOnly(false); setFrom(''); setTo('')
  }

  async function save(id: string, patch: { head_note?: string; flagged?: boolean }) {
    const res = await fetch('/api/daily-site-report/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: id, ...patch }),
    })
    const json = await res.json().catch(() => ({ ok: false }))
    if (!json.ok) throw new Error(json.reason ?? 'save failed')
  }

  function setNoteLocal(id: string, note: string) {
    setTrack(prev => ({ ...prev, [id]: { ...(prev[id] ?? { note: '', flagged: false }), note } }))
  }
  async function saveNote(id: string) {
    if (!canTrack) return
    try { await save(id, { head_note: (track[id]?.note ?? '').slice(0, 500) }) }
    catch (e) { toast.error(`Couldn't save note — ${e instanceof Error ? e.message : 'try again'}`) }
  }
  async function toggleFlag(id: string) {
    if (!canTrack) return
    const cur = track[id] ?? { note: '', flagged: false }
    const next = !cur.flagged
    setTrack(prev => ({ ...prev, [id]: { ...cur, flagged: next } })) // optimistic
    try { await save(id, { flagged: next }) }
    catch (e) {
      setTrack(prev => ({ ...prev, [id]: cur })) // revert
      toast.error(`Couldn't update flag — ${e instanceof Error ? e.message : 'try again'}`)
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Search className="h-10 w-10" />}
        title="No site reports yet"
        description="Site engineers log material/supplier deliveries here. Once they do, deliveries and their status appear in this checklist."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatPill label="Arrived today" value={summary.arrivedToday} />
        <StatPill label="Bill not with CT" value={summary.billNotCt} />
        <StatPill label="Awaiting payment" value={summary.awaitingPay} />
        <StatPill label="GRN pending" value={summary.grnPending} />
        <StatPill label="Needs attention" value={summary.attention} hint="Over SLA" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search supplier, material, bill no…"
            className="h-9 w-60 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </div>
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none focus:border-teal-400">
          <option value="">All sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none focus:border-teal-400">
          <option value="">All stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} className="h-4 w-4 accent-red-600" />
          Needs attention
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Flagged
        </label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From date"
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-600 outline-none focus:border-teal-400" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To date"
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-600 outline-none focus:border-teal-400" />
        {anyFilter && (
          <button onClick={clearFilters} className="text-sm font-medium text-teal-600 hover:text-teal-800">Clear</button>
        )}
        {hasScope && (
          <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="h-4 w-4 accent-teal-600" />
            Show all sites
          </label>
        )}
        <div className={cn('text-sm text-gray-500', !hasScope && 'ml-auto')}>
          {filtered.length} of {scoped.length}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2.5">#</th>
              <th className="px-2 py-2.5">Site</th>
              <th className="px-2 py-2.5">Supplier</th>
              <th className="px-2 py-2.5">Material</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5">Progress</th>
              <th className="px-2 py-2.5">Attention</th>
              <th className="px-2 py-2.5">Follow-up</th>
              <th className="px-1.5 py-2.5 text-center">Flag</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const r = e.r
              const t = track[r.id] ?? { note: '', flagged: false }
              return (
                <tr key={r.id} className={cn('border-t border-gray-100', i % 2 ? 'bg-gray-50/50' : 'bg-white', e.done && 'bg-green-50/70')}>
                  <td className="px-2 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-2.5">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">{r.project}</span>
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-2.5 text-gray-800" title={r.supplier}>{r.supplier}</td>
                  <td className="max-w-[220px] px-2 py-2.5">
                    <Link href={`/daily-site-report/${r.id}`} className="truncate font-medium text-gray-900 hover:text-teal-700" title={r.material}>
                      {r.material}
                    </Link>
                    <span className="block text-[11px] text-gray-400">{r.billNo || '—'} · {r.received_on}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                    {r.amount != null ? formatINR(r.amount) : '—'}
                  </td>
                  <td className="px-2 py-2.5"><StageTicks steps={e.steps} /></td>
                  <td className="px-2 py-2.5"><AttentionBadge attention={e.attention} /></td>
                  <td className="px-2 py-2.5">
                    <input
                      type="text"
                      value={t.note}
                      disabled={!canTrack}
                      onChange={ev => setNoteLocal(r.id, ev.target.value)}
                      onBlur={() => saveNote(r.id)}
                      placeholder={canTrack ? 'Add follow-up…' : '—'}
                      title={t.note || undefined}
                      className="w-full min-w-[130px] max-w-[200px] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-gray-700 outline-none hover:border-gray-200 focus:border-teal-400 focus:bg-white focus:ring-1 focus:ring-teal-100 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-1.5 py-2.5 text-center">
                    <button
                      type="button"
                      disabled={!canTrack}
                      onClick={() => toggleFlag(r.id)}
                      className="inline-flex disabled:cursor-not-allowed"
                      aria-label={t.flagged ? 'Unflag' : 'Flag for follow-up'}
                      title={t.flagged ? 'Flagged' : 'Flag for follow-up'}
                    >
                      {t.flagged
                        ? <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                        : <Flag className={cn('h-4 w-4', canTrack ? 'text-gray-300 hover:text-amber-400' : 'text-gray-200')} />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Rows sorted by what needs chasing first. Ticks show the delivery&apos;s progress (Received · Checked · Bill w/ CT · Payment · GRN · Paid);
        the site engineer advances them. Follow-up notes &amp; flags are yours to track — they don&apos;t change the engineer&apos;s data.
      </p>
    </div>
  )
}
