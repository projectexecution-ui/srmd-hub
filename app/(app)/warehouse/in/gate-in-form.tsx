'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { saveGateIn, createItem, loadPoBalance } from '../actions'
import { verdictFor } from '@/lib/warehouse/types'
import type { GateInOptions, GateInLineInput, WhPo } from '@/lib/warehouse/types'
import { Plus, Trash2, Loader2, Camera, FileText } from 'lucide-react'
import { formatQty } from '@/lib/warehouse/format'
import { compressImage } from '@/lib/img/compress'
import { createClient } from '@/lib/supabase/client'

type Row = GateInLineInput & { key: number }

/** One page of the supplier bill, held in the browser until the entry saves. */
type BillPage = { id: string; file: File; preview: string | null }

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
  const supabase = createClient()
  const [pending, start] = useTransition()
  const [, startBalance] = useTransition()

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

  /** The picked PO's balance, fetched when he picks it rather than shipped with
   *  the page — there are over a thousand open POs. */
  const [po, setPo] = useState<WhPo | null>(null)
  const [poLoading, setPoLoading] = useState(false)

  /** Pages of the supplier's bill, held until the entry saves. */
  const [bills, setBills] = useState<BillPage[]>([])
  const [uploading, setUploading] = useState(false)

  function addBills(list: FileList | null) {
    if (!list || list.length === 0) return
    const added: BillPage[] = []
    for (const file of Array.from(list)) {
      if (file.size > 10 * 1024 * 1024 && file.type === 'application/pdf') {
        toast.error(`${file.name} is over 10MB — photograph the pages instead of attaching a big PDF.`)
        continue
      }
      added.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        // A PDF has no thumbnail; it shows as a document tile instead.
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      })
    }
    if (added.length > 0) setBills(bs => [...bs, ...added])
  }

  function removeBill(id: string) {
    setBills(bs => {
      const gone = bs.find(b => b.id === id)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return bs.filter(b => b.id !== id)
    })
  }

  /** Upload every page, in the order he added them, and hand back the paths.
   *
   *  Photographs first go through the same downscale the site reports use —
   *  a phone camera produces 4MB a page, and three of those at a gate on a
   *  patchy connection is a minute of waiting. */
  async function uploadBills(): Promise<string[] | null> {
    if (bills.length === 0) return []
    setUploading(true)
    const paths: string[] = []
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      for (const [i, page] of bills.entries()) {
        const file = page.file.type.startsWith('image/') ? await compressImage(page.file) : page.file
        const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg'
        const path = `${stamp}/${crypto.randomUUID()}-p${i + 1}.${ext}`
        const { error } = await supabase.storage.from('wh-bills')
          .upload(path, file, { cacheControl: '3600', contentType: file.type || 'image/jpeg' })
        if (error) {
          toast.error(`Could not save page ${i + 1} of the bill: ${error.message}`)
          setUploading(false)
          return null
        }
        paths.push(path)
      }
      setUploading(false)
      return paths
    } catch (e) {
      setUploading(false)
      toast.error(e instanceof Error ? e.message : 'Could not save the bill')
      return null
    }
  }
  const itemById = useMemo(() => new Map(options.items.map(i => [i.id, i])), [options.items])

  /** Picking a PO fills in everything the order already knows. IN4 has the
   *  supplier, who is paying and often the project; making the guard retype them
   *  off a screen that is already showing them is how they end up wrong. */
  function pickPo(id: string) {
    setPoId(id)
    setRows([blankRow()])
    setPo(null)
    const head = options.poHeads.find(h => h.id === id)
    if (head) {
      setParty(head.vendor ?? '')
      setEntity(head.entity ?? '')
      if (head.projectId) setProjectId(head.projectId)
    } else {
      // "No PO (emergency)" — clear what the last PO filled in, so nothing is
      // silently carried over onto an entry it does not belong to.
      setParty(''); setEntity(''); setProjectId('')
    }
    if (!id) return
    setPoLoading(true)
    startBalance(async () => {
      const res = await loadPoBalance(id)
      setPoLoading(false)
      if (!res.ok) { toast.error(res.error); return }
      setPo(res.po)

      // Lay the order out ready to fill in. Everything the PO already knows —
      // which materials, and what each costs — is put on screen, because making
      // him pick seven items out of a list the order has already named is work
      // the computer should have done.
      //
      // The QUANTITIES stay blank on purpose. What was ordered is not what
      // arrived; typing what came off the truck IS the job, and a pre-filled
      // quantity is one careless tap away from recording a delivery that never
      // happened.
      const pending = (res.po?.lines ?? []).filter(l => !l.done)
      setRows(pending.length === 0 ? [blankRow()] : pending.map(l => {
        const fallback = itemById.get(l.itemId)?.lastRate ?? null
        const rate = l.rate ?? fallback
        return {
          key: ++seq,
          itemId: l.itemId,
          poLineId: l.lineId,
          challanQty: 0,
          receivedQty: 0,
          damagedQty: 0,
          rate,
          // A rate off the PO is trustworthy and locked. The 1.7% of lines IN4
          // priced at nothing fall back to the last rate we paid, which is
          // editable and flagged so it gets a second look. (#4)
          rateSource: l.rate ? 'po' : rate ? 'last' : null,
        }
      }))
    })
  }

  /** With a PO picked, the choice is WHICH ORDERED LINE this truck is against —
   *  the item on it is IN4's, and is not up for interpretation here. Without a
   *  PO, the whole item list is available. */
  const selectableItems = useMemo(() => {
    if (!po) {
      // Ordered by what the material IS, and the group travels in the hint so
      // typing "plumbing" narrows to plumbing. With 2,803 items, a flat
      // alphabetical list is a scroll, not a search.
      return [...options.items]
        .map(i => ({
          id: i.id, label: i.name, unit: i.unit,
          group: i.category?.trim() || i.discipline?.trim() || 'Not categorised',
          poLineId: null as string | null, pending: null as number | null,
          rate: i.lastRate, done: false,
        }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
    }
    return po.lines.map(l => ({
      id: l.itemId,
      label: l.done
        ? `${l.itemName} · all ${formatQty(l.ordered)} ${l.unit} already received`
        : `${l.itemName} · ${formatQty(l.pending)} ${l.unit} pending`,
      unit: l.unit, group: '', poLineId: l.lineId, pending: l.pending, rate: l.rate, done: l.done,
    }))
  }, [po, options.items])

  const postable = new Set(options.postableSpotIds)

  function patch(key: number, next: Partial<Row>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...next } : r)))
  }

  /** The item the PO line names, whatever the truck actually brought. */
  const poItemOf = (row: Row) =>
    po?.lines.find(l => l.lineId === row.poLineId)?.itemId ?? row.itemId

  function pickItem(key: number, itemId: string) {
    const sel = selectableItems.find(s => s.id === itemId)
    patch(key, {
      itemId,
      poLineId: sel?.poLineId ?? null,
      rate: sel?.rate ?? null,
      // A rate that came off the PO is trustworthy. A remembered "last rate"
      // is a convenience — flagged so it can be reviewed. (#4)
      rateSource: sel?.poLineId ? 'po' : sel?.rate ? 'last' : null,
      // Changing which ordered line this is starts the comparison again.
      differsFromPo: false,
      differNote: null,
    })
  }

  function submit() {
    start(async () => {
      // The bill goes up FIRST. If it fails the entry is not written, so a
      // keeper is never left thinking the paperwork was captured when it was
      // not — he can retry with the truck still at the barrier.
      const photoUrls = await uploadBills()
      if (photoUrls === null) return

      const res = await saveGateIn({
        photoUrls,
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
      for (const b of bills) if (b.preview) URL.revokeObjectURL(b.preview)
      setBills([])
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
          <label className={labelCls} htmlFor="po-pick">PO / WO</label>
          {/* Searchable: there are over a thousand open orders, and he knows the
              PO number or the supplier, not its position in a list. */}
          <SearchableSelect
            id="po-pick"
            value={poId}
            onChange={pickPo}
            options={[
              { id: '', label: 'No PO (emergency)', hint: 'nothing was ordered for this' },
              ...options.poHeads.map(p => ({
                id: p.id,
                label: p.poNo,
                hint: [p.vendor, p.entity, p.projectName].filter(Boolean).join(' · '),
              })),
            ]}
            placeholder="Type a PO number or supplier…"
            emptyText="No open order matches"
          />
          {options.poError && (
            <p className="text-[11px] text-rose-700 mt-1">
              Couldn&apos;t load the orders: {options.poError}
            </p>
          )}
          {!options.poError && options.poHeads.length === 0 && (
            <p className="text-[11px] text-slate-500 mt-1">
              No open POs yet — entries can still be recorded without one.
            </p>
          )}
          {poId && (
            <p className="text-[11px] text-emerald-700 mt-1">
              Supplier, who paid{options.poHeads.find(h => h.id === poId)?.projectId ? ' and project' : ''} filled in
              from the order — change anything that is different.
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
        {poLoading && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11.5px] text-slate-500 inline-flex items-center gap-2 w-full">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching what is still due on this order…
          </div>
        )}
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
          <label className={labelCls} htmlFor="challan-no">Challan no</label>
          <input id="challan-no" className={inputCls + ' font-mono'} value={challanNo} onChange={e => setChallanNo(e.target.value)} />
        </div>

        {/* The bill that came with the truck. Two or three pages is normal, so
            this takes a list and keeps them in page order. */}
        <div className={`rounded-lg border-2 p-2.5 ${
          bills.length === 0 ? 'border-amber-300 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/40'}`}>
          <label className={labelCls}>
            Photo of the bill · <span className="text-rose-600">required</span>
          </label>
          {/* Not a filing formality — what makes the photo worth anything is the
              two signatures and the stamp on it. Said before he shoots, not
              after. */}
          <p className="text-[11.5px] text-slate-700 mb-2 leading-snug">
            Before you photograph it, check the bill carries:
            <span className="block mt-0.5">• the <b>receiver&apos;s signature and stamp</b></span>
            <span className="block">• the <b>delivery person&apos;s signature</b></span>
            <span className="block mt-0.5 text-slate-500">
              This photo is the only record that both sides agreed what came off the truck.
            </span>
          </p>
          {bills.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {bills.map((b, i) => (
                <div key={b.id} className="relative">
                  {b.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.preview} alt={`Bill page ${i + 1}`}
                      className="h-20 w-16 object-cover rounded-lg border border-slate-200" />
                  ) : (
                    <div className="h-20 w-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-slate-400" />
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-slate-900/70 text-white text-[9.5px] font-bold text-center rounded-b-lg py-0.5">
                    Page {i + 1}
                  </span>
                  <button type="button" onClick={() => removeBill(b.id)}
                    aria-label={`Remove page ${i + 1}`}
                    className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-white border border-slate-300 text-slate-500 hover:text-rose-600 flex items-center justify-center shadow-sm">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="w-full rounded-lg border-2 border-dashed border-slate-300 py-2 min-h-[44px] text-[12.5px] font-bold text-slate-500 hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center justify-center gap-1.5 cursor-pointer">
            <Camera className="h-3.5 w-3.5" />
            {bills.length === 0 ? 'Photograph the bill' : 'Add another page'}
            <input type="file" accept="image/*,application/pdf" multiple capture="environment"
              className="sr-only" onChange={e => addBills(e.target.files)} />
          </label>
          <p className="text-[11px] mt-1">
            {bills.length === 0
              ? <span className="text-amber-800 font-semibold">
                  Nothing attached yet — the entry cannot be saved without it. Add every page.
                </span>
              : <span className="text-emerald-800">
                  {bills.length} {bills.length === 1 ? 'page' : 'pages'} attached — they save with the entry.
                  {bills.length === 1 && ' If the bill runs to more than one page, add the rest.'}
                </span>}
          </p>
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

              {/* With a PO the choice is short and specific, so a plain list is
                  right. Without one it is the whole 2,800-item master, which
                  needs searching. */}
              {po ? (() => {
                // A line already sitting on another row of THIS entry is not on
                // offer again — with every pending line laid out up front, an
                // unfiltered list is just an invitation to record the same
                // delivery twice.
                const usedElsewhere = new Set(
                  rows.filter(r => r.key !== row.key && r.poLineId).map(r => r.poLineId as string))
                const free = selectableItems.filter(s => !s.poLineId || !usedElsewhere.has(s.poLineId))
                const stillDue = free.filter(s => !s.done)
                // Fully received lines stay SELECTABLE, in their own group. A
                // truck is never turned away — if more arrives against a
                // completed line that is an over-receipt to be recorded and
                // settled, not something to be blocked at the barrier. (#21)
                const complete = free.filter(s => s.done)
                return (
                  <>
                    <select className={inputCls} value={row.poLineId ? poItemOf(row) : row.itemId}
                      onChange={e => pickItem(row.key, e.target.value)}>
                      <option value="">
                        {stillDue.length > 0 ? 'Which ordered line came?' : 'Nothing left pending on this order'}
                      </option>
                      {stillDue.length > 0 && (
                        <optgroup label="Still to come">
                          {stillDue.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </optgroup>
                      )}
                      {complete.length > 0 && (
                        <optgroup label="Already received in full — pick only if MORE has come">
                          {complete.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </optgroup>
                      )}
                    </select>
                    {stillDue.length === 0 && complete.length === 0 && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Every line on this order is already on this entry. Remove a row to put it back on the list.
                      </p>
                    )}
                  </>
                )
              })() : (
                <SearchableSelect
                  value={row.itemId}
                  onChange={id => pickItem(row.key, id)}
                  options={selectableItems.map(s => ({ id: s.id, label: s.label, hint: [s.group, s.unit].filter(Boolean).join(' · ') }))}
                  placeholder={poLoading ? 'Loading the order…' : 'Search the item list…'}
                  disabled={poLoading}
                  emptyText="No item matches — add it below"
                />
              )}

              {/* IN4 is the base for what was ordered. What actually turned up
                  is the gate's call, so the two are shown together and the
                  difference is recorded rather than argued about. */}
              {poLine && (
                <div className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${
                  row.differsFromPo ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50/70'}`}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                        IN4 ordered
                      </span>
                      <span className="block text-[12px] font-semibold text-slate-800 break-words">
                        {poLine.sourceText || poLine.itemName}
                      </span>
                    </span>
                    {!row.differsFromPo && (
                      <button type="button"
                        onClick={() => patch(row.key, { differsFromPo: true, differNote: '' })}
                        className="flex-shrink-0 rounded-lg border-2 border-slate-200 bg-white px-2.5 py-1.5 min-h-[36px] text-[11.5px] font-bold text-slate-600 hover:border-amber-300 hover:text-amber-800">
                        Not what came?
                      </button>
                    )}
                  </div>

                  {row.differsFromPo && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[11.5px] font-semibold text-amber-900">
                        Record what actually came. The order still counts against this PO line — the difference is
                        flagged for procurement to fix in IN4 and against the bill.
                      </p>
                      <div>
                        <label className={labelCls} htmlFor={`came-${row.key}`}>What actually came</label>
                        <SearchableSelect
                          id={`came-${row.key}`}
                          value={row.itemId}
                          onChange={id => patch(row.key, { itemId: id })}
                          options={[...options.items]
                            .map(i => ({
                              id: i.id, label: i.name,
                              hint: [i.category?.trim() || i.discipline?.trim(), i.unit].filter(Boolean).join(' · '),
                            }))
                            .sort((a, b) => a.hint.localeCompare(b.hint) || a.label.localeCompare(b.label))}
                          placeholder="Search the item list…"
                          emptyText="No item matches — add it below"
                        />
                      </div>
                      <NewItemInline
                        units={options.lists.unit}
                        onCreated={(id) => patch(row.key, { itemId: id })}
                      />
                      <div>
                        <label className={labelCls} htmlFor={`note-${row.key}`}>What is different</label>
                        <input id={`note-${row.key}`} className={inputCls} value={row.differNote ?? ''}
                          onChange={e => patch(row.key, { differNote: e.target.value })}
                          placeholder="e.g. IN4 says 8mm, the truck brought 10mm" />
                      </div>
                      <button type="button"
                        onClick={() => patch(row.key, {
                          differsFromPo: false, differNote: null, itemId: poItemOf(row),
                        })}
                        className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 min-h-[32px]">
                        Never mind — it matches the PO
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Unit · locked</label>
                  <input className={lockCls + ' font-mono'}
                    value={(row.differsFromPo ? item?.unit : sel?.unit ?? item?.unit) ?? ''} readOnly
                    title="The unit belongs to the item and cannot be changed here" />
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

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button type="button" onClick={() => setRows(rs => [...rs, blankRow()])}
            disabled={po ? po.lines.length <= rows.filter(r => r.poLineId).length : false}
            className="rounded-lg border-2 border-dashed border-slate-300 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-500 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500 inline-flex items-center justify-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add another item {po ? 'from this PO' : ''}
          </button>
          {rows.length > 1 && (
            // A truck often brings two of the seven things ordered. Clearing the
            // list is quicker than deleting five rows one at a time.
            <button type="button" onClick={() => setRows([blankRow()])}
              className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-500 hover:border-rose-300 hover:text-rose-700">
              Clear the list
            </button>
          )}
        </div>
        {/* Never a dead button with no explanation. */}
        {po && po.lines.length <= rows.filter(r => r.poLineId).length && (
          <p className="text-[11px] text-slate-500 -mt-1">
            Every line on this order is already on this entry, so there is nothing more to add from it.
            Remove a row to put that line back on the list.
          </p>
        )}
        {po && rows.length > 1 && rows.every(r => r.receivedQty === 0) && (
          <p className="text-[11px] text-slate-500 -mt-1">
            Every item still pending on this order is listed with its rate. Type what actually came off the
            truck and remove the rest — quantities are left blank on purpose, because what was ordered is not
            what arrived.
          </p>
        )}

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

        {/* Blocked, but never silently — it says what is missing. */}
        {bills.length === 0 && (
          <p className="text-[12px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            The signed and stamped bill has to be photographed before this can be saved — with a PO or
            without one.
          </p>
        )}

        <button type="button" disabled={!canEdit || pending || bills.length === 0} onClick={submit}
          className="w-full rounded-lg bg-emerald-600 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2 hover:bg-emerald-700 transition">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploading ? `Saving the bill — ${bills.length} ${bills.length === 1 ? 'page' : 'pages'}…`
            : pending ? 'Saving…' : 'Save IN entry'}
        </button>
        <p className="text-[11px] text-slate-400">
          Entry numbers run in strict order, so a missing number shows up on the gap report.
        </p>
      </div>
    </Card>
  )
}

/** Add an item without leaving the gate screen.
 *
 *  When IN4 named the wrong material, the right one may not be on the books at
 *  all. A keeper who cannot record the truck standing in front of him writes it
 *  on paper instead, and the register loses the entry entirely. */
function NewItemInline({ units, onCreated }: { units: string[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState(units[0] ?? 'Nos')
  const [busy, start] = useTransition()

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-[11.5px] font-bold text-slate-500 hover:text-emerald-700 min-h-[32px] inline-flex items-center gap-1">
        <Plus className="h-3 w-3" /> It is not on the list — add it
      </button>
    )
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-slate-300 p-2 space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <label className={labelCls} htmlFor="new-item-name">New item name</label>
          <input id="new-item-name" className={inputCls} value={name} autoFocus
            onChange={e => setName(e.target.value)} placeholder="As written on the challan" />
        </div>
        <div>
          <label className={labelCls} htmlFor="new-item-unit">Unit</label>
          <select id="new-item-unit" className={inputCls} value={unit} onChange={e => setUnit(e.target.value)}>
            {(units.length ? units : ['Nos', 'Bag', 'MT', 'Kg']).map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">The unit is locked to the item once saved, so get it right now.</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setOpen(false); setName('') }}
          className="rounded-lg border-2 border-slate-200 py-2 min-h-[36px] text-[12px] font-bold text-slate-600">
          Cancel
        </button>
        <button type="button" disabled={busy || !name.trim()}
          onClick={() => start(async () => {
            const res = await createItem({ name, unit })
            if (!res.ok) { toast.error(res.error); return }
            toast.success(`Added ${res.name}`)
            onCreated(res.id)
            setOpen(false); setName('')
          })}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 min-h-[36px] text-[12px] font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add item
        </button>
      </div>
    </div>
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
