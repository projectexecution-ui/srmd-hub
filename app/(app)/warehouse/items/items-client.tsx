'use client'

/** The Item Master, in the shape of the V1 catalogue screen Aksha asked for:
 *  a search, a row of category chips carrying live counts, then cards grouped
 *  under a collapsible category heading — monogram, code in mono, name, unit.
 *
 *  Two deliberate differences from V1, both because of scale. V1 held 514
 *  items and drew all of them; V2 holds 2,803. So the chips FILTER on the
 *  server rather than in the browser, and a category that overflows says so
 *  instead of quietly drawing half of itself. */

import { useState, useTransition, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { updateItem, setItemActive, mergeItems, itemFacts, findItems } from '../admin-actions'
import { mergePreview } from '@/lib/warehouse/corrections'
import type { ItemFacts } from '@/lib/warehouse/corrections'
import type { ItemRow } from '@/lib/warehouse/admin-data'
import { CatalogueButton } from './catalogue-button'
import {
  Loader2, Search, Merge, Archive, RotateCcw, Info, Pencil, X, Check,
  ChevronDown, ChevronRight,
} from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

/** A colour per category, so the same family looks the same every time it is
 *  seen. Hashed from the name rather than mapped, because the category list is
 *  editable and a hard-coded map would go stale the day somebody adds one. */
const TONES = [
  'bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800', 'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800', 'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800', 'bg-lime-100 text-lime-800',
] as const
function toneFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

/** Two characters standing in for a picture. V1 showed the item's photo where
 *  it had one; no warehouse item has one yet, so this is the monogram it fell
 *  back to — first letter of the first two words, or the first two letters. */
function monogram(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '??').slice(0, 2).toUpperCase()
}

