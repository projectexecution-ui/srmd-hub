'use client'
// Searchable item picker.
//
//   <ItemPicker items={items} value={itemId} onChange={setItemId}
//     stockByItem={{itemId: availableQty}}   // optional: makes it stock-aware
//     storeLabel="Dharampur Main Store"
//     allowRequestNew onProposeItem={fn} />  // optional: "request a new item"
//
// When stockByItem is supplied it defaults to showing only what's ON HAND at
// the selected store (with the live qty on each card), so an engineer can't
// blindly request something the store doesn't carry — "Show all catalogue" is a
// deliberate extra tap. No-image items render a clean category monogram, not a
// broken-image icon.

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Search, X, ChevronDown, Check, PackagePlus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PickerItem {
  id: string
  code: string
  name: string
  unit: string
  category: string | null
  image_url: string | null
}

interface Props {
  items: PickerItem[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  /** item_id → available qty at the currently-selected store. Enables stock mode. */
  stockByItem?: Record<string, number>
  storeLabel?: string
  /** Show a "request a new item" affordance that calls onProposeItem. */
  allowRequestNew?: boolean
  onProposeItem?: (p: { name: string; unit: string; category: string }) => Promise<{ ok: boolean; error?: string }>
}

// Deterministic soft colour per category so no-image cards look intentional.
const MONO = [
  'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
  'bg-lime-100 text-lime-700', 'bg-orange-100 text-orange-700', 'bg-teal-100 text-teal-700',
]
function monoClass(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return MONO[h % MONO.length]
}
function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '#'
}

function Thumb({ it, size }: { it: PickerItem; size: number }) {
  if (it.image_url) {
    return <Image src={it.image_url} alt={it.name} width={size} height={size} className="object-cover h-full w-full" unoptimized />
  }
  return (
    <div className={cn('h-full w-full flex items-center justify-center font-bold', monoClass(it.category ?? it.code))}>
      <span style={{ fontSize: Math.max(11, size / 3.2) }}>{initials(it.name)}</span>
    </div>
  )
}

