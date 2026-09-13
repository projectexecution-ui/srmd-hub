'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Download, Plus, Trash2, PackageCheck } from 'lucide-react'
import { completeGateEntry, importIn4Material } from '@/lib/stores/actions'
import { loadPoForEntry } from './po-action'
import { missingForComplete, fmtQty, type Register } from '@/lib/stores/core'
import { T } from '@/lib/stores/lang'
import { formatINR } from '@/lib/utils'
import { Bi, BigInput, Stepper, BigNotice } from '../../field'

interface Opt { id: string; name: string; code?: string | null }
interface ItemOpt { id: string; name: string; unit: string; lastRate: number | null; in4MaterialId: number | null }
interface Line { key: string; itemId: string; unit: string; qty: string; rate: string; returnable: boolean; in4PoItemId?: number | null; label?: string }

let seq = 0
const newLine = (): Line => ({ key: `l${++seq}`, itemId: '', unit: '', qty: '', rate: '', returnable: false })

/**
 * The storekeeper's half — and the only place stock is created.
 *
 * Every item is a CARD, not a table row. A seven-column table on a 375px phone
 * is a horizontal scroll with a number hiding off each edge, which is exactly
 * how a quantity gets keyed into the wrong line. A card holds one item and can
 * be read without moving anything.
 *
 * Quantity is a stepper: ± for the common small corrections, the field itself
 * when the number is 2,400. Typing on a phone keypad in a warehouse is where
 * wrong numbers come from.
 */
