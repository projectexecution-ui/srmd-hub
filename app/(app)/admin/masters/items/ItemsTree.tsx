'use client'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X, Warehouse, Archive } from 'lucide-react'
import type { ItemType, ItemsMaster } from '@/lib/masters'
import { formatNumber } from '@/lib/utils'
import { LinkPicker } from '../LinkPicker'

/** Type → sub-type → item, collapsed by default (the same grouped layout the
 *  Internal Estimate uses). Search expands whatever matches. */
export function ItemsTree({ types, unmatched }: { types: ItemType[]; unmatched: ItemsMaster['unmatched'] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [onlyMissing, setOnlyMissing] = useState(false)
  const needle = q.trim().toLowerCase()

  const view = useMemo(() => {
    return types.map(t => ({
      ...t,
      subtypes: t.subtypes.map(s => ({
        ...s,
        items: s.items.filter(i => (!onlyMissing || !i.inWarehouse) && (!needle || `${i.name} ${i.code ?? ''} ${i.hsn ?? ''} ${s.name} ${t.name}`.toLowerCase().includes(needle))),
      })).filter(s => s.items.length > 0),
    })).filter(t => t.subtypes.length > 0)
  }, [types, needle, onlyMissing])

  const toggle = (k: string) => setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const isOpen = (k: string) => needle.length > 0 || open.has(k)
  const materialOptions = useMemo(() => types.flatMap(t => t.subtypes.flatMap(s => s.items.map(i => ({ key: String(i.id), label: `${i.name}${i.uom ? ` (${i.uom})` : ''} · ${s.name}` })))), [types])
  const total = view.reduce((n, t) => n + t.subtypes.reduce((m, s) => m + s.items.length, 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search a material, code, HSN, sub-type…" aria-label="Search materials" className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white pl-9 pr-9 text-sm" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>}
        </div>
        <button type="button" onClick={() => setOnlyMissing(v => !v)} className={`whitespace-nowrap rounded-full border px-3 min-h-[44px] sm:min-h-[36px] text-xs font-medium ${onlyMissing ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
          Not yet in the Warehouse
        </button>
      </div>
      <p className="text-[11px] text-gray-500 tabular-nums">{total.toLocaleString('en-IN')} materials shown · <Warehouse className="inline h-3 w-3 -mt-0.5" /> = in the Warehouse catalogue · <Archive className="inline h-3 w-3 -mt-0.5" /> = in Inventory (old)</p>

      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {view.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">{types.length === 0 ? 'IN4 materials appear here after the Masters feed runs.' : 'Nothing matches.'}</p>}
        {view.map(t => (
          <div key={t.id}>
            <button type="button" onClick={() => toggle(`t${t.id}`)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 min-h-[44px]">
              {isOpen(`t${t.id}`) ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              <span className="text-sm font-semibold text-gray-900 flex-1 min-w-0 truncate">{t.name}</span>
              <span className="text-[11px] tabular-nums text-gray-500">{t.subtypes.reduce((m, s) => m + s.items.length, 0)} items · {t.inWarehouse} in Warehouse</span>
            </button>
            {isOpen(`t${t.id}`) && t.subtypes.map(s => (
              <div key={s.id} className="border-t border-gray-50">
                <button type="button" onClick={() => toggle(`s${t.id}-${s.id}`)} className="w-full flex items-center gap-2 pl-8 pr-3 py-2 text-left hover:bg-gray-50 min-h-[44px]">
                  {isOpen(`s${t.id}-${s.id}`) ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                  <span className="text-[13px] font-medium text-gray-800 flex-1 min-w-0 truncate">{s.name}</span>
                  <span className="text-[11px] tabular-nums text-gray-500">{s.items.length}</span>
                </button>
                {isOpen(`s${t.id}-${s.id}`) && (
                  <ul className="pb-1">
                    {s.items.map(i => (
                      <li key={i.id} className="flex items-center gap-2 pl-14 pr-3 py-1.5 text-[12.5px] hover:bg-gray-50/60">
                        <span className={`flex-1 min-w-0 truncate ${i.isActive ? 'text-gray-800' : 'text-gray-400 line-through'}`} title={i.name}>{i.name}</span>
                        <span className="text-[11px] text-gray-400 font-mono hidden sm:inline">{i.code ?? ''}</span>
                        <span className="text-[11px] text-gray-500 w-14 text-right">{i.uom ?? ''}</span>
                        <span className="text-[11px] text-gray-500 w-16 text-right tabular-nums hidden md:inline">{i.hsn ?? ''}</span>
                        <span className="text-[11px] text-gray-500 w-20 text-right tabular-nums hidden md:inline">{i.rate ? `₹${formatNumber(i.rate)}` : ''}</span>
                        <span className="w-10 flex justify-end gap-1">
                          {i.inWarehouse && <Warehouse className="h-3.5 w-3.5 text-emerald-600" aria-label="In the Warehouse catalogue" />}
                          {i.inInventory && <Archive className="h-3.5 w-3.5 text-gray-400" aria-label="In Inventory (old)" />}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {unmatched.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50/40">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-amber-900 list-none min-h-[44px] flex items-center justify-between">
            <span>{unmatched.length.toLocaleString('en-IN')} hub items IN4 does not know</span>
            <span className="text-[11px] font-normal text-amber-800">typed by hand, or renamed in IN4 since — pin each to its IN4 material</span>
          </summary>
          <ul className="divide-y divide-amber-100 border-t border-amber-100 max-h-[50vh] overflow-auto">
            {unmatched.map(u => (
              <li key={`${u.table}:${u.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px]">
                <span className="flex-1 min-w-[12rem] text-gray-800">{u.name}<span className="text-gray-400"> {u.unit ?? ''}</span></span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">{u.table === 'wh_items' ? 'Warehouse' : 'Inventory (old)'}</span>
                <LinkPicker kind="material" hubTable={u.table} hubId={u.id} current={null} options={materialOptions} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