export function ItemPicker({
  items, value, onChange, disabled, className, placeholder,
  stockByItem, storeLabel, allowRequestNew, onProposeItem,
}: Props) {
  const stockMode = !!stockByItem
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [inStoreOnly, setInStoreOnly] = useState(true)
  const [proposing, setProposing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = items.find(i => i.id === value)
  const avail = (id: string) => (stockByItem ? (stockByItem[id] ?? 0) : undefined)

  useEffect(() => {
    if (open) {
      setInStoreOnly(stockMode)
      setTimeout(() => searchRef.current?.focus(), 50)
    } else { setQ(''); setActiveCategory('All'); setProposing(false) }
  }, [open, stockMode])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) if (it.category) set.add(it.category)
    return ['All', ...Array.from(set).sort()]
  }, [items])

  const inStoreCount = useMemo(
    () => (stockMode ? items.filter(i => (avail(i.id) ?? 0) > 0).length : 0),
    [items, stockByItem], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const filtered = useMemo(() => {
    let out = items
    if (stockMode && inStoreOnly) out = out.filter(i => (avail(i.id) ?? 0) > 0)
    if (activeCategory !== 'All') out = out.filter(i => i.category === activeCategory)
    const lc = q.trim().toLowerCase()
    if (lc) {
      out = out.filter(i =>
        i.code.toLowerCase().includes(lc) ||
        i.name.toLowerCase().includes(lc) ||
        (i.category ?? '').toLowerCase().includes(lc))
    }
    if (stockMode) {
      out = [...out].sort((a, b) => (avail(b.id) ?? 0) - (avail(a.id) ?? 0))
    }
    return out
  }, [items, q, activeCategory, inStoreOnly, stockByItem]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={cn(
          'flex items-center justify-between w-full h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm text-left hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600',
          disabled && 'opacity-60 cursor-not-allowed',
          className,
        )}
      >
        {selected ? (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="h-7 w-7 rounded-md border border-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              <Thumb it={selected} size={28} />
            </span>
            <span className="min-w-0 truncate">
              <span className="font-mono text-[11px] text-blue-700 mr-1.5">{selected.code}</span>
              <span className="text-gray-800">{selected.name}</span>
            </span>
          </span>
        ) : (
          <span className="text-gray-400">{placeholder ?? '— Select item —'}</span>
        )}
        <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 ml-2" />
      </button>

      {open && !disabled && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-2 md:p-4"
          role="dialog" aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef} type="search" value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by code, name or category…"
                className="flex-1 outline-none text-sm placeholder-gray-400"
              />
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 p-1"><X className="h-4 w-4" /></button>
            </div>

            {/* Stock scope toggle */}
            {stockMode && (
              <div className="flex items-center gap-2 px-4 pt-3">
                <button type="button" onClick={() => setInStoreOnly(true)}
                  className={cn('text-xs font-medium px-3 h-8 rounded-full', inStoreOnly ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                  In {storeLabel ?? 'this store'} ({inStoreCount})
                </button>
                <button type="button" onClick={() => setInStoreOnly(false)}
                  className={cn('text-xs font-medium px-3 h-8 rounded-full', !inStoreOnly ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                  All catalogue ({items.length})
                </button>
              </div>
            )}

            {/* Category chips */}
            <div className="px-4 pt-3 pb-1 border-b border-gray-100 overflow-x-auto">
              <div className="flex gap-1.5 min-w-min">
                {categories.map(c => (
                  <button key={c} type="button" onClick={() => setActiveCategory(c)}
                    className={cn('inline-flex items-center text-xs font-medium px-3 h-8 rounded-full whitespace-nowrap',
                      activeCategory === c ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {proposing && onProposeItem ? (
                <ProposeNewItem categories={categories.filter(c => c !== 'All')} initialName={q}
                  onCancel={() => setProposing(false)}
                  onDone={() => { setProposing(false); setOpen(false) }}
                  onProposeItem={onProposeItem} />
              ) : filtered.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-500 space-y-3">
                  <p>{stockMode && inStoreOnly
                    ? <>Nothing matching <b>{q || activeCategory}</b> is stocked in {storeLabel ?? 'this store'}.</>
                    : <>No items match <b>{q || activeCategory}</b>.</>}</p>
                  {stockMode && inStoreOnly && (
                    <button type="button" onClick={() => setInStoreOnly(false)} className="text-blue-600 text-xs font-medium hover:underline">
                      Search the full catalogue instead →
                    </button>
                  )}
                  {allowRequestNew && onProposeItem && (
                    <div><button type="button" onClick={() => setProposing(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50">
                      <PackagePlus className="h-4 w-4" /> Request a new item
                    </button></div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {filtered.map(it => {
                    const isSelected = it.id === value
                    const a = avail(it.id)
                    return (
                      <button key={it.id} type="button" onClick={() => { onChange(it.id); setOpen(false) }}
                        className={cn('relative text-left rounded-xl border bg-white p-2 hover:shadow-md hover:-translate-y-0.5 transition-all',
                          isSelected ? 'border-blue-600 ring-2 ring-blue-100' : 'border-gray-200')}>
                        <div className="aspect-square w-full rounded-lg border border-gray-100 overflow-hidden mb-2">
                          <Thumb it={it} size={120} />
                        </div>
                        <p className="font-mono text-[10px] font-bold text-blue-700 leading-tight">{it.code}</p>
                        <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 mt-0.5">{it.name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{it.unit}{it.category ? <> · {it.category}</> : null}</p>
                        {stockMode && (
                          <p className={cn('text-[10px] font-semibold mt-0.5', (a ?? 0) > 0 ? 'text-emerald-700' : 'text-gray-400')}>
                            {(a ?? 0) > 0 ? `${(a ?? 0).toLocaleString('en-IN')} on hand` : 'not in this store'}
                          </p>
                        )}
                        {isSelected && (
                          <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-blue-600 text-white inline-flex items-center justify-center"><Check className="h-3 w-3" /></span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between gap-2">
              <span><b>{filtered.length}</b> shown</span>
              {allowRequestNew && onProposeItem && !proposing && (
                <button type="button" onClick={() => setProposing(true)} className="inline-flex items-center gap-1 text-blue-600 font-medium hover:underline">
                  <PackagePlus className="h-3.5 w-3.5" /> Request a new item
                </button>
              )}
              <span className="hidden sm:inline">Press <kbd className="font-mono bg-gray-100 px-1 rounded">Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ProposeNewItem({
  categories, initialName, onCancel, onDone, onProposeItem,
}: {
  categories: string[]
  initialName: string
  onCancel: () => void
  onDone: () => void
  onProposeItem: (p: { name: string; unit: string; category: string }) => Promise<{ ok: boolean; error?: string }>
}) {
  const [name, setName] = useState(initialName)
  const [unit, setUnit] = useState('nos')
  const [category, setCategory] = useState(categories[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!name.trim()) { setError('Enter an item name'); return }
    setBusy(true); setError(null)
    const res = await onProposeItem({ name: name.trim(), unit: unit.trim() || 'nos', category: category.trim() })
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not send'); return }
    setDone(true)
    setTimeout(onDone, 1400)
  }

  if (done) {
    return <div className="p-8 text-center text-sm text-emerald-700">Sent to admin for approval. You can add it to your request once it&apos;s approved.</div>
  }
  return (
    <div className="max-w-md mx-auto p-2 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Request a new item</p>
      <p className="text-xs text-gray-500">Not in the catalogue? Add the details — an admin approves it, then everyone can use it.</p>
      <div>
        <label className="text-xs text-gray-500">Item name *</label>
        <input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-gray-300 px-3 text-sm" placeholder="e.g. 110mm PVC Bend" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500">Unit</label>
          <input value={unit} onChange={e => setUnit(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-gray-300 px-3 text-sm" placeholder="nos / kg / m" />
        </div>
        <div>
          <label className="text-xs text-gray-500">Category</label>
          <input value={category} onChange={e => setCategory(e.target.value)} list="inv-cat-suggest" className="mt-1 h-10 w-full rounded-xl border border-gray-300 px-3 text-sm" placeholder="Plumbing" />
          <datalist id="inv-cat-suggest">{categories.map(c => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 text-white text-sm font-medium px-4 h-10 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />} Send for approval
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 px-3 h-10">Back</button>
      </div>
    </div>
  )
}
