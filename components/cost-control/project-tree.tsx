'use client'

// Collapsible category tree for the Internal Estimate project table.
// The server renders the whole table; these client bits only decide which
// category groups are open. Collapsed categories still show their cumulative
// totals (those cells live on the always-visible category header row), so
// collapsing gives management the roll-up view they asked for.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, ChevronDown, ListTree, Eye, EyeOff } from 'lucide-react'

interface TreeCtx {
  isCollapsed: (id: string) => boolean
  toggle: (id: string) => void
  expandAll: () => void
  collapseAll: () => void
  allCollapsed: boolean
  hideEmpty: boolean
  toggleHideEmpty: () => void
  emptyCount: number
}
const Ctx = createContext<TreeCtx | null>(null)

export function TreeProvider({ allCatIds, emptyCount = 0, initialCollapsedIds, initialHideEmpty = true, children }: {
  allCatIds: string[]
  emptyCount?: number
  /** Categories collapsed on first render. Pass allCatIds to open rolled-up
   *  (management declutter), or all-but-one to focus a single category
   *  (deep-link from an approval). Omit for the legacy all-expanded default. */
  initialCollapsedIds?: string[]
  /** Start with empty sub-skills shown (e.g. a deep-link that must reveal a
   *  specific, possibly-empty sub-skill). Defaults to hidden. */
  initialHideEmpty?: boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(initialCollapsedIds ?? []))
  // Empty sub-skills (no estimate, no WS, no budget) are hidden by DEFAULT so
  // the table reads as "what's actually in play" — one click shows everything
  // (needed to raise the first sheet for an untouched sub-skill).
  const [hideEmpty, setHideEmpty] = useState(initialHideEmpty)
  const api = useMemo<TreeCtx>(() => ({
    isCollapsed: (id) => collapsed.has(id),
    toggle: (id) => setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    }),
    expandAll: () => setCollapsed(new Set()),
    collapseAll: () => setCollapsed(new Set(allCatIds)),
    allCollapsed: allCatIds.length > 0 && allCatIds.every(id => collapsed.has(id)),
    hideEmpty,
    toggleHideEmpty: () => setHideEmpty(v => !v),
    emptyCount,
  }), [collapsed, allCatIds, hideEmpty, emptyCount])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

function useTree(): TreeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('Tree components must be inside <TreeProvider>')
  return v
}

/** Chevron button placed at the front of a category header row. */
export function CatChevron({ catId }: { catId: string }) {
  const { isCollapsed, toggle } = useTree()
  const collapsed = isCollapsed(catId)
  return (
    <button
      type="button"
      onClick={() => toggle(catId)}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand' : 'Collapse'}
      className="inline-flex items-center justify-center h-5 w-5 rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 align-middle mr-1 -ml-1"
    >
      {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </button>
  )
}

/** Wraps a category's detail rows; renders them only when the category is open. */
export function CatRows({ catId, children }: { catId: string; children: ReactNode }) {
  const { isCollapsed } = useTree()
  return isCollapsed(catId) ? null : <>{children}</>
}

/** Wraps ONE sub-skill row. When "hide empty" is on, an empty sub-skill
 *  (no estimate, no working sheet, no budget) is dropped from the table. */
export function SubRow({ empty, children }: { empty: boolean; children: ReactNode }) {
  const { hideEmpty } = useTree()
  return hideEmpty && empty ? null : <>{children}</>
}

/** Expand-all / Collapse-all + Hide-empty controls. */
export function TreeToolbar() {
  const { expandAll, collapseAll, allCollapsed, hideEmpty, toggleHideEmpty, emptyCount } = useTree()
  return (
    <div className="inline-flex items-center gap-1 text-[11px]">
      {emptyCount > 0 && (
        <button
          type="button"
          onClick={toggleHideEmpty}
          title={hideEmpty
            ? `${emptyCount} empty sub-skill${emptyCount === 1 ? '' : 's'} hidden — click to show every sub-skill (needed to raise the first sheet for one)`
            : `Hide the ${emptyCount} empty sub-skill${emptyCount === 1 ? '' : 's'} (no estimate, no sheet yet)`}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium mr-1 ${hideEmpty ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          {hideEmpty ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {hideEmpty ? `${emptyCount} empty hidden` : 'Showing all'}
        </button>
      )}
      <ListTree className="h-3.5 w-3.5 text-gray-400" />
      <button
        type="button"
        onClick={expandAll}
        className="px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium"
      >
        Expand all
      </button>
      <button
        type="button"
        onClick={collapseAll}
        className={`px-2 py-0.5 rounded border font-medium ${allCollapsed ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
      >
        Collapse all
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Row detail — a THIRD level under a sub-skill: the Verified BOQ rows of
// its budgets. Deliberately its own context rather than reusing the
// category one, so "Expand all" opens the categories a reader asked for
// without also unfurling every line item on the project.
// ──────────────────────────────────────────────────────────────────────
const DetailCtx = createContext<{ isOpen: (id: string) => boolean; toggle: (id: string) => void } | null>(null)

export function RowDetailProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const api = useMemo(() => ({
    isOpen: (id: string) => open.has(id),
    toggle: (id: string) => setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    }),
  }), [open])
  return <DetailCtx.Provider value={api}>{children}</DetailCtx.Provider>
}

function useDetail() {
  const v = useContext(DetailCtx)
  if (!v) throw new Error('Row detail components must be inside <RowDetailProvider>')
  return v
}

/** The "show the items" control on a sub-skill row. Renders nothing when the
 *  sub-skill has no budget rows to show — an affordance that opens an empty
 *  drawer is worse than no affordance. */
export function RowDetailToggle({ id, count }: { id: string; count: number }) {
  const { isOpen, toggle } = useDetail()
  if (count <= 0) return null
  const open = isOpen(id)
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-expanded={open}
      title={open
        ? 'Hide the item-wise BOQ'
        : `Show the item-wise BOQ — ${count} item${count === 1 ? '' : 's'} (unit, qty, rate, amount)`}
      // Same chevron as the category rows above it (CatChevron) — one tree,
      // one affordance. It used to be a bordered "> 1 item" pill, which read
      // as a badge sitting next to the name rather than a level of the tree.
      // The count lives in the tooltip; the chevron only appears when there
      // is something to open, so its presence already says so.
      className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-800 align-middle"
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  )
}

/** Wraps the detail block; renders only while its row is open. */
export function RowDetail({ id, children }: { id: string; children: ReactNode }) {
  const { isOpen } = useDetail()
  return isOpen(id) ? <>{children}</> : null
}
