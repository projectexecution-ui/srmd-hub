'use client'
import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { LineRecord, LineStatus } from '@/lib/procurement'
import { shortIndent } from '@/lib/procurement/shared'

// One search box that finds an item ANYWHERE — every project, every status —
// regardless of which view/project filter is active. Matches on material,
// indent no, supplier, PO no, project and block. Clicking a result jumps to
// that item's project + the right view so it's easy to act on.

const STATUS_META: Record<LineStatus, { label: string; cls: string }> = {
  no_po:    { label: 'No PO',        cls: 'bg-red-100 text-red-800' },
  pending:  { label: 'Awaiting GRN', cls: 'bg-amber-100 text-amber-800' },
  partial:  { label: 'Part received', cls: 'bg-amber-100 text-amber-800' },
  received: { label: 'Received',     cls: 'bg-emerald-100 text-emerald-800' },
}

export function UniversalSearch({
  lines,
  onPick,
}: {
  lines: LineRecord[]
  onPick: (line: LineRecord) => void
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const results = useMemo(() => {
    if (query.length < 2) return []
    const terms = query.split(/\s+/).filter(Boolean)
    const haystack = (l: LineRecord) =>
      [
        l.material, l.indentNo, l.supplier, l.block, l.project, l.discipline,
        ...(l.pos?.map(p => p.poNo) ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
    const matched = lines.filter(l => {
      const h = haystack(l)
      return terms.every(t => h.includes(t))
    })
    // Oldest first — the chase-worthy items surface at the top.
    return matched.sort((a, b) => (b.indentAgeDays ?? 0) - (a.indentAgeDays ?? 0))
  }, [lines, query])

  const shown = results.slice(0, 60)

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search any item — material, indent no, supplier, PO no (all projects)…"
          className="w-full rounded-xl border border-orange-200 bg-white pl-9 pr-9 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query.length >= 2 && (
        <div className="mt-2 rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-stone-500 bg-stone-50 border-b border-stone-100">
            {results.length === 0
              ? 'No items match'
              : `${results.length} item${results.length === 1 ? '' : 's'} found${results.length > 60 ? ' · showing first 60' : ''} — tap one to jump to it`}
          </div>
          {shown.length > 0 && (
            <ul className="max-h-[26rem] overflow-y-auto divide-y divide-stone-100">
              {shown.map(l => {
                const meta = STATUS_META[l.status] ?? { label: l.status, cls: 'bg-stone-100 text-stone-700' }
                const age = l.indentAgeDays
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => { onPick(l); setQ('') }}
                      className="w-full text-left px-3 py-2.5 hover:bg-orange-50/70 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-stone-900 text-sm min-w-0 truncate">{l.material || '—'}</span>
                        <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      </div>
                      <div className="text-[11px] text-stone-500 mt-0.5 truncate">
                        <span className="font-mono">{shortIndent(l.indentNo)}</span> · {l.project}{l.block ? ` · ${l.block}` : ''}
                      </div>
                      <div className="text-[11px] text-stone-400 truncate">
                        {l.supplier || 'No supplier yet'}
                        {l.pendingQty > 0 ? ` · ${l.pendingQty} ${l.uom || ''} pending` : ''}
                        {age != null ? ` · ${age}d old` : ''}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
