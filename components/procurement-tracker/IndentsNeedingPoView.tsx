'use client'
// Sister of PendingReceiptsView. Shows material lines where the purchase
// team has NOT raised a PO yet (line.status === 'no_po'). Grouped by
// indent (default) or by block, sorted oldest indent first. Same UX
// language as PendingReceiptsView — same age filter chips, same per-
// group CSV export, same look.
//
// Why per-LINE and not per-indent? Because in real exports an indent
// often has 10 materials and only 7 are PO'd — the other 3 still need
// chasing. A pure indent-status filter would miss them.

import { useEffect, useMemo, useState } from 'react'
import type { LineRecord } from '@/lib/procurement'
import { formatAgeFriendly } from '@/lib/procurement/shared'
import { Download, ClipboardList, Layers, AlertTriangle, FileSpreadsheet, CheckCircle2, Search, ChevronDown, ChevronRight, X, Share2, Flame, ListOrdered } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChangeBadge } from './ChangeBadge'
import { SourceInspector } from './SourceInspector'
import { CardField } from './CardField'
import { Highlight } from './Highlight'
import { ChaseChip } from './ChaseChip'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { buildNeedsPoShareText, shareOrCopy } from '@/lib/procurement/share'

const ABANDONED_DAYS = 90

type GroupKey = 'indent' | 'block' | 'none'
type AgeFilter = 'all' | 'lt7' | '7to14' | '14to30' | '30plus'

const GROUP_KEY_STORAGE = 'ct-procurement-needspo-groupby'

