'use client'

/** The V1 catalogue picker, rebuilt for V2.
 *
 *  A full-screen modal rather than a dropdown, because picking material is a
 *  browsing job: 2,803 items, and the engineer often knows the category and the
 *  size but not the exact name the master holds.
 *
 *  The valuable part is the pair of tabs. "In this store" first, then "All
 *  catalogue" — so the default view is what can actually be handed over today,
 *  and asking for something the store has not got is a deliberate second step
 *  rather than an accident. Every card says which it is.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, X, Package, PlusCircle, Loader2 } from 'lucide-react'

export type PickerItem = {
  id: string
  name: string
  code: string | null
  unit: string
  category: string | null
  /** How much of it this store holds right now. */
  inStore: number
}

const inputCls =
  'w-full rounded-lg border border-slate-300 pl-9 pr-8 py-2.5 text-sm bg-white min-h-[44px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'

/** Two characters standing in for a picture, same rule as the Item Master. */
function monogram(name: string): string {
  const w = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase()
  return (w[0] ?? '??').slice(0, 2).toUpperCase()
}

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

/** How many cards to draw. The chips and the search are what narrow it; this is
 *  only the backstop, and it SAYS when it has held some back. */
const PAGE = 180

export function ItemPicker({
  open, onClose, onPick, items, storeName, alreadyOn, onCreate,
}: {
  open: boolean
  onClose: () => void
  onPick: (item: PickerItem) => void
  items: PickerItem[]
  storeName: string | null
  /** Item ids already on the sheet, so the same one is not added twice. */
  alreadyOn: string[]
  /** Create an item that is not in the catalogue at all. */
  onCreate?: (name: string, unit: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'store' | 'all'>('store')
  const [cat, setCat] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    setTimeout(() => inputRef.current?.focus(), 50)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const inStore = useMemo(() => items.filter(i => i.inStore > 0), [items])
  const pool = scope === 'store' ? inStore : items

  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of pool) {
      const k = i.category?.trim() || 'Not categorised'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].map(([category, n]) => ({ category, n }))
      .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category))
  }, [pool])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return pool.filter(i => {
      if (cat && (i.category?.trim() || 'Not categorised') !== cat) return false
      if (!needle) return true
      return i.name.toLowerCase().includes(needle)
        || (i.code ?? '').toLowerCase().includes(needle)
        || (i.category ?? '').toLowerCase().includes(needle)
    })
  }, [pool, q, cat])

  const drawn = shown.slice(0, PAGE)
  const taken = new Set(alreadyOn)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-6 bg-slate-900/40">
      <div className="w-full max-w-4xl max-h-full bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">

        {/* Search */}
        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input ref={inputRef} type="search" className={inputCls} value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by code, name or category…" aria-label="Search the catalogue" />
            <button type="button" onClick={onClose} aria-label="Close"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scope: what this store holds, or the whole catalogue. */}
          <div className="flex gap-1.5 mt-2.5">
            <button type="button" onClick={() => { setScope('store'); setCat('') }}
              className={`rounded-full px-3 h-11 text-[12px] font-bold whitespace-nowrap ${
                scope === 'store' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              In {storeName ?? 'this store'} ({inStore.length})
            </button>
            <button type="button" onClick={() => { setScope('all'); setCat('') }}
              className={`rounded-full px-3 h-11 text-[12px] font-bold whitespace-nowrap ${
                scope === 'all' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              All catalogue ({items.length})
            </button>
          </div>

          {/* Categories within the chosen scope. */}
          {categories.length > 1 && (
            <div className="overflow-x-auto -mx-1 px-1 mt-2">
              <div className="flex gap-1.5 min-w-min pb-0.5">
                <Chip label="All" n={pool.length} on={!cat} onClick={() => setCat('')} />
                {categories.map(c => (
                  <Chip key={c.category} label={c.category} n={c.n}
                    on={cat === c.category}
                    onClick={() => setCat(cat === c.category ? '' : c.category)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto p-3">
          {scope === 'store' && inStore.length === 0 && (
            <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              {storeName ?? 'This store'} is holding nothing at all yet. Switch to <b>All catalogue</b> to ask
              for material anyway — a request for something a store has not got is how it gets ordered.
            </p>
          )}

          {drawn.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-[13px] text-slate-500">No item matches that.</p>
              {onCreate && q.trim().length >= 2 && (
                <button type="button" onClick={() => setCreating(true)}
                  className="text-[12.5px] font-bold text-emerald-700 hover:underline">
                  Add “{q.trim()}” to the catalogue
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {drawn.map(i => {
                const on = taken.has(i.id)
                return (
                  <button key={i.id} type="button" disabled={on}
                    onClick={() => { onPick(i); onClose() }}
                    className={`text-left rounded-xl border p-2.5 flex gap-2.5 items-start transition ${
                      on ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                         : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'}`}>
                    <span className={`h-11 w-11 flex-shrink-0 rounded-lg grid place-items-center
                                      text-[12px] font-extrabold ${toneFor(i.category ?? 'x')}`}>
                      {monogram(i.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      {i.code && (
                        <span className="block font-mono text-[9.5px] font-bold text-sky-700 truncate">{i.code}</span>
                      )}
                      <span className="block text-[12.5px] font-semibold text-slate-900 leading-snug">{i.name}</span>
                      <span className="block text-[10.5px] text-slate-500 mt-0.5">
                        {i.unit}{i.category ? ` · ${i.category}` : ''}
                      </span>
                      {/* Say plainly whether it can be handed over today. */}
                      <span className={`block text-[10.5px] mt-0.5 font-semibold ${
                        i.inStore > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {i.inStore > 0 ? `${i.inStore} ${i.unit} here` : 'not in this store'}
                      </span>
                      {on && <span className="block text-[10.5px] text-slate-500 mt-0.5">already on the sheet</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {shown.length > drawn.length && (
            <p className="text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              Showing {drawn.length} of {shown.length}. Type a few more letters or pick a category —
              drawing all {shown.length} at once would make this crawl on a phone.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2.5 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11.5px] text-slate-500">{shown.length} shown</p>
          {onCreate && (
            <button type="button" onClick={() => setCreating(true)}
              className="text-[12px] font-bold text-emerald-700 hover:underline inline-flex items-center gap-1.5">
              <PlusCircle className="h-3.5 w-3.5" /> Request a new item
            </button>
          )}
          <p className="text-[11px] text-slate-400 hidden sm:block">Press Esc to close</p>
        </div>

        {creating && onCreate && (
          <NewItem initialName={q.trim()} onCancel={() => setCreating(false)}
            onCreate={onCreate} onDone={() => { setCreating(false); setQ('') }} />
        )}
      </div>
    </div>
  )
}

function Chip({ label, n, on, onClick }: {
  label: string; n: number; on: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-11 text-[11.5px] font-semibold whitespace-nowrap ${
        on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
      {label}<span className={on ? 'text-slate-400' : 'text-slate-400'}>{n}</span>
    </button>
  )
}

/** Material that is not in the catalogue at all.
 *
 *  It is created straight away rather than queued for approval: an engineer
 *  standing on site knowing he needs a thing the master has never heard of
 *  should not be stopped, and the Item Master's merge tool is what tidies a
 *  duplicate afterwards. The unit is asked for because it is LOCKED to the item
 *  once anything is recorded against it. */
function NewItem({
  initialName, onCancel, onCreate, onDone,
}: {
  initialName: string
  onCancel: () => void
  onCreate: (name: string, unit: string) => Promise<{ ok: boolean; error?: string }>
  onDone: () => void
}) {
  const [name, setName] = useState(initialName)
  const [unit, setUnit] = useState('Nos')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="absolute inset-0 bg-white/95 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-3">
        <p className="text-[14px] font-extrabold text-slate-900 flex items-center gap-2">
          <Package className="h-4 w-4" /> Add material to the catalogue
        </p>
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1"
            htmlFor="ni-name">Name it as the store calls it</label>
          <input id="ni-name" value={name} onChange={e => setName(e.target.value)} autoFocus
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm min-h-[44px]"
            placeholder="e.g. 40mm GI Union heavy" />
        </div>
        <div>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1"
            htmlFor="ni-unit">Counted in</label>
          <select id="ni-unit" value={unit} onChange={e => setUnit(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm min-h-[44px]">
            {['Nos', 'Bag', 'Kg', 'MT', 'Mtr', 'Sqm', 'Cum', 'Ltr', 'Set', 'Roll', 'Box'].map(u =>
              <option key={u} value={u}>{u}</option>)}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            The unit is <b>locked</b> to the item once anything is recorded against it, so get it right now —
            400 Bags becoming 400 Kg later would reinterpret every entry without moving a number.
          </p>
        </div>
        {err && <p className="text-[12px] text-rose-700">{err}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={busy || name.trim().length < 2}
            className="rounded-lg bg-emerald-600 px-3 py-2 min-h-[44px] text-[12.5px] font-bold text-white
                       hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            onClick={async () => {
              setBusy(true); setErr(null)
              const res = await onCreate(name.trim(), unit)
              setBusy(false)
              if (!res.ok) { setErr(res.error ?? 'Could not add it.'); return }
              onDone()
            }}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add it
          </button>
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[44px] text-[12.5px] font-bold text-slate-500">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
