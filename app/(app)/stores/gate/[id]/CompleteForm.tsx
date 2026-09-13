'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { completeGateEntry, importIn4Material } from '@/lib/stores/actions'
import { loadPoForEntry } from './po-action'
import { missingForComplete, fmtQty, type Register } from '@/lib/stores/core'
import { formatINR } from '@/lib/utils'
import { Field, inputClass, Btn, Notice, Scroller, th, td, tdNum } from '../../ui'

interface Opt { id: string; name: string; code?: string | null }
interface ItemOpt { id: string; name: string; unit: string; lastRate: number | null; in4MaterialId: number | null }
interface Line { key: string; itemId: string; unit: string; qty: string; rate: string; returnable: boolean; in4PoItemId?: number | null; label?: string }

let seq = 0
const newLine = (): Line => ({ key: `l${++seq}`, itemId: '', unit: '', qty: '', rate: '', returnable: false })

/**
 * The storekeeper's half — and the only place stock is created.
 *
 * The PO lookup is the point of this screen: IN4 already knows what was
 * ordered and how much has landed, so the storekeeper ticks quantities
 * instead of typing item names. Typing them is how two systems end up with
 * different names for the same steel.
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
  const [poNote, setPoNote] = useState<string | null>(null)
  const [poBusy, setPoBusy] = useState(false)

  const [itemList, setItemList] = useState<ItemOpt[]>(items)

  const filled = lines.filter(l => l.itemId && Number(l.qty) > 0)
  const missing = missingForComplete({
    register, entityId: entityId || null, projectId: projectId || null,
    locationId: locationId || null, lineCount: filled.length,
  })

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const pickItem = (key: string, itemId: string) => {
    const item = itemList.find(i => i.id === itemId)
    setLine(key, { itemId, unit: item?.unit ?? '', rate: item?.lastRate != null ? String(item.lastRate) : '' })
  }

  /** Pull the PO's lines from IN4 and turn each into a draft line. */
  const fetchPo = () => {
    setPoBusy(true); setPoNote(null)
    start(async () => {
      const po = await loadPoForEntry(poWoNo)
      setPoBusy(false)
      if (!po) { setPoNote(`IN4 has no purchase order numbered "${poWoNo}".`); return }
      if (po.lines.length === 0) { setPoNote(`${po.poNo} has no item lines in IN4.`); return }

      // Import anything IN4 has that the item master does not, so the
      // storekeeper never has to stop and go and add it first.
      const drafts: Line[] = []
      const known = new Map(itemList.filter(i => i.in4MaterialId).map(i => [i.in4MaterialId as number, i]))
      const added: ItemOpt[] = []
      for (const l of po.lines) {
        let item = known.get(l.materialId)
        if (!item) {
          const r = await importIn4Material(l.materialId)
          if (!r.ok || !r.data) continue
          item = { id: r.data.id, name: r.data.name, unit: l.unit, lastRate: l.rate, in4MaterialId: l.materialId }
          added.push(item)
          known.set(l.materialId, item)
        }
        const outstanding = Math.max(0, l.ordered - l.alreadyIn)
        drafts.push({
          key: `po${++seq}`, itemId: item.id, unit: l.unit,
          qty: outstanding > 0 ? String(outstanding) : '',
          rate: String(l.rate), returnable: false, in4PoItemId: l.in4PoItemId,
          label: `ordered ${fmtQty(l.ordered)} · already in ${fmtQty(l.alreadyIn)}`,
        })
      }
      if (added.length) setItemList(prev => [...prev, ...added])
      setLines(drafts.length ? drafts : [newLine()])
      setPoNote(`${po.poNo}${po.supplier ? ` · ${po.supplier}` : ''} — ${drafts.length} line${drafts.length === 1 ? '' : 's'} filled in. Quantities are what is still outstanding; change any that differ.`)
    })
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">Step 2 · Complete the entry</h2>
        <p className="text-[12.5px] text-gray-600 mt-0.5">
          {makesStock
            ? 'What was actually in the vehicle. Saving this is what creates stock.'
            : 'Vendor material goes straight to site, so nothing here becomes stock — only the returnable lines are tracked.'}
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Trust paying" required>
          <select className={inputClass} value={entityId} onChange={e => setEntityId(e.target.value)}>
            <option value="">Pick one</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.code || e.name}</option>)}
          </select>
        </Field>
        <Field label="Project" required>
          <select className={inputClass} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Pick one</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Item category">
          <select className={inputClass} value={itemCategoryId} onChange={e => setItemCategoryId(e.target.value)}>
            <option value="">Pick one</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Field label="PO / WO number" hint="Type it and CT Hub fills the lines in from IN4.">
              <input className={inputClass} value={poWoNo} onChange={e => setPoWoNo(e.target.value)}
                placeholder="PO/26-27/0418" autoComplete="off" />
            </Field>
          </div>
          <Btn kind="ghost" busy={poBusy} disabled={!poWoNo.trim()} onClick={fetchPo}>Fill from IN4</Btn>
        </div>
        {poNote && <Notice kind={poNote.includes('no purchase order') || poNote.includes('no item lines') ? 'bad' : 'ok'}>{poNote}</Notice>}
      </div>

      {makesStock && (
        <Field label="Where it was put" required>
          <select className={inputClass} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">Pick a place</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-bold text-gray-800">
            {makesStock ? 'Items received' : 'Returnable items only'}
          </p>
          <button type="button" onClick={() => setLines(ls => [...ls, newLine()])}
            className="text-[12px] font-semibold text-indigo-700 hover:underline min-h-[44px] px-1">
            + Add a line
          </button>
        </div>

        <Scroller min={720}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Unit</th>
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Returnable</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const amount = Number(l.qty) * Number(l.rate)
                return (
                  <tr key={l.key}>
                    <td className={td}>
                      <select className={`${inputClass} min-w-[180px]`} value={l.itemId} onChange={e => pickItem(l.key, e.target.value)}>
                        <option value="">Pick an item</option>
                        {itemList.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                      {l.label && <p className="text-[11px] text-gray-400 mt-1">{l.label}</p>}
                    </td>
                    <td className={td}>
                      <input className={`${inputClass} w-20`} value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} />
                    </td>
                    <td className={td}>
                      <input className={`${inputClass} w-24 text-right`} value={l.qty} inputMode="decimal"
                        onChange={e => setLine(l.key, { qty: e.target.value })} />
                    </td>
                    <td className={td}>
                      <input className={`${inputClass} w-24 text-right`} value={l.rate} inputMode="decimal"
                        onChange={e => setLine(l.key, { rate: e.target.value })} />
                    </td>
                    <td className={tdNum}>{amount > 0 ? formatINR(amount) : '—'}</td>
                    <td className={td}>
                      <input type="checkbox" className="h-5 w-5 accent-indigo-700" checked={l.returnable}
                        onChange={e => setLine(l.key, { returnable: e.target.checked })}
                        aria-label="Must come back" />
                    </td>
                    <td className={td}>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                          className="text-[12px] text-rose-700 hover:underline min-h-[44px] px-1" aria-label="Remove line">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Scroller>

        {!makesStock && (
          <p className="px-3 py-2 text-[11.5px] text-gray-500 border-t border-gray-100">
            Only lines ticked <b>Returnable</b> matter here. The rest of the load went to site and is not stock —
            counting it in would create a balance nobody ever consumes.
          </p>
        )}
      </div>

      {missing.length > 0 && <Notice kind="info">Still needed: {missing.join(' · ')}</Notice>}
      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <Btn
        busy={pending}
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
      >
        {makesStock ? 'Take into stock' : `Complete ${entryNo}`}
      </Btn>
    </div>
  )
}
