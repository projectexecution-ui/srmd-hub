'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { saveGateIn } from '../actions'
import { verdictFor } from '@/lib/warehouse/types'
import type { GateInOptions, GateInLineInput } from '@/lib/warehouse/types'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { formatQty } from '@/lib/warehouse/format'

type Row = GateInLineInput & { key: number }

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const lockCls = inputCls + ' bg-slate-100 text-slate-500'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

let seq = 0
const blankRow = (): Row => ({
  key: ++seq, itemId: '', poLineId: null,
  challanQty: 0, receivedQty: 0, damagedQty: 0, rate: null, rateSource: null,
})

export function GateInForm({
  options, canEdit, showValues,
}: { options: GateInOptions; canEdit: boolean; showValues: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [owner, setOwner] = useState<'srm' | 'vendor'>('srm')
  const [poId, setPoId] = useState('')
  const [noPoReason, setNoPoReason] = useState('')
  const [party, setParty] = useState('')
  const [entity, setEntity] = useState('')
  const [projectId, setProjectId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [deliveryMode, setDeliveryMode] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [driverMobile, setDriverMobile] = useState('')
  const [challanNo, setChallanNo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [rows, setRows] = useState<Row[]>([blankRow()])

  const po = options.pos.find(p => p.id === poId) ?? null
  const itemById = useMemo(() => new Map(options.items.map(i => [i.id, i])), [options.items])

  /** With a PO picked, only its still-pending lines can be received. Without
   *  one, the whole item master is available. */
  const selectableItems = useMemo(() => {
    if (!po) return options.items.map(i => ({ id: i.id, label: i.name, unit: i.unit, poLineId: null as string | null, pending: null as number | null, rate: i.lastRate, done: false }))
    return po.lines.map(l => ({
      id: l.itemId,
      label: l.done ? `${l.itemName} · fully received ✓` : `${l.itemName} · ${formatQty(l.pending)} ${l.unit} pending`,
      unit: l.unit, poLineId: l.lineId, pending: l.pending, rate: l.rate, done: l.done,
    }))
  }, [po, options.items])

  const spots = options.sites.flatMap(s => s.spots)
  const postable = new Set(options.postableSpotIds)

  function patch(key: number, next: Partial<Row>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...next } : r)))
  }

  function pickItem(key: number, itemId: string) {
    const sel = selectableItems.find(s => s.id === itemId)
    patch(key, {
      itemId,
      poLineId: sel?.poLineId ?? null,
      rate: sel?.rate ?? null,
      // A rate that came off the PO is trustworthy. A remembered "last rate"
      // is a convenience — flagged so it can be reviewed. (#4)
      rateSource: sel?.poLineId ? 'po' : sel?.rate ? 'last' : null,
    })
  }

  function submit() {
    start(async () => {
      const res = await saveGateIn({
        owner,
        poId: poId || null,
        poNoText: null,
        noPoReason: poId ? null : noPoReason.trim() || null,
        party, entity: entity || null,
        projectId: projectId || null,
        locationId,
        deliveryMode: deliveryMode || null,
        vehicleNo: vehicleNo || null,
        driverMobile: driverMobile || null,
        challanNo: challanNo || null,
        challanDate: null,
        remarks: remarks || null,
        lines: rows.map(({ key: _key, ...l }) => l),
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success(`Saved ${res.entryNo}`)
      setRows([blankRow()])
      setParty(''); setVehicleNo(''); setDriverMobile(''); setChallanNo(''); setRemarks('')
      setNoPoReason('')
      router.refresh()
    })
  }

  return (
    <Card className="p-0 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-emerald-600 text-white flex items-center gap-2">
        <h3 className="font-bold text-sm">New IN entry</h3>
        <span className="ml-auto font-mono text-[11px] opacity-90">{options.nextEntryNo}</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className={labelCls}>Whose material?</label>
          <div className="grid grid-cols-2 gap-0 rounded-lg border-2 border-emerald-200 overflow-hidden">
            {(['srm', 'vendor'] as const).map(o => (
              <button key={o} type="button" onClick={() => setOwner(o)}
                className={`py-2 text-sm font-bold transition ${owner === o ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-700'}`}>
                {o === 'srm' ? 'SRM' : 'Vendor'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>PO / WO</label>
          <select className={inputCls} value={poId} onChange={e => { setPoId(e.target.value); setRows([blankRow()]) }}>
            <option value="">No PO (emergency)</option>
            {options.pos.map(p => (
              <option key={p.id} value={p.id}>
                {p.poNo} · {p.vendor ?? '—'}{p.entity ? ` · ${p.entity}` : ''}
              </option>
            ))}
          </select>
          {options.pos.length === 0 && (
            <p className="text-[11px] text-slate-500 mt-1">
              No open POs yet — entries can still be recorded without one.
            </p>
          )}
        </div>

        {!poId && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5">
            <label className={labelCls}>Why no PO?</label>
            <input className={inputCls} value={noPoReason} onChange={e => setNoPoReason(e.target.value)}
              placeholder="e.g. urgent site requirement" />
            <p className="text-[11px] text-amber-800 font-semibold mt-1.5">
              This lands on the monthly no-PO exception report. The entry still saves — we never block a truck.
            </p>
          </div>
        )}

        {/* The PO's running balance, so the guard sees what is still due BEFORE
            he types. Completed lines are greyed. */}
        {po && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
            <div className="text-[11px] font-extrabold text-slate-700 mb-1.5">
              {po.poNo} · {statusLabel(po.status)}
              {po.deliveries > 0 && <span className="font-semibold text-slate-500"> · delivery {po.deliveries + 1} of this PO</span>}
            </div>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left font-bold border border-slate-200 bg-slate-100 px-1.5 py-1">Item</th>
                  <th className="text-right font-bold border border-slate-200 bg-slate-100 px-1.5 py-1">Ordered</th>
                  <th className="text-right font-bold border border-slate-200 bg-slate-100 px-1.5 py-1">Got</th>
                  <th className="text-right font-bold border border-slate-200 bg-slate-100 px-1.5 py-1">Pending</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map(l => {
                  const onTruck = rows.find(r => r.poLineId === l.lineId)
                  const after = onTruck ? l.pending - onTruck.receivedQty : null
                  return (
                    <tr key={l.lineId} className={l.done ? 'text-slate-400' : 'text-slate-700'}>
                      <td className="border border-slate-200 px-1.5 py-1">{l.itemName}</td>
                      <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums">{formatQty(l.ordered)}</td>
                      <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums">{formatQty(l.received)}</td>
                      <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums font-bold">
                        {l.done ? '0 ✓' : formatQty(l.pending)}
                        {after !== null && onTruck!.receivedQty > 0 && (
                          <span className={after < 0 ? 'text-rose-600' : 'text-emerald-700'}>
                            {' → '}{after < 0 ? `−${formatQty(-after)} over` : formatQty(after)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Party</label>
            <input className={inputCls} value={party} onChange={e => setParty(e.target.value)}
              placeholder={owner === 'vendor' ? 'Vendor name' : 'Supplier name'} />
          </div>
          <div>
            <label className={labelCls}>Who paid</label>
            <select className={inputCls} value={entity} onChange={e => setEntity(e.target.value)}>
              <option value="">—</option>
              {options.lists.entity.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Project</label>
            <select className={inputCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">—</option>
              {options.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Came by</label>
            <select className={inputCls} value={deliveryMode} onChange={e => setDeliveryMode(e.target.value)}>
              <option value="">—</option>
              {options.lists.deliveryMode.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Vehicle</label>
            <input className={inputCls + ' font-mono'} value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="GJ-05-AB-1234" />
          </div>
          <div>
            <label className={labelCls}>Driver mobile</label>
            <input className={inputCls + ' font-mono'} value={driverMobile} onChange={e => setDriverMobile(e.target.value)} inputMode="tel" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Challan no</label>
          <input className={inputCls + ' font-mono'} value={challanNo} onChange={e => setChallanNo(e.target.value)} />
        </div>

        <hr className="border-slate-100" />

        {rows.map((row, i) => {
          const item = itemById.get(row.itemId)
          const sel = selectableItems.find(s => s.id === row.itemId)
          const poLine = po?.lines.find(l => l.lineId === row.poLineId) ?? null
          const v = verdictFor(row, poLine ? { ordered: poLine.ordered, received: poLine.received } : null)
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

              <select className={inputCls} value={row.itemId} onChange={e => pickItem(row.key, e.target.value)}>
                <option value="">Pick an item…</option>
                {selectableItems.map(s => (
                  <option key={s.id} value={s.id} disabled={s.done}>{s.label}</option>
                ))}
              </select>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Unit · locked</label>
                  <input className={lockCls + ' font-mono'} value={sel?.unit ?? item?.unit ?? ''} readOnly
                    title="The unit comes from the item master and cannot be changed here" />
                </div>
                <div>
                  <label className={labelCls}>Challan qty</label>
                  <input className={inputCls + ' font-mono'} inputMode="decimal" value={row.challanQty || ''}
                    onChange={e => {
                      const n = num(e.target.value)
                      // Typing one number covers the normal day: received
                      // follows the challan until it is deliberately changed.
                      patch(row.key, row.receivedQty === row.challanQty
                        ? { challanQty: n, receivedQty: n }
                        : { challanQty: n })
                    }} />
                </div>
                <div>
                  <label className={labelCls}>Received</label>
                  <input className={inputCls + ' font-mono'} inputMode="decimal" value={row.receivedQty || ''}
                    onChange={e => patch(row.key, { receivedQty: num(e.target.value) })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Damaged</label>
                  <input className={inputCls + ' font-mono'} inputMode="decimal" value={row.damagedQty || ''}
                    onChange={e => patch(row.key, { damagedQty: num(e.target.value) })} />
                </div>
                {showValues && (
                  <div>
                    <label className={labelCls}>
                      Rate ₹ {row.rateSource === 'po' ? '· from PO' : row.rateSource === 'last' ? '· last used' : ''}
                    </label>
                    <input className={(row.rateSource === 'po' ? lockCls : inputCls) + ' font-mono'}
                      inputMode="decimal" readOnly={row.rateSource === 'po'} value={row.rate ?? ''}
                      onChange={e => patch(row.key, { rate: num(e.target.value), rateSource: 'typed' })} />
                  </div>
                )}
              </div>

              {/* Two separate verdicts. Mixing them would flag every part
                  delivery as short, and a report that cries wolf on everything
                  stops being opened. (#9 vs #21) */}
              {row.receivedQty > 0 && (
                <div className="space-y-1.5">
                  <div className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold ${
                    v.shortQty > 0 || v.damagedQty > 0
                      ? 'bg-rose-50 text-rose-800 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                    <b>This challan:</b>{' '}
                    {v.shortQty > 0 && <>short by {formatQty(v.shortQty)} against the challan — recorded against the supplier. </>}
                    {v.damagedQty > 0 && <>{formatQty(v.damagedQty)} damaged, booked as damaged not good stock. </>}
                    {v.shortQty <= 0 && v.damagedQty <= 0 && <>full quantity received, nothing damaged. </>}
                    Good stock: <b>{formatQty(v.goodQty)}</b>
                  </div>
                  {poLine && (
                    <div className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold ${
                      v.poOverBy
                        ? 'bg-rose-50 text-rose-800 border border-rose-200'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                      <b>This PO:</b>{' '}
                      {v.poOverBy
                        ? <>{formatQty(v.poOverBy)} more than ordered. It still saves — we never block a truck — but it goes on the over-receipt report.</>
                        : v.poCompletes
                          ? <>this truck completes it, {formatQty(poLine.ordered)} of {formatQty(poLine.ordered)} received. The PO closes.</>
                          : <>part delivery — {formatQty(poLine.received)} + {formatQty(row.receivedQty)} of {formatQty(poLine.ordered)}. <b>{formatQty(v.poPendingAfter ?? 0)} still to come</b>, nothing wrong here.</>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <button type="button" onClick={() => setRows(rs => [...rs, blankRow()])}
          className="w-full rounded-lg border-2 border-dashed border-slate-300 py-2 text-[12.5px] font-bold text-slate-500 hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center justify-center gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add another item {po ? 'from this PO' : ''}
        </button>

        <div>
          <label className={labelCls}>Into which store</label>
          <select className={inputCls} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">Pick a store…</option>
            {options.sites.map(site => (
              <optgroup key={site.id} label={site.name}>
                {site.spots.map(sp => (
                  <option key={sp.id} value={sp.id} disabled={!postable.has(sp.id)}>
                    {sp.name}{!postable.has(sp.id) ? ' · not your store' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!options.scopingOff && (
            <p className="text-[11px] text-slate-500 mt-1">
              You can only post entries in the stores you keep. You still see stock everywhere.
            </p>
          )}
        </div>

        <div>
          <label className={labelCls}>Remarks</label>
          <input className={inputCls} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </div>

        <button type="button" disabled={!canEdit || pending} onClick={submit}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2 hover:bg-emerald-700 transition">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? 'Saving…' : 'Save IN entry'}
        </button>
        <p className="text-[11px] text-slate-400">
          Entry numbers run in strict order, so a missing number shows up on the gap report.
        </p>
      </div>
    </Card>
  )
}

function num(s: string): number {
  const n = Number(s.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function statusLabel(s: string): string {
  return s === 'partly_received' ? 'Partly received'
    : s === 'fully_received' ? 'Fully received'
    : s === 'short_closed' ? 'Short-closed' : 'Open'
}
