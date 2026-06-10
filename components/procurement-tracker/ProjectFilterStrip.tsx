'use client'

// Smarter project filter for the Indent → PO Tracker.
//
// The old version was a flat wrap of chips — every project, sorted by
// pending count, including the dozen that are fully cleared (0 pending).
// That buried the 2-3 projects Aksha actually needs to chase under a wall
// of zero-badges.
//
// This version:
//   • A one-line insight ribbon — "N need attention · M cleared · ₹X pending".
//   • A type-to-filter search box (shown once there are many projects).
//   • Splits ACTIVE projects (pending receipts or items still needing a PO)
//     from CLEARED ones (nothing outstanding). Cleared projects collapse
//     behind a toggle so they stop competing for attention.
//   • Richer chips: pending-receipts badge (amber) PLUS a needs-PO badge
//     (red) when relevant, and the pending ₹ value on the selected chip.

import { useMemo, useState } from 'react'
import type { ProjectSummary } from '@/lib/procurement'
import { Search, PackageX, ClipboardList, CheckCircle2, ChevronDown, X } from 'lucide-react'

// Compact ₹ formatter — lakh/crore so big numbers stay one glance wide.
function inrCompact(n: number): string {
  if (!n || n <= 0) return '₹0'
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

interface ProjChip {
  name: string
  pending: number       // line records still awaiting receipt
  needsPo: number       // line records with no PO yet
  pendingValue: number  // ₹ still pending receipt
  active: boolean
}

export function ProjectFilterStrip({
  projects,
  selectedProject,
  onSelect,
  format,
  hiddenInUploadCount,
}: {
  projects: ProjectSummary[]
  selectedProject: string
  onSelect: (name: string) => void
  format: 'flat' | 'banded'
  hiddenInUploadCount: number
}) {
  const [query, setQuery] = useState('')
  const [showCleared, setShowCleared] = useState(false)

  // Derive a richer per-project record once.
  const chips = useMemo<ProjChip[]>(() => {
    return projects.map(p => {
      const needsPo = p.lines.filter(l => l.status === 'no_po').length
      const pending = p.pendingLineCount
      return {
        name: p.projectName,
        pending,
        needsPo,
        pendingValue: p.pendingValue,
        active: pending > 0 || needsPo > 0,
      }
    })
  }, [projects])

  const totals = useMemo(() => {
    const activeCount = chips.filter(c => c.active).length
    const clearedCount = chips.length - activeCount
    const totalPending = chips.reduce((s, c) => s + c.pending, 0)
    const totalNeedsPo = chips.reduce((s, c) => s + c.needsPo, 0)
    const totalPendingValue = chips.reduce((s, c) => s + c.pendingValue, 0)
    return { activeCount, clearedCount, totalPending, totalNeedsPo, totalPendingValue }
  }, [chips])

  // Search filter (case-insensitive substring on project name).
  const q = query.trim().toLowerCase()
  const matches = (c: ProjChip) => !q || c.name.toLowerCase().includes(q)

  // Sort: most pending first, then most needing-PO, then alphabetical.
  const sortFn = (a: ProjChip, b: ProjChip) =>
    b.pending - a.pending || b.needsPo - a.needsPo || a.name.localeCompare(b.name)

  const active = chips.filter(c => c.active && matches(c)).sort(sortFn)
  const cleared = chips.filter(c => !c.active && matches(c)).sort((a, b) => a.name.localeCompare(b.name))

  // When the user is searching, reveal cleared matches automatically.
  const clearedVisible = showCleared || q.length > 0
  const showSearch = projects.length > 8

  return (
    <div className="bg-white rounded-xl border border-orange-200 p-3 space-y-2.5">
      {/* Header + insight ribbon */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">
            Filter by project
          </span>
          <span className="hidden sm:inline text-stone-300">·</span>
          <div className="flex items-center gap-2.5 text-[11px] flex-wrap">
            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
              <PackageX className="h-3 w-3" />
              {totals.activeCount} need{totals.activeCount === 1 ? 's' : ''} attention
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
              <CheckCircle2 className="h-3 w-3" />
              {totals.clearedCount} cleared
            </span>
            {totals.totalPendingValue > 0 && (
              <span className="inline-flex items-center gap-1 text-stone-500">
                <span className="text-stone-300">·</span>
                <span className="font-semibold text-stone-700">{inrCompact(totals.totalPendingValue)}</span>
                pending
              </span>
            )}
          </div>
        </div>
        <span className="text-[11px] text-stone-400">
          {format === 'flat' ? 'Per-project PO report' : 'Company-wide indent report'}
          {hiddenInUploadCount > 0 && (
            <span className="italic"> · {hiddenInUploadCount} hidden by admin</span>
          )}
        </span>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${projects.length} projects…`}
            className="w-full h-8 pl-8 pr-8 rounded-lg border border-orange-200 bg-orange-50/40 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-orange-400 focus:bg-white transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5">
        {/* "All projects" anchor — always first, ignores search */}
        <AllChip
          pending={totals.totalPending}
          needsPo={totals.totalNeedsPo}
          selected={selectedProject === '__all__'}
          onClick={() => onSelect('__all__')}
        />

        {active.map(c => (
          <Chip
            key={c.name}
            chip={c}
            selected={selectedProject === c.name}
            onClick={() => onSelect(c.name)}
          />
        ))}

        {/* When searching, cleared matches appear inline right after active */}
        {clearedVisible && cleared.map(c => (
          <Chip
            key={c.name}
            chip={c}
            selected={selectedProject === c.name}
            onClick={() => onSelect(c.name)}
          />
        ))}
      </div>

      {/* No matches at all for the search */}
      {q && active.length === 0 && cleared.length === 0 && (
        <p className="text-xs text-stone-400 italic px-1">No projects match “{query}”.</p>
      )}

      {/* Cleared toggle — only when not searching and there are cleared projects */}
      {!q && totals.clearedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowCleared(s => !s)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-orange-700 transition-colors"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCleared ? 'rotate-180' : ''}`} />
          {showCleared
            ? `Hide ${totals.clearedCount} cleared project${totals.clearedCount === 1 ? '' : 's'}`
            : `Show ${totals.clearedCount} cleared project${totals.clearedCount === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}

// ─── "All projects" chip ──────────────────────────────────────────────
function AllChip({
  pending, needsPo, selected, onClick,
}: { pending: number; needsPo: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 ${
        selected
          ? 'bg-gradient-to-br from-orange-700 to-red-900 text-white shadow-sm ring-2 ring-red-200'
          : 'bg-stone-800 text-white hover:bg-stone-900'
      }`}
    >
      <span>All projects</span>
      <span className="inline-flex items-center gap-1">
        {pending > 0 && (
          <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none bg-amber-400/90 text-amber-950">
            {pending}
          </span>
        )}
        {needsPo > 0 && (
          <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none bg-red-400/90 text-red-950">
            {needsPo} PO
          </span>
        )}
        {pending === 0 && needsPo === 0 && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
        )}
      </span>
    </button>
  )
}

