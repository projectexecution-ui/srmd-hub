'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { updateItem, setItemActive, mergeItems, itemFacts, findItems } from '../admin-actions'
import { mergePreview } from '@/lib/warehouse/corrections'
import type { ItemFacts } from '@/lib/warehouse/corrections'
import type { ItemRow } from '@/lib/warehouse/admin-data'
import { Loader2, Search, ChevronRight, Merge, Archive, RotateCcw, Info } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

export function ItemsClient({
  rows, total, q, includeRetired, units, categories, canAdmin,
}: {
  rows: ItemRow[]
  total: number
  q: string
  includeRetired: boolean
  units: string[]
  categories: string[]
  canAdmin: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState(q)
  const [openId, setOpenId] = useState<string | null>(null)

  // Search runs on the server — 2,803 items is far too many to ship to a phone
  // and filter there. Debounced so it is one query per pause, not per keystroke.
  useEffect(() => {
    if (text === q) return
    const t = setTimeout(() => {
      const p = new URLSearchParams()
      if (text.trim()) p.set('q', text.trim())
      if (includeRetired) p.set('retired', '1')
      router.push(`/warehouse/items?${p.toString()}`)
    }, 350)
    return () => clearTimeout(t)
  }, [text, q, includeRetired, router])

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input className={`${inputCls} pl-8`} value={text} onChange={e => setText(e.target.value)}
            placeholder="Search the item master" aria-label="Search items" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11.5px] text-slate-500">
            {total === 0 ? 'Nothing matches'
              : `${rows.length} of ${total} shown${total > rows.length ? ' — narrow the search to see the rest' : ''}`}
          </p>
          <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={includeRetired} className="h-3.5 w-3.5"
              onChange={e => {
                const p = new URLSearchParams()
                if (text.trim()) p.set('q', text.trim())
                if (e.target.checked) p.set('retired', '1')
                router.push(`/warehouse/items?${p.toString()}`)
              }} />
            Include retired
          </label>
        </div>
      </Card>

      {!canAdmin && (
        <Card className="p-3 shadow-sm text-[12.5px] text-amber-900 bg-amber-50 border-amber-200">
          You can see the master but not change it. An item’s name and unit are shared by every entry ever
          recorded against it, so editing is admin-only.
        </Card>
      )}

      <Card className="p-0 shadow-sm overflow-hidden divide-y divide-slate-100">
        {rows.map(r => (
          <div key={r.id}>
            <button type="button" onClick={() => setOpenId(openId === r.id ? null : r.id)}
              aria-expanded={openId === r.id}
              className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[52px] text-left hover:bg-slate-50">
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-semibold truncate ${
                  r.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                  {r.name}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">
                  {r.unit}
                  {r.category ? ` · ${r.category}` : ''}
                  {r.lastRate != null ? ` · last ${formatINR(r.lastRate)}` : ''}
                  {r.source === 'in4' ? ` · IN4${r.discipline ? ` (${r.discipline})` : ''}` : ''}
                </span>
              </span>
              {r.stockQty > 0 && (
                <span className="text-[11.5px] font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                  {formatQty(r.stockQty)} {r.unit}
                </span>
              )}
              <ChevronRight className={`h-4 w-4 text-slate-400 flex-shrink-0 transition ${
                openId === r.id ? 'rotate-90' : ''}`} />
            </button>

            {openId === r.id && (
              <ItemPanel item={r} units={units} categories={categories} canAdmin={canAdmin} />
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="p-6 text-center text-[13px] text-slate-500">
            No item matches that. Items are created at the gate or mid-count, as material actually appears.
          </p>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ItemPanel({
  item, units, categories, canAdmin,
}: {
  item: ItemRow
  units: string[]
  categories: string[]
  canAdmin: boolean
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
    <div className="px-3 pb-3 pt-1 bg-slate-50/70 border-t border-slate-100 space-y-3">
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
            const res = await updateItem(item.id, {
              name, unit, category: category || null, subcategory: null,
            })
            if (!res.ok) { toast.error(res.error ?? 'Could not save that.', { duration: 9000 }); return }
            toast.success('Saved')
            router.refresh()
          })}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>

        <button type="button" disabled={!canAdmin || busy}
          className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold
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
            className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold
                       text-slate-600 hover:border-slate-300 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Merge className="h-3.5 w-3.5" /> Merge into another item
          </button>
        )}

        {facts && (
          <span className="text-[11px] text-slate-500">
            {facts.movements} {facts.movements === 1 ? 'movement' : 'movements'}
            {facts.stockLines > 0 ? ` · ${formatQty(facts.stockQty)} ${facts.unit} in ${facts.stockLines} ${facts.stockLines === 1 ? 'store' : 'stores'}` : ''}
            {facts.openPoLines > 0 ? ` · ${facts.openPoLines} open PO ${facts.openPoLines === 1 ? 'line' : 'lines'}` : ''}
          </span>
        )}
      </div>

      {merging && facts && <MergePanel from={facts} onDone={() => setMerging(false)} />}
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