export function ItemsClient({
  rows, shown, matching, grandTotal, categories, q, activeCategory,
  includeRetired, units, categoryNames, canAdmin,
}: {
  rows: ItemRow[]
  shown: number
  matching: number
  grandTotal: number
  categories: Array<{ category: string; n: number }>
  q: string
  activeCategory: string
  includeRetired: boolean
  units: string[]
  categoryNames: string[]
  canAdmin: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState(q)
  const [openId, setOpenId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function go(next: { q?: string; cat?: string; retired?: boolean }) {
    const p = new URLSearchParams()
    const nq = next.q !== undefined ? next.q : text
    const nc = next.cat !== undefined ? next.cat : activeCategory
    const nr = next.retired !== undefined ? next.retired : includeRetired
    if (nq.trim()) p.set('q', nq.trim())
    if (nc) p.set('cat', nc)
    if (nr) p.set('retired', '1')
    router.push(`/warehouse/items?${p.toString()}`)
  }

  // Search runs on the server — 2,803 items is far too many to ship to a phone
  // and filter there. Debounced so it is one query per pause, not per keystroke.
  useEffect(() => {
    if (text === q) return
    const t = setTimeout(() => {
      const p = new URLSearchParams()
      if (text.trim()) p.set('q', text.trim())
      if (activeCategory) p.set('cat', activeCategory)
      if (includeRetired) p.set('retired', '1')
      router.push(`/warehouse/items?${p.toString()}`)
    }, 350)
    return () => clearTimeout(t)
  }, [text, q, activeCategory, includeRetired, router])

  const grouped = useMemo(() => {
    const map = new Map<string, ItemRow[]>()
    for (const r of rows) {
      const k = r.category?.trim() || 'Not categorised'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return [...map.entries()]
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => b.items.length - a.items.length || a.category.localeCompare(b.category))
  }, [rows])

  const overflowing = matching > shown

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input className={`${inputCls} pl-8`} type="search" value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Search by code, name or category…" aria-label="Search items" />
          </div>
          <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 cursor-pointer whitespace-nowrap px-1">
            <input type="checkbox" checked={includeRetired} className="h-3.5 w-3.5"
              onChange={e => go({ retired: e.target.checked })} />
            Include retired
          </label>
          <CatalogueButton />
        </div>

        {/* Category chips. Horizontal scroll rather than wrapping — sixteen
            categories wrapped to four rows pushes the items off the screen. */}
        <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
          <div className="flex gap-1.5 min-w-min">
            <Chip label="All" count={grandTotal} active={!activeCategory}
              onClick={() => go({ cat: '' })} />
            {categories.map(c => (
              <Chip key={c.category} label={c.category} count={c.n}
                active={activeCategory === c.category}
                onClick={() => go({ cat: activeCategory === c.category ? '' : c.category })} />
            ))}
          </div>
        </div>
      </Card>

      {!canAdmin && (
        <Card className="p-3 shadow-sm text-[12.5px] text-amber-900 bg-amber-50 border-amber-200">
          You can see the master but not change it. An item’s name and unit are shared by every entry ever
          recorded against it, so editing is admin-only.
        </Card>
      )}

      {/* Never silently truncate: say what is being held back and how to see it. */}
      {overflowing && (
        <p className="text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-1.5">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Showing {shown} of {matching}. Pick a category chip or type a few letters to narrow it —
            drawing all {matching} cards at once would make this page crawl on a phone.
          </span>
        </p>
      )}

      {rows.length === 0 ? (
        <Card className="p-8 shadow-sm text-center text-[13px] text-slate-500">
          No item matches that.
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(g => {
            const isCollapsed = collapsed.has(g.category)
            return (
              <div key={g.category}>
                <button type="button" aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed(s => {
                    const n = new Set(s)
                    if (n.has(g.category)) n.delete(g.category); else n.add(g.category)
                    return n
                  })}
                  className="w-full flex items-center gap-1.5 px-1 py-1.5 min-h-[36px] text-[11px] font-extrabold
                             uppercase tracking-wider text-slate-500 hover:text-slate-800">
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {g.category}
                  <span className="text-slate-400 normal-case font-bold">· {g.items.length}</span>
                </button>

                {!isCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {g.items.map(it => openId === it.id ? (
                      <div key={it.id} className="md:col-span-2">
                        <ItemPanel item={it} units={units} categories={categoryNames}
                          canAdmin={canAdmin} onClose={() => setOpenId(null)} />
                      </div>
                    ) : (
                      <ItemCard key={it.id} item={it} canAdmin={canAdmin}
                        onEdit={() => setOpenId(it.id)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Chip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 h-9 rounded-full whitespace-nowrap ${
        active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
      {label}
      <span className={active ? 'text-emerald-100' : 'text-slate-400'}>{count}</span>
    </button>
  )
}

function ItemCard({ item, canAdmin, onEdit }: {
  item: ItemRow; canAdmin: boolean; onEdit: () => void
}) {
  const tone = toneFor(item.category ?? 'Not categorised')
  return (
    <div className={`flex items-center gap-3 p-2.5 border rounded-xl bg-white ${
      item.active ? 'border-slate-200' : 'border-slate-200 bg-slate-50/70'}`}>
      <div className={`h-12 w-12 flex-shrink-0 rounded-lg grid place-items-center
                       text-[13px] font-extrabold tracking-tight ${tone}`}>
        {monogram(item.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {item.code && (
            <span className="font-mono text-[10.5px] font-bold text-sky-700">{item.code}</span>
          )}
          <span className={`text-[13px] font-semibold truncate ${
            item.active ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
            {item.name}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">
          {item.unit}
          {item.lastRate != null ? ` · last ${formatINR(item.lastRate)}` : ''}
          {!item.active ? ' · retired' : ''}
        </p>
      </div>

      {item.stockQty > 0 && (
        <span className="text-[11.5px] font-bold text-emerald-700 tabular-nums whitespace-nowrap">
          {formatQty(item.stockQty)}
        </span>
      )}

      <button type="button" onClick={onEdit} aria-label={`Edit ${item.name}`}
        className="flex-shrink-0 rounded-lg border-2 border-slate-200 px-2 py-1.5 min-h-[36px] min-w-[36px]
                   grid place-items-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {!canAdmin && <span className="sr-only">read only</span>}
    </div>
  )
}

function ItemPanel({
  item, units, categories, canAdmin, onClose,
}: {
  item: ItemRow
  units: string[]
  categories: string[]
  canAdmin: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [facts, setFacts] = useState<ItemFacts | null>(null)
  const [name, setName] = useState(item.name)
  const [unit, setUnit] = useState(item.unit)
  const [category, setCategory] = useState(item.category ?? '')
  const [merging, setMerging] = useState(false)

  // What may be changed depends on what has already been recorded, and that is
  // read fresh — the list behind this panel may have been on screen for hours.
  useEffect(() => {
    let live = true
    itemFacts(item.id).then(f => { if (live) setFacts(f) })
    return () => { live = false }
  }, [item.id])

  const unitLocked = !!facts && facts.movements > 0

  return (
    <div className="p-3 border-2 border-emerald-200 bg-emerald-50/30 rounded-xl space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">
          {item.code ? <span className="font-mono">{item.code}</span> : 'Editing'}
        </p>
        <button type="button" onClick={onClose} aria-label="Close"
          className="rounded-lg px-1.5 py-1 text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-2">
        <div className="sm:col-span-3">
          <label className={labelCls} htmlFor={`n-${item.id}`}>Name</label>
          <input id={`n-${item.id}`} className={inputCls} value={name} disabled={!canAdmin}
            onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor={`u-${item.id}`}>Unit</label>
          <select id={`u-${item.id}`} className={inputCls} value={unit} disabled={!canAdmin || unitLocked}
            onChange={e => setUnit(e.target.value)}>
            {[unit, ...units.filter(u => u !== unit)].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor={`c-${item.id}`}>Category</label>
          <input id={`c-${item.id}`} className={inputCls} value={category} disabled={!canAdmin}
            list={`cats-${item.id}`} onChange={e => setCategory(e.target.value)}
            placeholder="Not categorised" />
          <datalist id={`cats-${item.id}`}>
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>

      {/* Never a silently greyed control: the unit picker is locked, and the
          reason it is locked is on the screen next to it. */}
      {unitLocked && (
        <p className="text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5
                      flex gap-1.5 items-start">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            The unit is locked: {facts!.movements} {facts!.movements === 1 ? 'movement has' : 'movements have'} already
            been recorded in {item.unit}. Changing it would reinterpret every one of them without moving a number.
            If the unit is wrong, make a new item with the right one and merge this into it.
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!canAdmin || busy}
          className="rounded-lg bg-emerald-600 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white
                     hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          onClick={() => start(async () => {
            const res = await updateItem(item.id, { name, unit, category: category || null, subcategory: null })
            if (!res.ok) { toast.error(res.error ?? 'Could not save that.', { duration: 9000 }); return }
            toast.success('Saved')
            onClose()
            router.refresh()
          })}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>

        <button type="button" disabled={!canAdmin || busy}
          className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 min-h-[40px] text-[12.5px] font-bold
                     text-slate-600 hover:border-slate-300 disabled:opacity-50 inline-flex items-center gap-1.5"
          onClick={() => start(async () => {
            const res = await setItemActive(item.id, !item.active)
            if (!res.ok) { toast.error(res.error ?? 'Could not do that.', { duration: 10000 }); return }
            toast.success(item.active ? `${item.name} retired` : `${item.name} is back`)
            router.refresh()
          })}>
          {item.active ? <><Archive className="h-3.5 w-3.5" /> Retire</> : <><RotateCcw className="h-3.5 w-3.5" /> Bring back</>}
        </button>

        {item.active && (
          <button type="button" disabled={!canAdmin || busy} onClick={() => setMerging(v => !v)}
            className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 min-h-[40px] text-[12.5px] font-bold
                       text-slate-600 hover:border-slate-300 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Merge className="h-3.5 w-3.5" /> Merge into another
          </button>
        )}

        {facts && (
          <span className="text-[11px] text-slate-500">
            {facts.movements} {facts.movements === 1 ? 'movement' : 'movements'}
            {facts.stockLines > 0 ? ` · ${formatQty(facts.stockQty)} ${facts.unit} in ${facts.stockLines} ${facts.stockLines === 1 ? 'store' : 'stores'}` : ''}
            {facts.openPoLines > 0 ? ` · ${facts.openPoLines} open PO ${facts.openPoLines === 1 ? 'line' : 'lines'}` : ''}
            {item.source === 'in4' ? ` · from IN4${item.discipline ? ` (${item.discipline})` : ''}` : ''}
          </span>
        )}
      </div>

      {merging && facts && <MergePanel from={facts} onDone={() => { setMerging(false); onClose() }} />}
    </div>
  )
}

/** Fold this item into another. The preview is spelt out before it runs
 *  because the two histories become one and there is no button that unpicks
 *  them afterwards. */
function MergePanel({ from, onDone }: { from: ItemFacts; onDone: () => void }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ItemRow[]>([])
  const [target, setTarget] = useState<ItemFacts | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { if (live) setHits([]); return }
      const rows = await findItems(q.trim())
      if (live) setHits(rows.filter(r => r.id !== from.itemId).slice(0, 8))
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [q, from.itemId])

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <p className="text-[12.5px] font-bold text-slate-800">
        Keep which item? Everything on <span className="text-rose-700">{from.name}</span> moves onto the one you pick.
      </p>
      <input className={inputCls} value={q} onChange={e => setQ(e.target.value)} autoFocus
        placeholder="Search for the item to keep" aria-label="Search for the item to keep" />

      {hits.map(h => (
        <button key={h.id} type="button" disabled={busy}
          className={`w-full text-left rounded-lg border-2 px-2.5 py-2 min-h-[44px] ${
            target?.itemId === h.id ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
          onClick={() => start(async () => { setTarget(await itemFacts(h.id)) })}>
          <span className="block text-[12.5px] font-semibold text-slate-800">{h.name}</span>
          <span className="block text-[11px] text-slate-500">
            {h.unit}{h.category ? ` · ${h.category}` : ''}{h.stockQty ? ` · ${formatQty(h.stockQty)} in stock` : ''}
          </span>
        </button>
      ))}

      {target && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 space-y-1">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700">What will happen</p>
          {mergePreview({ from, into: target }).map(l => (
            <p key={l} className="text-[12px] text-amber-900 leading-snug">• {l}</p>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" disabled={!target || busy}
          className="rounded-lg bg-rose-600 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white
                     hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          onClick={() => start(async () => {
            if (!target) return
            const ok = await confirm({
              title: `Merge ${from.name} into ${target.name}?`,
              message: 'The two histories become one. This cannot be undone from the screen.',
              confirmLabel: 'Merge them',
            })
            if (!ok) return
            const res = await mergeItems(from.itemId, target.itemId)
            if (!res.ok) { toast.error(res.error ?? 'Could not merge them.', { duration: 10000 }); return }
            toast.success(`${from.name} folded into ${target.name}`)
            onDone()
            router.refresh()
          })}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Merge them
        </button>
        <button type="button" onClick={onDone} disabled={busy}
          className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-500">
          Cancel
        </button>
      </div>
    </div>
  )
}