// ─── Per-project chip ─────────────────────────────────────────────────
function Chip({
  chip, selected, onClick,
}: { chip: ProjChip; selected: boolean; onClick: () => void }) {
  const { name, pending, needsPo, pendingValue, active } = chip
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        active
          ? `${name}\n${pending} pending receipt${pending === 1 ? '' : 's'}` +
            (needsPo > 0 ? ` · ${needsPo} still need a PO` : '') +
            (pendingValue > 0 ? ` · ${inrCompact(pendingValue)} pending value` : '')
          : `${name} — fully cleared`
      }
      className={`group text-xs font-medium px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 max-w-full ${
        selected
          ? 'bg-red-900 text-white shadow-sm ring-2 ring-red-200'
          : active
            ? 'bg-white border border-orange-200 text-stone-700 hover:bg-orange-50 hover:border-orange-400'
            : 'bg-stone-50 border border-stone-200 text-stone-400 hover:bg-stone-100 hover:text-stone-600'
      }`}
    >
      {/* status dot for active projects */}
      {active && !selected && (
        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${needsPo > 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
      )}
      <span className="truncate max-w-[160px]">{name}</span>

      {/* selected chip shows the ₹ value inline for quick context */}
      {selected && pendingValue > 0 && (
        <span className="text-[10px] font-normal text-red-200">{inrCompact(pendingValue)}</span>
      )}

      <span className="inline-flex items-center gap-1 flex-shrink-0">
        {pending > 0 && (
          <span
            className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none inline-flex items-center gap-0.5 ${
              selected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
            }`}
          >
            <PackageX className="h-2.5 w-2.5" />
            {pending}
          </span>
        )}
        {needsPo > 0 && (
          <span
            className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none inline-flex items-center gap-0.5 ${
              selected ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'
            }`}
          >
            <ClipboardList className="h-2.5 w-2.5" />
            {needsPo}
          </span>
        )}
        {!active && (
          <CheckCircle2 className={`h-3.5 w-3.5 ${selected ? 'text-white' : 'text-emerald-500'}`} />
        )}
      </span>
    </button>
  )
}