// Aging overview cards — exact bands. 'all' clears the age filter.
const AGING_CARDS: { key: AgeFilter; label: string; cls: string; ring: string }[] = [
  { key: 'all',    label: 'All waiting',  cls: 'bg-stone-50 border-stone-200 text-stone-700',       ring: 'ring-stone-300' },
  { key: 'lt7',    label: 'Under 7 days', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', ring: 'ring-emerald-300' },
  { key: '7to14',  label: '7–14 days',    cls: 'bg-amber-50 border-amber-200 text-amber-800',       ring: 'ring-amber-300' },
  { key: '14to30', label: '14–30 days',   cls: 'bg-rose-50 border-rose-200 text-rose-800',          ring: 'ring-rose-300' },
  { key: '30plus', label: '30+ days',     cls: 'bg-red-50 border-red-200 text-red-800',             ring: 'ring-red-400' },
]

function ageDays(ln: LineRecord): number | null {
  return ln.indentAgeDays
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
  'Indent No', 'Indent Date', 'Days waiting', 'Project / Block',
  'Material', 'UOM', 'Indent Qty',
]
function csvRow(ln: LineRecord) {
  return [
    ln.indentNo, ln.indentDate, ageDays(ln) ?? '',
    ln.block, ln.material, ln.uom, ln.indentQty,
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

export function IndentsNeedingPoView({
  lines,
  projectName,
  newLineIds,
  changedLineIds,
  chaseNotes,
  onNoteSaved,
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
}) {
  const [groupBy, setGroupBy] = useState<GroupKey>('indent')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // Hide 90+ day no-PO items (almost always abandoned) from the default view.
  const [hideOld, setHideOld] = useState(true)
  const [inspectingLine, setInspectingLine] = useState<LineRecord | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleCollapsed = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Restore preference
  useEffect(() => {
    try {
      const v = localStorage.getItem(GROUP_KEY_STORAGE)
      if (v === 'indent' || v === 'block' || v === 'none') setGroupBy(v)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(GROUP_KEY_STORAGE, groupBy) } catch { /* ignore */ }
  }, [groupBy])

  // Only no-PO lines
  const needsPo = useMemo(() => {
    return lines.filter(ln => ln.status === 'no_po')
  }, [lines])

  // Search narrows the whole view. No-PO lines have no supplier yet, so we
  // match material / indent no / block — what you'd actually look up here.
  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return needsPo
    return needsPo.filter(ln =>
      (ln.material || '').toLowerCase().includes(q) ||
      (ln.indentNo || '').toLowerCase().includes(q) ||
      (ln.block || '').toLowerCase().includes(q),
    )
  }, [needsPo, searchQuery])

  // Each card is an exact age band, so the filter matches the label exactly.
  // In the default "All" view we hide 90+ day items (almost always abandoned)
  // unless the user turns that off; picking a specific band always shows it.
  const filtered = useMemo(() => {
    if (ageFilter !== 'all') {
      return searched.filter(ln => {
        const a = ageDays(ln) ?? 0
        if (ageFilter === 'lt7') return a < 7
        if (ageFilter === '7to14') return a >= 7 && a < 14
        if (ageFilter === '14to30') return a >= 14 && a < 30
        return a >= 30
      })
    }
    return hideOld ? searched.filter(ln => (ageDays(ln) ?? 0) < ABANDONED_DAYS) : searched
  }, [searched, ageFilter, hideOld])

  const groups = useMemo(() => {
    // Flat list — one group, no grouping, oldest waiting first.
    if (groupBy === 'none') {
      const all = [...filtered].sort((a, b) => (ageDays(b) ?? 0) - (ageDays(a) ?? 0))
      return [{ key: '__all__', label: `All ${all.length} line${all.length === 1 ? '' : 's'} waiting`, subLabel: '', lines: all }]
    }
    const map = new Map<string, { key: string; label: string; subLabel: string; lines: LineRecord[] }>()
    for (const ln of filtered) {
      const key = groupBy === 'indent' ? ln.indentNo : (ln.block || '— Unknown block —')
      const label = groupBy === 'indent'
        ? ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')
        : (ln.block || '— Unknown block —')
      const subLabel = groupBy === 'indent' ? `${ln.block} · ${ln.indentDate}` : ''
      let g = map.get(key)
      if (!g) { g = { key, label, subLabel, lines: [] }; map.set(key, g) }
      g.lines.push(ln)
    }
    for (const g of map.values()) {
      g.lines.sort((a, b) => (ageDays(b) ?? 0) - (ageDays(a) ?? 0))
    }
    // Sort groups by oldest waiting line desc (most urgent first)
    return Array.from(map.values()).sort((a, b) => {
      const ageA = Math.max(0, ...a.lines.map(l => ageDays(l) ?? 0))
      const ageB = Math.max(0, ...b.lines.map(l => ageDays(l) ?? 0))
      return ageB - ageA
    })
  }, [filtered, groupBy])

  const totalLines = filtered.length
  const uniqueIndents = new Set(filtered.map(l => l.indentNo)).size

  // Aging distribution — line count per exact band over the searched set.
  // Drives the clickable cards above the list.
  const buckets = useMemo(() => {
    const out = { all: 0, lt7: 0, '7to14': 0, '14to30': 0, '30plus': 0 }
    for (const ln of searched) {
      const a = ageDays(ln) ?? 0
      out.all++
      const b: 'lt7' | '7to14' | '14to30' | '30plus' = a < 7 ? 'lt7' : a < 14 ? '7to14' : a < 30 ? '14to30' : '30plus'
      out[b]++
    }
    return out
  }, [searched])

  const abandonedCount = useMemo(
    () => searched.filter(l => (ageDays(l) ?? 0) >= ABANDONED_DAYS).length,
    [searched],
  )
  // "Chase first" — oldest still-waiting indents across the current filter.
  const chaseFirst = useMemo(
    () => [...filtered].sort((a, b) => (ageDays(b) ?? 0) - (ageDays(a) ?? 0)).slice(0, 5),
    [filtered],
  )
  async function shareGroup(label: string, groupLines: LineRecord[]) {
    const res = await shareOrCopy(`Needs PO — ${label}`, buildNeedsPoShareText(label, groupLines))
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
  if (needsPo.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
        <p className="text-stone-700 font-medium">Every material has a PO.</p>
        <p className="text-stone-500 text-sm">Nothing waiting on your purchase team.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top stats + controls */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-stone-800">Indents needing PO</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              <b className="text-stone-800">{totalLines}</b> material line{totalLines === 1 ? '' : 's'} waiting on purchase team
              {' · '}across <b className="text-stone-800">{uniqueIndents}</b> indent{uniqueIndents === 1 ? '' : 's'}
              {ageFilter === 'all' && hideOld && abandonedCount > 0 && (
                <span className="text-stone-400"> · {abandonedCount} over 90 days hidden</span>
              )}
            </p>
          </div>
          <button
            onClick={() => downloadCsv(`${safe(projectName)}-needs-po-${new Date().toISOString().slice(0, 10)}.csv`, filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Download all ({filtered.length})
          </button>
        </div>

        {/* Aging overview — one card per exact band; click to filter */}
        {searched.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
              Aging by indent age — click to filter
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 lg:grid-cols-5">
              {AGING_CARDS.map(c => {
                const count = buckets[c.key]
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
                    title={`${count} line${count === 1 ? '' : 's'} waiting on a PO`}
                  >
                    <div className="text-[11px] font-semibold leading-tight">{c.label}</div>
                    <div className="text-lg font-bold leading-none mt-1 tabular-nums">{count}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">line{count === 1 ? '' : 's'}</div>
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
              onClick={() => setGroupBy('indent')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'indent' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <ClipboardList className="h-3 w-3 flex-shrink-0" /> <span className="sm:hidden">Indent</span><span className="hidden sm:inline">Group by indent</span>
            </button>
            <button
              onClick={() => setGroupBy('block')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'block' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <Layers className="h-3 w-3 flex-shrink-0" /> <span className="sm:hidden">Block</span><span className="hidden sm:inline">Group by block</span>
            </button>
            <button
              onClick={() => setGroupBy('none')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'none' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
              title="One flat list, oldest waiting first"
            >
              <ListOrdered className="h-3 w-3 flex-shrink-0" /> Flat
            </button>
          </div>

          {/* Search — match material / indent / block (no supplier yet) */}
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search material or indent…"
              className="pl-8 pr-7 h-8 w-full sm:w-52 rounded-lg border border-stone-200 bg-white text-xs text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

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

      {/* Active filters + the abandoned-items toggle */}
      {(ageFilter !== 'all' || searchQuery || (abandonedCount > 0 && ageFilter === 'all')) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(ageFilter !== 'all' || searchQuery) && <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Filters</span>}
          {ageFilter !== 'all' && (
            <button onClick={() => setAgeFilter('all')} className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-100 text-amber-800 rounded-full pl-2.5 pr-1.5 py-1">
              {AGING_CARDS.find(a => a.key === ageFilter)?.label}<X className="h-3 w-3" />
            </button>
          )}
          {searchQuery && (
            <span className="inline-flex items-center gap-1.5">
              <button onClick={() => setSearchQuery('')} className="inline-flex items-center gap-1 text-[11px] font-medium bg-stone-100 text-stone-700 rounded-full pl-2.5 pr-1.5 py-1">
                “{searchQuery}”<X className="h-3 w-3" />
              </button>
              <span className="text-[11px] text-stone-500 font-medium">{totalLines} match{totalLines === 1 ? '' : 'es'}</span>
            </span>
          )}
          {(ageFilter !== 'all' || searchQuery) && (
            <button onClick={() => { setAgeFilter('all'); setSearchQuery('') }} className="text-[11px] font-medium text-stone-500 hover:text-stone-800 underline ml-1">Clear all</button>
          )}
          {ageFilter === 'all' && abandonedCount > 0 && (
            <button
              onClick={() => setHideOld(v => !v)}
              className={cn('inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1 ml-auto',
                hideOld ? 'bg-stone-100 text-stone-600 hover:bg-stone-200' : 'bg-red-100 text-red-800')}
              title="Items with no PO for 90+ days are almost always abandoned"
            >
              {hideOld ? `Show ${abandonedCount} likely-abandoned (90+ days)` : `Hide ${abandonedCount} likely-abandoned`}
            </button>
          )}
        </div>
      )}

      {/* Chase first — the 5 oldest still waiting, across the current filter */}
      {chaseFirst.length >= 3 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-800 font-bold mb-1 inline-flex items-center gap-1"><Flame className="h-3 w-3" /> Chase first — oldest waiting</div>
          <div className="flex flex-col divide-y divide-amber-100/70">
            {chaseFirst.map(ln => (
              <button key={ln.id} type="button" onClick={() => setInspectingLine(ln)}
                className="flex items-center gap-2 text-left text-xs py-1.5 hover:bg-white/50 rounded px-1">
                <span className="font-mono text-[11px] text-stone-600 w-[92px] flex-shrink-0 truncate">{ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}</span>
                <span className="text-stone-700 truncate flex-1" title={ln.material}>{ln.material}</span>
                <span className={cn('text-[11px] tabular-nums flex-shrink-0 w-10 text-right', ageClass(ageDays(ln)))}>{ageDays(ln) ?? '—'}d</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
          <AlertTriangle className="h-7 w-7 text-emerald-500 mx-auto mb-2" />
          <p className="text-stone-700 font-medium">
            {searchQuery ? `No matches for “${searchQuery}”.` : 'All clear in this filter.'}
          </p>
          <p className="text-stone-500 text-sm">
            {searchQuery ? 'Try a different term, or clear the search.' : 'Nothing waiting in this band.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => {
            const oldestAge = g.lines.reduce<number | null>((mx, l) => {
              const a = ageDays(l)
              if (a == null) return mx
              return mx == null ? a : Math.max(mx, a)
            }, null)
            // While searching, force every group open so matches are visible.
            const isCollapsed = searchQuery ? false : collapsed.has(g.key)
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
                        <span className="font-semibold text-stone-800 truncate" title={g.label}>{g.label}</span>
                        <span className="text-[11px] text-stone-500">
                          {g.lines.length} line{g.lines.length === 1 ? '' : 's'} waiting
                          {g.subLabel ? ` · ${g.subLabel}` : ''}
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
                      className="inline-flex items-center justify-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-200 hover:border-emerald-300 h-8 w-8 sm:w-auto sm:px-2 rounded-md"
                      title={`Share ${g.label} list on WhatsApp / email`}
                    >
                      <Share2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Share</span>
                    </button>
                    <button
                      onClick={() => downloadCsv(`${safe(g.label)}-needs-po-${new Date().toISOString().slice(0, 10)}.csv`, g.lines)}
                      className="inline-flex items-center justify-center gap-1 text-[11px] font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 h-8 w-8 sm:w-auto sm:px-2 rounded-md"
                      title={`Download just ${g.label}`}
                    >
                      <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">CSV</span>
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
                        {groupBy !== 'indent' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Indent</th>}
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Material</th>
                        {groupBy !== 'block' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Block</th>}
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Qty needed</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Days waiting</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {g.lines.map(ln => {
                        const age = ageDays(ln)
                        const fmt = formatAgeFriendly(age)
                        return (
                          <tr key={ln.id} className="hover:bg-stone-50">
                            {groupBy !== 'indent' && (
                              <td className="px-4 py-2 font-mono text-[11px] text-stone-700 whitespace-nowrap" title={ln.indentNo}>
                                <Highlight text={ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')} query={searchQuery} />
                              </td>
                            )}
                            <td className="px-4 py-2 text-xs text-stone-800 max-w-[320px]">
                              <div className="flex items-start gap-1.5">
                                <ChangeBadge id={ln.id} newLineIds={newLineIds} changedLineIds={changedLineIds} />
                                <div className="flex-1 min-w-0">
                                  <span className="line-clamp-2" title={ln.material}><Highlight text={ln.material} query={searchQuery} /></span>
                                  <ChaseChip note={chaseNotes?.get(ln.indentNo)} className="mt-1" />
                                </div>
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
                            </td>
                            {groupBy !== 'block' && (
                              <td className="px-4 py-2 text-[11px] text-stone-500"><Highlight text={ln.block || '—'} query={searchQuery} /></td>
                            )}
                            <td className="px-4 py-2 text-right text-xs tabular-nums font-bold text-amber-700">
                              {ln.indentQty.toLocaleString('en-IN')} <span className="text-stone-400 text-[10px] font-normal">{ln.uom}</span>
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(age)}`}
                              title={ln.indentDate ? `Indent date: ${ln.indentDate}` : 'Indent date unknown'}
                            >
                              <div>{fmt.short}</div>
                              {fmt.long && (
                                <div className="text-[10px] font-normal text-stone-400 leading-tight">{fmt.long}</div>
                              )}
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
                    const age = ageDays(ln)
                    return (
                      <div key={ln.id} onClick={() => setInspectingLine(ln)}
                        className="p-3 cursor-pointer active:bg-stone-50">
                        <div className="flex items-start gap-2">
                          <ChangeBadge id={ln.id} newLineIds={newLineIds} changedLineIds={changedLineIds} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-stone-800 line-clamp-2" title={ln.material}><Highlight text={ln.material} query={searchQuery} /></p>
                            <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                              {groupBy === 'indent'
                                ? (ln.block || '—')
                                : ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                              {groupBy === 'none' && ln.block ? ` · ${ln.block}` : ''}
                            </p>
                            <ChaseChip note={chaseNotes?.get(ln.indentNo)} className="mt-1" />
                          </div>
                          <ChevronRight className="h-4 w-4 text-stone-300 flex-shrink-0 mt-0.5" />
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-x-3">
                          <CardField label="Qty needed" className="text-amber-700 font-bold">{ln.indentQty.toLocaleString('en-IN')} {ln.uom}</CardField>
                          <CardField label="Days waiting" className={ageClass(age)}>{formatAgeFriendly(age).short}</CardField>
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
      />
    </div>
  )
}
