'use client'

// The phone controls of the Internal Estimate page: Cards / Table, the jump
// chips, and the ⋯ menu that holds the list toolbar. The rules they apply are
// in lib/cost-control/phone-view.ts; this file is only the state and the
// markup. Everything here is `lg:hidden` — from 1,024 px the table is back
// and the desktop toolbar takes over.

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { LayoutList, Table2, MoreHorizontal, Eye, EyeOff, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useTree } from './project-tree'
import {
  type ViewMode, type JumpFilter, type CardFlags, type JumpCounts,
  parseViewMode, VIEW_MODE_KEY, cardMatches, jumpChips,
} from '@/lib/cost-control/phone-view'

interface PhoneCtx {
  mode: ViewMode
  setMode: (m: ViewMode) => void
  filter: JumpFilter
  setFilter: (f: JumpFilter) => void
}
const Ctx = createContext<PhoneCtx | null>(null)

function usePhone(): PhoneCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('Phone view components must be inside <PhoneViewProvider>')
  return v
}

// The Cards | Table choice lives in localStorage and is read through
// useSyncExternalStore: the server snapshot is always "cards", so the first
// client render agrees with the server (no hydration mismatch), and the
// stored choice applies on the very next render without a setState-in-effect.
const listeners = new Set<() => void>()
function subscribeMode(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
function readMode(): ViewMode {
  try { return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY)) } catch { return 'cards' }
}
function writeMode(m: ViewMode) {
  try { window.localStorage.setItem(VIEW_MODE_KEY, m) } catch { /* storage blocked — the choice lasts for this page only */ }
  listeners.forEach(l => l())
}

export function PhoneViewProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'cards' as ViewMode)
  const [filter, setFilter] = useState<JumpFilter>('all')
  const api = useMemo<PhoneCtx>(() => ({ mode, setMode: writeMode, filter, setFilter }), [mode, filter])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/** The desktop table's box. Shown from lg; on a phone only when Table is chosen. */
export function TableBox({ children }: { children: ReactNode }) {
  const { mode } = usePhone()
  return (
    <div className={`overflow-auto max-h-[75vh] ${mode === 'table' ? 'block' : 'hidden lg:block'}`}>
      {children}
    </div>
  )
}

/** The card stack. No inner scrollport (M3): the page scrolls and each
 *  category bar sticks under the phone's app bar. */
export function CardBox({ children }: { children: ReactNode }) {
  const { mode } = usePhone()
  return (
    <div className={`divide-y divide-gray-100 ${mode === 'table' ? 'hidden' : 'lg:hidden'}`}>
      {children}
    </div>
  )
}

/** Cards | Table. Remembered per phone. */
export function PhoneViewToggle() {
  const { mode, setMode } = usePhone()
  const seg = (m: ViewMode, label: string, Icon: typeof LayoutList) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`inline-flex items-center gap-1 h-9 px-2.5 text-[12px] font-semibold ${
        mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )
  return (
    <span className="lg:hidden inline-flex overflow-hidden rounded-md border border-gray-300" role="group" aria-label="Cards or table">
      {seg('cards', 'Cards', LayoutList)}
      {seg('table', 'Table', Table2)}
    </span>
  )
}

/** All · Awaiting n · Over budget n · Closed n. Picking one opens every
 *  category so the matching lines are on screen; All folds them back to the
 *  rolled-up default. Hidden in Table mode — the table has its own columns. */
export function JumpChips({ counts }: { counts: JumpCounts }) {
  const { mode, filter, setFilter } = usePhone()
  const tree = useTree()
  const chips = jumpChips(counts)
  if (mode === 'table' || chips.length <= 1) return null
  const tone: Record<JumpFilter, string> = {
    all: 'border-gray-300 text-gray-700',
    awaiting: 'border-amber-300 text-amber-800 bg-amber-50',
    over: 'border-rose-300 text-rose-800 bg-rose-50',
    closed: 'border-gray-300 text-gray-600 bg-gray-50',
  }
  const on: Record<JumpFilter, string> = {
    all: 'bg-gray-800 border-gray-800 text-white',
    awaiting: 'bg-amber-600 border-amber-600 text-white',
    over: 'bg-rose-600 border-rose-600 text-white',
    closed: 'bg-gray-600 border-gray-600 text-white',
  }
  return (
    <div className="lg:hidden flex gap-1.5 overflow-x-auto px-3 py-2 border-b border-gray-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Show only">
      {chips.map(c => (
        <button
          key={c.key}
          type="button"
          aria-pressed={filter === c.key}
          onClick={() => {
            setFilter(c.key)
            if (c.key === 'all') tree.collapseAll(); else tree.expandAll()
          }}
          className={`inline-flex items-center gap-1 h-9 px-3 rounded-full border text-[12px] font-semibold whitespace-nowrap ${filter === c.key ? on[c.key] : tone[c.key]}`}
        >
          {c.label} <span className="tabular-nums font-bold">{c.count}</span>
        </button>
      ))}
    </div>
  )
}

/** The list toolbar behind one ⋯ (M10). Show empty · Expand all · Collapse
 *  all, plus whatever the page hands in (Move budget). 44 px rows. */
export function PhoneMoreMenu({ children }: { children?: ReactNode }) {
  const tree = useTree()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  const item = 'flex w-full items-center gap-2.5 min-h-[44px] px-3.5 text-left text-[13px] text-gray-800 hover:bg-gray-50'
  return (
    <div ref={ref} className="lg:hidden relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-gray-300 bg-white text-gray-700"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-64 rounded-lg border border-gray-200 bg-white shadow-lg divide-y divide-gray-100 overflow-hidden">
          {tree.emptyCount > 0 && (
            <button type="button" role="menuitem" className={item} onClick={() => { tree.toggleHideEmpty(); setOpen(false) }}>
              {tree.hideEmpty ? <Eye className="h-4 w-4 text-gray-500" /> : <EyeOff className="h-4 w-4 text-gray-500" />}
              {tree.hideEmpty
                ? `Show ${tree.emptyCount} empty sub-categor${tree.emptyCount === 1 ? 'y' : 'ies'}`
                : `Hide ${tree.emptyCount} empty sub-categor${tree.emptyCount === 1 ? 'y' : 'ies'}`}
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={() => { tree.expandAll(); setOpen(false) }}>
            <ChevronsUpDown className="h-4 w-4 text-gray-500" /> Expand all
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { tree.collapseAll(); setOpen(false) }}>
            <ChevronsDownUp className="h-4 w-4 text-gray-500" /> Collapse all
          </button>
          {children}
        </div>
      )}
    </div>
  )
}

/** A category on the phone. Gone while a jump chip is on and nothing under
 *  it matches, so the filter shows only the categories that have something. */
export function PhoneCat({ flags, children }: { flags: CardFlags; children: ReactNode }) {
  const { filter } = usePhone()
  return cardMatches(filter, flags) ? <>{children}</> : null
}

/** One sub-category card on the phone, subject to the jump chip. */
export function PhoneCard({ flags, children }: { flags: CardFlags; children: ReactNode }) {
  const { filter } = usePhone()
  return cardMatches(filter, flags) ? <>{children}</> : null
}
