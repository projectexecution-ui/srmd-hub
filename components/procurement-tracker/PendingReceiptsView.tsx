'use client'
// The "Pending Receipts" view — the screen the user actually came for.
// Lists every material line where pendingQty > 0 (ordered but not yet
// received), grouped by Supplier (default) or Indent. Comes with age
// filters and TWO CSV export modes:
//   1. "Download all" — full filtered list across every group.
//   2. Per-group icon — just that vendor's or indent's pending lines.
// Both produce identical column schemas so the user's purchase team can
// paste either into the same template.
//
// Group-by choice is persisted in localStorage so it sticks across
// reloads.

import { useEffect, useMemo, useState } from 'react'
import type { LineRecord } from '@/lib/procurement'
import { formatAgeFriendly } from '@/lib/procurement/shared'
import { Download, Users, ClipboardList, FileSpreadsheet, Search, ChevronDown, ChevronRight, X, Share2, Flame, ListOrdered, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChangeBadge } from './ChangeBadge'
import { SourceInspector } from './SourceInspector'
import { CardField } from './CardField'
import { Highlight } from './Highlight'
import { ChaseChip } from './ChaseChip'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { buildPendingShareText, shareOrCopy } from '@/lib/procurement/share'

type GroupKey = 'supplier' | 'indent' | 'none'
// Exact age bands (a line sits in exactly one) — so clicking a card shows
// precisely that band, with no cumulative-threshold surprise.
type AgeFilter = 'all' | 'lt7' | '7to14' | '14to30' | '30plus'

const GROUP_KEY_STORAGE = 'ct-procurement-pending-groupby'

