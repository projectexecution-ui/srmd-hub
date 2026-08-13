'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { saveGateOut } from '../actions'
import type { WhSite, StockRow } from '@/lib/warehouse/types'
import { Plus, Trash2, Loader2, Hammer, Store, Truck } from 'lucide-react'
import { formatQty } from '@/lib/warehouse/format'

type Row = { key: number; itemId: string; qty: number; rate: number | null }

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

let seq = 0
const blank = (): Row => ({ key: ++seq, itemId: '', qty: 0, rate: null })

export function GateOutForm({
  sites, postableSpotIds, scopingOff, stock, projects, receivers, entities, vendorNames,
  canEdit, nextOut, nextMove,
}: {
  sites: WhSite[]; postableSpotIds: string[]; scopingOff: boolean; stock: StockRow[]
  projects: Array<{ id: string; name: string }>
  receivers: Array<{ id: string; name: string }>
  entities: string[]
  /** Parties who have brought their own material in, so a return can be
   *  matched to its IN by picking the same name rather than retyping it. */
  vendorNames: string[]
  canEdit: boolean; nextOut: string; nextMove: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [destType, setDestType] = useState<'site' | 'store' | 'vendor'>('site')
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [party, setParty] = useState('')
  const [projectId, setProjectId] = useState('')
  const [entity, setEntity] = useState('')
  const [engineerId, setEngineerId] = useState('')
  const [returnable, setReturnable] = useState(false)
  const [returnDue, setReturnDue] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])

  const postable = new Set(postableSpotIds)
  const here = useMemo(
    () => stock.filter(s => s.locationId === fromId && s.qty > 0),
    [stock, fromId])
  const stockOf = (itemId: string) => here.find(s => s.itemId === itemId)

  function submit() {
    start(async () => {
      const res = await saveGateOut({
        destType,
        fromLocationId: fromId,
        toLocationId: destType === 'store' ? toId : null,
        projectId: destType === 'store' ? null : projectId || null,
        party: destType === 'vendor' ? party || null : null,
        entity: entity || null,
        engineerId: destType === 'site' ? engineerId || null : null,
        isReturnable: destType === 'site' && returnable,
        returnDueDate: returnDue || null,
        vehicleNo: vehicleNo || null,
        remarks: remarks || null,
        lines: rows.map(({ key: _k, ...r }) => r),
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success(`Saved ${res.entryNo}`)
      setRows([blank()]); setVehicleNo(''); setRemarks(''); setReturnDue('')
      router.refresh()
    })
  }

  const isSite = destType === 'site'
  const isStore = destType === 'store'
  const isVendor = destType === 'vendor'
  const tone = isSite
    ? { bg: 'bg-amber-600', hover: 'hover:bg-amber-700', soft: 'bg-amber-50 text-amber-900 border-amber-200' }
    : isStore
      ? { bg: 'bg-sky-700', hover: 'hover:bg-sky-800', soft: 'bg-sky-50 text-sky-900 border-sky-200' }
      : { bg: 'bg-purple-700', hover: 'hover:bg-purple-800', soft: 'bg-purple-50 text-purple-900 border-purple-200' }

  return (
    <Card className="p-0 shadow-sm overflow-hidden">
      <div className={`px-4 py-2.5 text-white flex items-center gap-2 ${tone.bg}`}>
        <h3 className="font-bold text-sm">
          {isSite ? 'OUT to site' : isStore ? 'Store move' : 'Back to the vendor'}
        </h3>
        <span className="ml-auto font-mono text-[11px] opacity-90">{isStore ? nextMove : nextOut}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* One question decides everything below it. A site issue consumes
            stock and charges a project; a move only relocates it; a vendor
            return takes his own material off our books. */}
        <div>
          <label className={labelCls}>Where is it going?</label>
          <div className="grid grid-cols-3 gap-0 rounded-xl border-2 border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setDestType('site')}
              aria-pressed={isSite}
              className={`px-2 py-2.5 text-left transition min-h-[56px] ${isSite ? 'bg-amber-600 text-white' : 'bg-white text-slate-700'}`}>
              <span className="flex items-center gap-1 text-[12.5px] font-bold"><Hammer className="h-3.5 w-3.5 flex-shrink-0" /> To a site</span>
              <span className={`block text-[10px] mt-0.5 leading-tight ${isSite ? 'text-amber-100' : 'text-slate-500'}`}>for use — cost hits the project</span>
            </button>
            <button type="button" onClick={() => setDestType('store')}
              aria-pressed={isStore}
              className={`px-2 py-2.5 text-left border-x-2 border-slate-200 transition min-h-[56px] ${isStore ? 'bg-sky-700 text-white' : 'bg-white text-slate-700'}`}>
              <span className="flex items-center gap-1 text-[12.5px] font-bold"><Store className="h-3.5 w-3.5 flex-shrink-0" /> Another store</span>
              <span className={`block text-[10px] mt-0.5 leading-tight ${isStore ? 'text-sky-100' : 'text-slate-500'}`}>only moves — no cost</span>
            </button>
            <button type="button" onClick={() => setDestType('vendor')}
              aria-pressed={isVendor}
              className={`px-2 py-2.5 text-left transition min-h-[56px] ${isVendor ? 'bg-purple-700 text-white' : 'bg-white text-slate-700'}`}>
              <span className="flex items-center gap-1 text-[12.5px] font-bold"><Truck className="h-3.5 w-3.5 flex-shrink-0" /> Back to vendor</span>
              <span className={`block text-[10px] mt-0.5 leading-tight ${isVendor ? 'text-purple-100' : 'text-slate-500'}`}>his own material leaving</span>
            </button>
          </div>
          <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold border ${tone.soft}`}>
            {isSite && <>Consumed at site. Total stock goes <b>down</b> and the cost is charged to the project. The site engineer signs.</>}
            {isStore && <>Only moving stores. Total stock is <b>unchanged</b> and <b>no project is charged</b> — one store down, the other up. Both keepers sign.</>}
            {isVendor && <>His own material going home. It leaves our stock and <b>nothing is charged to anybody</b> — this is what the vendor OUT register matches against what he brought in.</>}
          </div>
        </div>

        <div>
          <label className={labelCls}>Out of which store</label>
          <select className={inputCls} value={fromId} onChange={e => { setFromId(e.target.value); setRows([blank()]) }}>
            <option value="">Pick a store…</option>
            {sites.map(site => (
              <optgroup key={site.id} label={site.name}>
                {site.spots.map(sp => (
                  <option key={sp.id} value={sp.id} disabled={!postable.has(sp.id)}>
                    {sp.name}{!postable.has(sp.id) ? ' · not your store' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!scopingOff && (
            <p className="text-[11px] text-slate-500 mt-1">You can only issue from the stores you keep.</p>
          )}
        </div>

        {isStore && (
          <div>
            <label className={labelCls} htmlFor="out-to-store">Into which store</label>
            <select id="out-to-store" className={inputCls} value={toId} onChange={e => setToId(e.target.value)}>
              <option value="">Pick a store…</option>
              {sites.map(site => (
                <optgroup key={site.id} label={site.name}>
                  {site.spots.filter(sp => sp.id !== fromId).map(sp => (
                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {isVendor && (
          <>
            <div>
              <label className={labelCls} htmlFor="out-party">Going back to</label>
              <input id="out-party" className={inputCls} value={party} list="wh-vendor-names"
                onChange={e => setParty(e.target.value)}
                placeholder="The vendor's name, as on his IN entry" />
              <datalist id="wh-vendor-names">
                {vendorNames.map(v => <option key={v} value={v} />)}
              </datalist>
              <p className="text-[11px] text-slate-500 mt-1">
                {vendorNames.length > 0
                  ? 'Pick the same name he came in under — that is what matches the return to what he brought.'
                  : 'Nobody has brought their own material in yet, so there is nothing to match this against.'}
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="out-vendor-project">Which project it was for (optional)</label>
              <select id="out-vendor-project" className={inputCls} value={projectId}
                onChange={e => setProjectId(e.target.value)}>
                <option value="">—</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">Recorded for the balance report only. Nothing is charged.</p>
            </div>
          </>
        )}

        {isSite && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls} htmlFor="out-project">For project</label>
                <select id="out-project" className={inputCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">Pick a project…</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="out-entity">Paid by</label>
                <select id="out-entity" className={inputCls} value={entity} onChange={e => setEntity(e.target.value)}>
                  <option value="">—</option>
                  {entities.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Engineer receiving</label>
              <select className={inputCls} value={engineerId} onChange={e => setEngineerId(e.target.value)}>
                <option value="">—</option>
                {receivers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Signing at the gate covers handover only — he confirms the quantity at site.
              </p>
            </div>
            <div>
              <label className={labelCls}>Coming back?</label>
              <div className="grid grid-cols-2 gap-0 rounded-lg border-2 border-slate-200 overflow-hidden">
                {[false, true].map(v => (
                  <button key={String(v)} type="button" onClick={() => setReturnable(v)}
                    className={`py-2 text-[12.5px] font-bold ${returnable === v ? 'bg-slate-700 text-white' : 'bg-white text-slate-600'}`}>
                    {v ? 'Returnable' : 'Non-returnable'}
                  </button>
                ))}
              </div>
              {returnable && (
                <div className="mt-2">
                  <label className={labelCls}>Expected back by</label>
                  <input type="date" className={inputCls} value={returnDue} onChange={e => setReturnDue(e.target.value)} />
                  <p className="text-[11px] text-slate-500 mt-1">Chased by the returnables ageing list if it does not come back.</p>
                </div>
              )}
            </div>
          </>
        )}

        <hr className="border-slate-100" />

        {!fromId && (
          <p className="text-[12px] text-slate-500">Pick a store first — only what is actually in it can go out.</p>
        )}

        {fromId && here.length === 0 && (
          <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            Nothing in stock in this store yet. Record a Gate IN entry first.
          </p>
        )}

        {fromId && here.length > 0 && rows.map((row, i) => {
          const s = stockOf(row.itemId)
          const over = s ? row.qty > s.qty : false
          return (
            <div key={row.key} className="rounded-lg border border-slate-200 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Item {i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows(rs => rs.filter(r => r.key !== row.key))}
                    className="ml-auto text-slate-400 hover:text-rose-600" aria-label="Remove this item">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <select className={inputCls} value={row.itemId}
                onChange={e => setRows(rs => rs.map(r => r.key === row.key
                  ? { ...r, itemId: e.target.value, rate: null } : r))}>
                <option value="">Pick an item…</option>
                {here.map(s2 => (
                  <option key={s2.itemId} value={s2.itemId}>
                    {s2.itemName} · {formatQty(s2.qty)} {s2.unit} in stock
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Qty</label>
                  <input className={inputCls + ' font-mono'} inputMode="decimal" value={row.qty || ''}
                    onChange={e => setRows(rs => rs.map(r => r.key === row.key
                      ? { ...r, qty: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } : r))} />
                </div>
                <div>
                  <label className={labelCls}>In stock</label>
                  <input className={inputCls + ' bg-slate-100 text-slate-500 font-mono'} readOnly
                    value={s ? `${formatQty(s.qty)} ${s.unit}` : '—'} />
                </div>
              </div>
              {over && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-rose-800">
                  Only {formatQty(s!.qty)} {s!.unit} is in this store. Check the store, or record the missing IN entry first.
                </div>
              )}
            </div>
          )
        })}

        {fromId && here.length > 0 && (
          <button type="button" onClick={() => setRows(rs => [...rs, blank()])}
            className="w-full rounded-lg border-2 border-dashed border-slate-300 py-2 text-[12.5px] font-bold text-slate-500 hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center justify-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add another item
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="out-vehicle">{isStore ? 'Carried by' : 'Vehicle'}</label>
            <input id="out-vehicle" className={inputCls + ' font-mono'} value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="out-remarks">Remarks</label>
            <input id="out-remarks" className={inputCls} value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="rounded-lg border-2 border-slate-200 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600">
            ✍ {isStore ? 'Sending store' : 'Store'}
          </button>
          <button type="button" className="rounded-lg border-2 border-slate-200 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600">
            ✍ {isSite ? 'Engineer' : isStore ? 'Receiving store' : 'Vendor'}
          </button>
        </div>

        <button type="button" disabled={!canEdit || pending} onClick={submit}
          className={`w-full rounded-lg py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2 transition ${tone.bg} ${tone.hover}`}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? 'Saving…' : isSite ? 'Save OUT entry' : isStore ? 'Save move' : 'Save vendor return'}
        </button>
      </div>
    </Card>
  )
}