export function CompleteForm({
  entryId, entryNo, register, makesStock, entities, categories, locations, projects, items,
}: {
  entryId: string; entryNo: string; register: Register; makesStock: boolean
  entities: Opt[]; categories: Opt[]; locations: Array<{ id: string; label: string }>
  projects: Opt[]; items: ItemOpt[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [entityId, setEntityId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [poWoNo, setPoWoNo] = useState('')
  const [itemCategoryId, setItemCategoryId] = useState('')
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : '')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [poNote, setPoNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [poBusy, setPoBusy] = useState(false)
  const [itemList, setItemList] = useState<ItemOpt[]>(items)

  const filled = lines.filter(l => l.itemId && Number(l.qty) > 0)
  const missing = missingForComplete({
    register, entityId: entityId || null, projectId: projectId || null,
    locationId: locationId || null, lineCount: filled.length,
  })
  const total = filled.reduce((s, l) => s + Number(l.qty) * Number(l.rate || 0), 0)

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const pickItem = (key: string, itemId: string) => {
    const item = itemList.find(i => i.id === itemId)
    setLine(key, { itemId, unit: item?.unit ?? '', rate: item?.lastRate != null ? String(item.lastRate) : '' })
  }

  const fetchPo = () => {
    setPoBusy(true); setPoNote(null)
    start(async () => {
      const po = await loadPoForEntry(poWoNo)
      setPoBusy(false)
      if (!po) { setPoNote({ ok: false, text: `IN4 has no order numbered "${poWoNo}".` }); return }
      if (po.lines.length === 0) { setPoNote({ ok: false, text: `${po.poNo} has no items in IN4.` }); return }

      const drafts: Line[] = []
      const known = new Map(itemList.filter(i => i.in4MaterialId).map(i => [i.in4MaterialId as number, i]))
      const added: ItemOpt[] = []
      for (const l of po.lines) {
        let item = known.get(l.materialId)
        if (!item) {
          const r = await importIn4Material(l.materialId)
          if (!r.ok || !r.data) continue
          item = { id: r.data.id, name: r.data.name, unit: l.unit, lastRate: l.rate, in4MaterialId: l.materialId }
          added.push(item); known.set(l.materialId, item)
        }
        const outstanding = Math.max(0, l.ordered - l.alreadyIn)
        drafts.push({
          key: `po${++seq}`, itemId: item.id, unit: l.unit,
          qty: outstanding > 0 ? String(outstanding) : '',
          rate: String(l.rate), returnable: false, in4PoItemId: l.in4PoItemId,
          label: `Ordered ${fmtQty(l.ordered)} · already in ${fmtQty(l.alreadyIn)}`,
        })
      }
      if (added.length) setItemList(prev => [...prev, ...added])
      setLines(drafts.length ? drafts : [newLine()])
      setPoNote({ ok: true, text: `${po.poNo}${po.supplier ? ` · ${po.supplier}` : ''} — ${drafts.length} item${drafts.length === 1 ? '' : 's'} filled in. Quantities shown are what is still due; change any that differ.` })
    })
  }

  const sel = 'w-full rounded-xl border-2 border-gray-300 bg-white px-3.5 py-3 min-h-[56px] text-[16px] text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100'

  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-4 sm:p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <PackageCheck className="h-5.5 w-5.5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <Bi t={T.skTitle} size="lg" />
          <p className="text-[13px] text-gray-600 mt-1">
            {makesStock
              ? 'Saving this is what creates stock.'
              : 'Vendor material goes to site, so nothing here becomes stock — only what must come back is tracked.'}
          </p>
        </div>
      </div>

      {/* Who and where — three answers, stacked on a phone. */}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block space-y-1.5">
          <Bi t={T.whichTrust} size="sm" />
          <select className={sel} value={entityId} onChange={e => setEntityId(e.target.value)}>
            <option value="">—</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.code || e.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5">
          <Bi t={T.whichProject} size="sm" />
          <select className={sel} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">—</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5">
          <Bi t={{ en: 'Item category', gu: 'વસ્તુનો પ્રકાર' }} size="sm" />
          <select className={sel} value={itemCategoryId} onChange={e => setItemCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {/* The PO shortcut — the point of the whole screen. */}
      <div className="rounded-xl border-2 border-gray-200 bg-white p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <BigInput t={T.poNumber} value={poWoNo} onChange={setPoWoNo} placeholder="PO/26-27/0418" upper />
          </div>
          <button
            type="button" onClick={fetchPo} disabled={!poWoNo.trim() || poBusy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 min-h-[64px]
              text-white font-semibold active:bg-black disabled:bg-gray-200 disabled:text-gray-400 sm:w-auto w-full"
          >
            <Download className="h-5 w-5" strokeWidth={2.2} />
            <span className="text-left">
              <span className="block text-[15px] leading-tight">{poBusy ? '…' : T.fillFromIn4.en}</span>
              <span className="block text-[13px] leading-tight opacity-80" lang="gu">{T.fillFromIn4.gu}</span>
            </span>
          </button>
        </div>
        {poNote && <BigNotice kind={poNote.ok ? 'ok' : 'bad'} title={poNote.text} />}
      </div>

      {makesStock && (
        <label className="block space-y-1.5">
          <Bi t={T.whereKept} size="sm" />
          <select className={sel} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">—</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
      )}

      {/* One card per item. */}
      <div className="space-y-3">
        {lines.map((l, n) => {
          const amount = Number(l.qty) * Number(l.rate || 0)
          return (
            <div key={l.key} className="rounded-xl border-2 border-gray-200 bg-white p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-[13px] font-bold text-gray-600 tabular-nums">
                  {n + 1}
                </span>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                    aria-label={T.remove.en}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 min-h-[44px] text-[13px] font-semibold text-rose-700 active:bg-rose-50">
                    <Trash2 className="h-4 w-4" /> {T.remove.en}
                  </button>
                )}
              </div>

              <label className="block space-y-1.5">
                <Bi t={T.item} size="sm" />
                <select className={sel} value={l.itemId} onChange={e => pickItem(l.key, e.target.value)}>
                  <option value="">—</option>
                  {itemList.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                {l.label && <span className="block text-[12px] text-gray-400">{l.label}</span>}
              </label>

              <div className="space-y-1.5">
                <Bi t={T.qty} size="sm" />
                <Stepper value={l.qty} onChange={v => setLine(l.key, { qty: v })} unit={l.unit || undefined} />
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <label className="block space-y-1.5">
                  <Bi t={T.rate} size="sm" />
                  <input
                    className={sel} value={l.rate} inputMode="decimal"
                    onChange={e => setLine(l.key, { rate: e.target.value })}
                  />
                </label>
                <div className="space-y-1.5">
                  <Bi t={T.amount} size="sm" />
                  <p className="min-h-[56px] flex items-center px-3.5 rounded-xl bg-gray-50 border-2 border-gray-100
                    text-[17px] font-bold tabular-nums text-gray-900">
                    {amount > 0 ? formatINR(amount) : '—'}
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-3 rounded-xl border-2 border-gray-200 px-3.5 py-2.5 min-h-[56px] active:bg-gray-50">
                <input type="checkbox" className="h-6 w-6 accent-amber-600 shrink-0" checked={l.returnable}
                  onChange={e => setLine(l.key, { returnable: e.target.checked })} />
                <Bi t={T.mustComeBack} size="sm" />
              </label>
            </div>
          )
        })}

        <button
          type="button" onClick={() => setLines(ls => [...ls, newLine()])}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300
            bg-white min-h-[60px] text-[15px] font-semibold text-gray-600 active:bg-gray-50"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
          {T.addItem.en} · <span lang="gu">{T.addItem.gu}</span>
        </button>
      </div>

      {!makesStock && (
        <p className="text-[12.5px] text-gray-600 bg-white rounded-xl border border-gray-200 px-3.5 py-2.5">
          Only what is ticked <b>{T.mustComeBack.en}</b> matters here. The rest went to site and is not stock —
          counting it in would create a balance nobody ever uses up.
        </p>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-gray-900 px-4 py-3.5 text-white">
          <span className="text-[15px] font-semibold">Total</span>
          <span className="text-[20px] font-bold tabular-nums">{formatINR(total)}</span>
        </div>
      )}

      {missing.length > 0 && <BigNotice kind="bad" title={`${T.needed.en}: ${missing.join(' · ')}`} />}
      {result && <BigNotice kind={result.ok ? 'ok' : 'bad'} title={result.message} />}

      <button
        type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await completeGateEntry({
            entryId, entityId: entityId || null, projectId: projectId || null,
            poWoNo, itemCategoryId: itemCategoryId || null, locationId: locationId || null,
            lines: filled.map(l => ({
              itemId: l.itemId, unit: l.unit || 'Nos', qty: Number(l.qty),
              rate: l.rate === '' ? null : Number(l.rate),
              returnable: l.returnable, in4PoItemId: l.in4PoItemId ?? null,
            })),
          })
          setResult(r)
          if (r.ok) router.refresh()
        })}
        className="w-full rounded-2xl bg-indigo-700 min-h-[64px] text-white font-bold active:bg-indigo-800
          disabled:bg-gray-200 disabled:text-gray-400"
      >
        <span className="block text-[17px] leading-tight">
          {pending ? '…' : makesStock ? T.takeIntoStock.en : `Complete ${entryNo}`}
        </span>
        {!pending && makesStock && (
          <span className="block text-[15px] leading-tight opacity-90" lang="gu">{T.takeIntoStock.gu}</span>
        )}
      </button>
    </div>
  )
}