// Aging overview cards: exact band + colour. 'all' clears the age filter.
const AGING_CARDS: { key: AgeFilter; label: string; cls: string; ring: string }[] = [
  { key: 'all',    label: 'All pending',  cls: 'bg-stone-50 border-stone-200 text-stone-700',       ring: 'ring-stone-300' },
  { key: 'lt7',    label: 'Under 7 days', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', ring: 'ring-emerald-300' },
  { key: '7to14',  label: '7–14 days',    cls: 'bg-amber-50 border-amber-200 text-amber-800',       ring: 'ring-amber-300' },
  { key: '14to30', label: '14–30 days',   cls: 'bg-rose-50 border-rose-200 text-rose-800',          ring: 'ring-rose-300' },
  { key: '30plus', label: '30+ days',     cls: 'bg-red-50 border-red-200 text-red-800',             ring: 'ring-red-400' },
]

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

// PRIMARY age for a pending receipt = days since the PO was raised — the
// honest "is the supplier actually late?" clock. Indent age (how long ago the
// site first asked) is kept as SECONDARY context, shown alongside, but it must
// NOT drive the red "overdue" colour: a fresh PO on an old indent isn't the
// vendor's fault. Falls back to indent age only when there's no PO date.
function indentAge(ln: LineRecord): number | null {
  return ln.indentAgeDays
}
function poAge(ln: LineRecord): number | null {
  return ln.oldestPoAgeDays
}
function primaryAge(ln: LineRecord): number | null {
  return poAge(ln) ?? indentAge(ln)
}

function ageClass(age: number | null) {
  if (age == null) return 'text-stone-500'
  if (age >= 30) return 'text-red-700 font-bold'
  if (age >= 14) return 'text-rose-600 font-semibold'
  if (age >= 7) return 'text-amber-700 font-medium'
  return 'text-stone-500'
}

function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADER = [
  'Supplier', 'PO No', 'PO Date', 'Days since PO',
  'Indent No', 'Indent Date', 'Days since indent',
  'Project / Block', 'Material', 'UOM',
  'Ordered', 'Received', 'Pending',
  'Pending Value (INR)',
]
function csvRow(ln: LineRecord) {
  const po = ln.pos[0]
  return [
    ln.supplier, po?.poNo ?? '', po?.poDate ?? '', poAge(ln) ?? '',
    ln.indentNo, ln.indentDate, indentAge(ln) ?? '',
    ln.block, ln.material, ln.uom,
    ln.orderedQty, ln.receivedQty, ln.pendingQty,
    ln.pendingValue.toFixed(2),
  ].map(csvEscape).join(',')
}

function downloadCsv(filename: string, rows: LineRecord[]) {
  const csv = [CSV_HEADER.join(','), ...rows.map(csvRow)].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function safe(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export'
}

export function PendingReceiptsView({
  lines,
  projectName,
  newLineIds,
  changedLineIds,
  chaseNotes,
  onNoteSaved,
  onDropped,
}: {
  lines: LineRecord[]
  projectName: string
  /** Line ids that didn't exist in the prior upload. Renders the green NEW pill. */
  newLineIds?: Set<string>
  /** Line ids that existed before but have changed. Renders the amber Updated pill. */
  changedLineIds?: Set<string>
  /** Per-indent chase notes, keyed by indent number. */
  chaseNotes?: Map<string, ChaseNote>
  /** Called with the fresh note after the detail sheet saves one. */
  onNoteSaved?: (n: ChaseNote) => void
  /** Called after an item is dropped/restored in the detail sheet. */
  onDropped?: () => void
}) {
  const [groupBy, setGroupBy] = useState<GroupKey>('supplier')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  const [supplierQuery, setSupplierQuery] = useState('')
  // Line currently shown in the source-rows inspector modal (or null = closed).
  const [inspectingLine, setInspectingLine] = useState<LineRecord | null>(null)
  // Per-group collapse state — keyed by group.key. Group is shown
  // expanded by default; clicking the header header tucks it down
  // to just the summary row. "Collapse all" / "Expand all" toggles
  // every group at once.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleCollapsed = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Restore the group-by choice from localStorage on mount
  useEffect(() => {
    try {
      const v = localStorage.getItem(GROUP_KEY_STORAGE)
      if (v === 'supplier' || v === 'indent' || v === 'none') setGroupBy(v)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(GROUP_KEY_STORAGE, groupBy) } catch { /* ignore */ }
  }, [groupBy])

  // Only PENDING lines (ordered but not yet received)
  const pending = useMemo(() => {
    return lines.filter(ln => ln.pendingQty > 0)
  }, [lines])

  // Per-indent progress — how many of the indent's items are already fully
  // received. Drives the "X of Y items in this indent received" line so a lone
  // outstanding item doesn't look like a mostly-delivered indent is wrong.
  const indentProgress = useMemo(() => {
    const m = new Map<string, { total: number; received: number }>()
    for (const ln of lines) {
      const e = m.get(ln.indentNo) ?? { total: 0, received: 0 }
      e.total++
      if (ln.status === 'received') e.received++
      m.set(ln.indentNo, e)
    }
    return m
  }, [lines])
  function indentContext(indentNo: string): string | null {
    const p = indentProgress.get(indentNo)
    if (!p || p.received === 0) return null
    return `${p.received} of ${p.total} item${p.total === 1 ? '' : 's'} in this indent received`
  }

  // Supplier search narrows the WHOLE view — overview cards + the list.
  const searched = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase()
    if (!q) return pending
    return pending.filter(ln => (ln.supplier || '').toLowerCase().includes(q))
  }, [pending, supplierQuery])

  // Each card is an EXACT age band, so the filter matches the label exactly.
  const filtered = useMemo(() => {
    if (ageFilter === 'all') return searched
    return searched.filter(ln => {
      const a = primaryAge(ln) ?? 0
      if (ageFilter === 'lt7') return a < 7
      if (ageFilter === '7to14') return a >= 7 && a < 14
      if (ageFilter === '14to30') return a >= 14 && a < 30
      return a >= 30
    })
  }, [searched, ageFilter])

  // Group + sort by PO age (longest-waiting-since-PO first within each group)
  // so the deliveries the vendor is most overdue on bubble up.
  const groups = useMemo(() => {
    // Flat list — one group, no grouping, biggest ₹ then oldest first.
    if (groupBy === 'none') {
      const all = [...filtered].sort((a, b) => (b.pendingValue - a.pendingValue) || ((primaryAge(b) ?? 0) - (primaryAge(a) ?? 0)))
      return [{ key: '__all__', label: `All ${all.length} pending line${all.length === 1 ? '' : 's'}`, lines: all }]
    }
    const map = new Map<string, { key: string; label: string; lines: LineRecord[] }>()
    for (const ln of filtered) {
      const key = groupBy === 'supplier' ? (ln.supplier || '— Unknown vendor —') : ln.indentNo
      const label = groupBy === 'supplier' ? key : ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')
      let g = map.get(key)
      if (!g) { g = { key, label, lines: [] }; map.set(key, g) }
      g.lines.push(ln)
    }
    for (const g of map.values()) {
      g.lines.sort((a, b) => (primaryAge(b) ?? 0) - (primaryAge(a) ?? 0))
    }
    // Sort groups by total pending value desc
    return Array.from(map.values()).sort((a, b) =>
      b.lines.reduce((s, l) => s + l.pendingValue, 0)
      - a.lines.reduce((s, l) => s + l.pendingValue, 0))
  }, [filtered, groupBy])

  // Top-level stats
  const totalPendingValue = filtered.reduce((s, l) => s + l.pendingValue, 0)
  const totalPendingLines = filtered.length

  // Aging distribution — count + outstanding VALUE per exact band, over the
  // (supplier-)searched set. Value is the real signal a PM wants — a plain
  // count bar hid it. Drives the clickable cards above the list.
  const buckets = useMemo(() => {
    const mk = () => ({ count: 0, value: 0 })
    const out = { all: mk(), lt7: mk(), '7to14': mk(), '14to30': mk(), '30plus': mk() }
    for (const ln of searched) {
      const a = primaryAge(ln) ?? 0
      out.all.count++; out.all.value += ln.pendingValue
      const b: 'lt7' | '7to14' | '14to30' | '30plus' = a < 7 ? 'lt7' : a < 14 ? '7to14' : a < 30 ? '14to30' : '30plus'
      out[b].count++; out[b].value += ln.pendingValue
    }
    return out
  }, [searched])

  // "Chase first" — biggest ₹, then oldest — across the current filter.
  const chaseFirst = useMemo(
    () => [...filtered].sort((a, b) => (b.pendingValue - a.pendingValue) || ((primaryAge(b) ?? 0) - (primaryAge(a) ?? 0))).slice(0, 5),
    [filtered],
  )

  async function shareGroup(label: string, groupLines: LineRecord[]) {
    const res = await shareOrCopy(`Pending — ${label}`, buildPendingShareText(label, groupLines))
    if (res === 'copied') toast.success('List copied — paste into WhatsApp / email')
    else if (res === 'failed') toast.error('Could not share on this device')
  }

  if (lines.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
        <FileSpreadsheet className="h-8 w-8 text-stone-300 mx-auto mb-2" />
        <p className="text-stone-500 text-sm">No data — upload a report first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top stats + controls */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-stone-800">Pending receipts</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              <b className="text-stone-800">{totalPendingLines}</b> material line{totalPendingLines === 1 ? '' : 's'} ordered but not yet received
              {totalPendingValue > 0 && <> · <b className="text-amber-700">{fmtINR(totalPendingValue)}</b> outstanding</>}
            </p>
          </div>
          <button
            onClick={() => downloadCsv(`${safe(projectName)}-pending-receipts-${new Date().toISOString().slice(0, 10)}.csv`, filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Download all ({filtered.length})
          </button>
        </div>

        {/* Aging overview — one card per exact band, showing how many lines
            AND how much money is stuck. Click a card to filter to that band. */}
        {searched.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
              Waiting since PO — click to filter
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 lg:grid-cols-5">
              {AGING_CARDS.map(c => {
                const stat = buckets[c.key]
                const active = ageFilter === c.key
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setAgeFilter(c.key)}
                    className={cn(
                      'text-left rounded-lg border px-3 py-2 transition-all min-w-[128px] flex-shrink-0 sm:min-w-0 sm:flex-shrink',
                      c.cls,
                      active ? `ring-2 ring-offset-1 ${c.ring}` : 'hover:shadow-sm',
                    )}
                    title={`${stat.count} line${stat.count === 1 ? '' : 's'}${stat.value > 0 ? ` · ${fmtINR(stat.value)} outstanding` : ''}`}
                  >
                    <div className="text-[11px] font-semibold leading-tight">{c.label}</div>
                    <div className="text-lg font-bold leading-none mt-1 tabular-nums">{stat.count}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{stat.value > 0 ? fmtINR(stat.value) : '—'}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          {/* Group-by toggle — full-width equal split on mobile */}
          <div className="flex w-full sm:w-auto sm:inline-flex bg-stone-100 rounded-lg p-0.5">
            <button
              onClick={() => setGroupBy('supplier')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'supplier' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <Users className="h-3 w-3 flex-shrink-0" /> <span className="sm:hidden">Supplier</span><span className="hidden sm:inline">Group by supplier</span>
            </button>
            <button
              onClick={() => setGroupBy('indent')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'indent' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <ClipboardList className="h-3 w-3 flex-shrink-0" /> <span className="sm:hidden">Indent</span><span className="hidden sm:inline">Group by indent</span>
            </button>
            <button
              onClick={() => setGroupBy('none')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'none' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
              title="One flat list, biggest value first"
            >
              <ListOrdered className="h-3 w-3 flex-shrink-0" /> Flat
            </button>
          </div>

          {/* Supplier search — narrows the cards + list to matching vendors */}
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 pointer-events-none" />
            <input
              type="text"
              value={supplierQuery}
              onChange={e => setSupplierQuery(e.target.value)}
              placeholder="Search supplier…"
              className="pl-8 pr-7 h-8 w-full sm:w-52 rounded-lg border border-stone-200 bg-white text-xs text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
            />
            {supplierQuery && (
              <button
                type="button"
                onClick={() => setSupplierQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Collapse-all / Expand-all — only useful when there are
              multiple groups; hide otherwise. */}
          {groups.length > 1 && (
            <div className="flex w-full sm:w-auto sm:ml-auto gap-1 justify-end">
              <button
                onClick={() => setCollapsed(new Set(groups.map(g => g.key)))}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 inline-flex items-center gap-1"
                title="Collapse every group"
              >
                <ChevronRight className="h-3 w-3" /> Collapse all
              </button>
              <button
                onClick={() => setCollapsed(new Set())}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 inline-flex items-center gap-1"
                title="Expand every group"
              >
                <ChevronDown className="h-3 w-3" /> Expand all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active filters — one glance at what's applied, one tap to clear */}
      {(ageFilter !== 'all' || supplierQuery) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Filters</span>
          {ageFilter !== 'all' && (
            <button onClick={() => setAgeFilter('all')} className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-100 text-amber-800 rounded-full pl-2.5 pr-1.5 py-1">
              {AGING_CARDS.find(a => a.key === ageFilter)?.label}<X className="h-3 w-3" />
            </button>
          )}
          {supplierQuery && (
            <>
              <button onClick={() => setSupplierQuery('')} className="inline-flex items-center gap-1 text-[11px] font-medium bg-stone-100 text-stone-700 rounded-full pl-2.5 pr-1.5 py-1">
                Vendor: {supplierQuery}<X className="h-3 w-3" />
              </button>
              <span className="text-[11px] text-stone-500 font-medium">{totalPendingLines} match{totalPendingLines === 1 ? '' : 'es'}</span>
            </>
          )}
          <button onClick={() => { setAgeFilter('all'); setSupplierQuery('') }} className="text-[11px] font-medium text-stone-500 hover:text-stone-800 underline ml-1">Clear all</button>
        </div>
      )}

      {/* Chase first — the 5 biggest / oldest across the current filter */}
      {chaseFirst.length >= 3 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-800 font-bold mb-1 inline-flex items-center gap-1"><Flame className="h-3 w-3" /> Chase first — biggest / oldest</div>
          <div className="flex flex-col divide-y divide-amber-100/70">
            {chaseFirst.map(ln => (
              <button key={ln.id} type="button" onClick={() => setInspectingLine(ln)}
                className="flex items-center gap-2 text-left text-xs py-1.5 hover:bg-white/50 rounded px-1">
                <span className="font-bold text-stone-800 tabular-nums w-[68px] flex-shrink-0">{ln.pendingValue > 0 ? fmtINR(ln.pendingValue) : '—'}</span>
                <span className="text-stone-700 truncate flex-1" title={ln.material}>{ln.material}</span>
                <span className="hidden sm:inline text-[11px] text-stone-500 truncate max-w-[140px] flex-shrink-0">{ln.supplier || ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}</span>
                <span className={cn('text-[11px] tabular-nums flex-shrink-0 w-10 text-right', ageClass(primaryAge(ln)))} title="days since PO">{primaryAge(ln) ?? '—'}d</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
          {supplierQuery
            ? <Search className="h-7 w-7 text-stone-400 mx-auto mb-2" />
            : <CheckCircle2 className="h-7 w-7 text-emerald-500 mx-auto mb-2" />}
          <p className="text-stone-700 font-medium">
            {supplierQuery ? `No suppliers match “${supplierQuery}”.` : 'All clear in this filter.'}
          </p>
          <p className="text-stone-500 text-sm">
            {supplierQuery ? 'Try a different name, or clear the search.' : 'Nothing pending receipt in this band.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => {
            const groupPendingValue = g.lines.reduce((s, l) => s + l.pendingValue, 0)
            // "Oldest" in the group header = oldest PO age — same clock as the
            // table sort + aging buckets, so the user sees one consistent
            // "days waiting since PO" per group.
            const oldestAge = g.lines.reduce<number | null>((mx, l) => {
              const a = primaryAge(l)
              if (a == null) return mx
              return mx == null ? a : Math.max(mx, a)
            }, null)
            // While searching, force every group open so matches are visible.
            const isCollapsed = supplierQuery ? false : collapsed.has(g.key)
            return (
              <div key={g.key} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                {/* Group header — click anywhere except the CSV button to toggle */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-stone-50 border-b border-stone-100">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(g.key)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80"
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-stone-400 flex-shrink-0" />
                      : <ChevronDown  className="h-4 w-4 text-stone-400 flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-stone-800 truncate" title={g.label}>
                          {groupBy === 'supplier' ? <Highlight text={g.label} query={supplierQuery} /> : g.label}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {fmtINR(groupPendingValue)} pending
                        </span>
                        {oldestAge != null && oldestAge >= 7 && (
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${ageClass(oldestAge)} bg-white border border-stone-200`}>
                            {oldestAge}d
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => shareGroup(g.label, g.lines)}
                      className="inline-flex items-center justify-center gap-1 h-8 w-8 sm:w-auto sm:px-2 text-[11px] font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 rounded-md"
                      title={`Share ${g.label}'s pending list (WhatsApp / copy)`}
                    >
                      <Share2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Share</span>
                    </button>
                    <button
                      onClick={() => downloadCsv(`${safe(groupBy === 'supplier' ? g.key : g.label)}-pending-${new Date().toISOString().slice(0, 10)}.csv`, g.lines)}
                      className="inline-flex items-center justify-center gap-1 h-8 w-8 sm:w-auto sm:px-2 text-[11px] font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 rounded-md"
                      title={`Download just ${g.label}'s pending lines`}
                    >
                      <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">CSV</span>
                    </button>
                  </div>
                </div>

                {/* Lines — hidden when collapsed */}
                {!isCollapsed && (
                <>
                {/* Desktop: full table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-stone-100">
                      <tr>
                        {groupBy !== 'supplier' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Supplier</th>}
                        {groupBy !== 'indent'   && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Indent</th>}
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Material</th>
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">PO</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="Days since the indent was raised (your primary clock)">
                          Since indent
                        </th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="Days since PO was raised — '—' if no PO yet">
                          Since PO
                        </th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Ordered</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Received</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Pending</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {g.lines.map(ln => {
                        const po = ln.pos[0]
                        const indentAg = indentAge(ln)
                        const poAg = poAge(ln)
                        const indentFmt = formatAgeFriendly(indentAg)
                        const poFmt = formatAgeFriendly(poAg)
                        return (
                          <tr key={ln.id} className="hover:bg-stone-50">
                            {groupBy !== 'supplier' && (
                              <td className="px-4 py-2 text-xs text-stone-700 max-w-[180px] truncate" title={ln.supplier}>
                                <Highlight text={ln.supplier || '—'} query={supplierQuery} />
                              </td>
                            )}
                            {groupBy !== 'indent' && (
                              <td className="px-4 py-2 font-mono text-[11px] text-stone-700 whitespace-nowrap" title={ln.indentNo}>
                                {ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                              </td>
                            )}
                            <td className="px-4 py-2 text-xs text-stone-800 max-w-[260px]">
                              <div className="flex items-start gap-1.5">
                                <ChangeBadge id={ln.id} newLineIds={newLineIds} changedLineIds={changedLineIds} />
                                <span className="line-clamp-2 flex-1" title={ln.material}>{ln.material}</span>
                                <button
                                  type="button"
                                  onClick={() => setInspectingLine(ln)}
                                  className="text-stone-400 hover:text-orange-700 flex-shrink-0 mt-0.5"
                                  title="Show the Excel rows that built this entry"
                                  aria-label="Inspect source rows"
                                >
                                  <Search className="h-3 w-3" />
                                </button>
                              </div>
                              <span className="text-[10px] text-stone-400 inline-flex items-center gap-1.5">{ln.block}<ChaseChip note={chaseNotes?.get(ln.indentNo)} /></span>
                              {indentContext(ln.indentNo) && (
                                <span className="block text-[11px] text-stone-400 mt-0.5">{indentContext(ln.indentNo)}</span>
                              )}
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-stone-500 whitespace-nowrap" title={po?.poNo}>
                              {po?.poNo ? (
                                <span className="inline-flex items-center gap-1">
                                  {po.draft && (
                                    <span
                                      className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                                      title="DRAFT-PO/… — purchase team raised it but not yet finalised in IN4"
                                    >
                                      Draft
                                    </span>
                                  )}
                                  {po.inferred && (
                                    <span
                                      className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200"
                                      title="IN4 left this row's PO blank, but the same PO is listed on another item in this indent — so we linked it here. Assumed: please double-check in IN4."
                                    >
                                      Assumed
                                    </span>
                                  )}
                                  <span>
                                    {po.poNo
                                      .replace('DRAFT-PO/', '')
                                      .replace('PO/SRASSK/', '')
                                      .replace('PO/SRET/', '')}
                                  </span>
                                </span>
                              ) : '—'}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(indentAg)}`}
                              title={ln.indentDate ? `Indent date: ${ln.indentDate}` : 'Indent date unknown'}
                            >
                              <div>{indentFmt.short}</div>
                              {indentFmt.long && (
                                <div className="text-[10px] font-normal text-stone-400 leading-tight">{indentFmt.long}</div>
                              )}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(poAg)}`}
                              title={po?.poDate ? `PO date: ${po.poDate}` : 'No PO yet'}
                            >
                              <div>{poFmt.short}</div>
                              {poFmt.long && (
                                <div className="text-[10px] font-normal text-stone-400 leading-tight">{poFmt.long}</div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums text-stone-700">
                              {ln.orderedQty.toLocaleString('en-IN')} <span className="text-stone-400 text-[10px]">{ln.uom}</span>
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums text-emerald-700">
                              {ln.receivedQty.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums font-bold text-amber-700">
                              {ln.pendingQty.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums font-semibold text-stone-800">
                              {ln.pendingValue > 0 ? fmtINR(ln.pendingValue) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: stacked cards (no horizontal scroll) */}
                <div className="md:hidden divide-y divide-stone-100">
                  {g.lines.map(ln => {
                    const po = ln.pos[0]
                    const iAge = indentAge(ln)
                    const pAge = poAge(ln)
                    return (
                      <div key={ln.id} onClick={() => setInspectingLine(ln)} className="p-3 cursor-pointer active:bg-stone-50">
                        <div className="flex items-start gap-2">
                          <ChangeBadge id={ln.id} newLineIds={newLineIds} changedLineIds={changedLineIds} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-stone-800 line-clamp-2" title={ln.material}>{ln.material}</p>
                            <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                              {groupBy === 'supplier'
                                ? ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')
                                : <Highlight text={ln.supplier || '—'} query={supplierQuery} />}
                              {groupBy === 'none' ? ` · ${ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}` : ''}
                              {ln.block ? ` · ${ln.block}` : ''}
                            </p>
                            {indentContext(ln.indentNo) && (
                              <p className="text-[11px] text-stone-400 mt-0.5">{indentContext(ln.indentNo)}</p>
                            )}
                            <ChaseChip note={chaseNotes?.get(ln.indentNo)} className="mt-1" />
                          </div>
                          <button type="button" onClick={() => setInspectingLine(ln)}
                            className="text-stone-400 hover:text-orange-700 flex-shrink-0 -m-1 p-1" aria-label="Inspect source rows">
                            <Search className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2">
                          <CardField label="Since indent" className={ageClass(iAge)}>{formatAgeFriendly(iAge).short}</CardField>
                          <CardField label="Since PO" className={ageClass(pAge)}>{formatAgeFriendly(pAge).short}</CardField>
                          <CardField label="PO" className="text-stone-500 font-mono text-[11px]">
                            {po?.poNo ? po.poNo.replace('DRAFT-PO/', '').replace('PO/SRASSK/', '').replace('PO/SRET/', '') : '—'}
                            {po?.inferred && (
                              <span className="ml-1 not-italic font-sans text-[10px] font-semibold text-indigo-700" title="Assumed — IN4 didn't state this PO on this row; verify in IN4.">
                                (assumed)
                              </span>
                            )}
                          </CardField>
                          <CardField label="Ordered" className="text-stone-700">{ln.orderedQty.toLocaleString('en-IN')} {ln.uom}</CardField>
                          <CardField label="Pending" className="text-amber-700 font-bold">{ln.pendingQty.toLocaleString('en-IN')}</CardField>
                          <CardField label="Value" className="text-stone-800 font-semibold">{ln.pendingValue > 0 ? fmtINR(ln.pendingValue) : '—'}</CardField>
                        </div>
                      </div>
                    )
                  })}
                </div>
                </>
                )}
              </div>
            )
          })}
        </div>
      )}
      <SourceInspector
        line={inspectingLine}
        onClose={() => setInspectingLine(null)}
        note={inspectingLine ? chaseNotes?.get(inspectingLine.indentNo) : undefined}
        onNoteSaved={onNoteSaved}
        onToggleDrop={onDropped}
      />
    </div>
  )
}
