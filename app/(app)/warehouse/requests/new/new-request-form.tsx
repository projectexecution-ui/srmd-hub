'use client'

import { useState, useTransition, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { ItemPicker } from '@/components/warehouse/ItemPicker'
import type { PickerItem } from '@/components/warehouse/ItemPicker'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { raiseRequest, checkStock, storeStock, addCatalogueItem } from '../../request-actions'
import { estimateValue, raiseBlocker, foldStock } from '@/lib/warehouse/requests'
import type { ShortLine } from '@/lib/warehouse/requests'
import { waitingOn } from '@/lib/warehouse/approval-matrix'
import type { Rule } from '@/lib/warehouse/approval-matrix'
import type { WhItem } from '@/lib/warehouse/types'
import {
  Loader2, Plus, Trash2, Stamp, TriangleAlert, Info, Send, ChevronDown,
} from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[42px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

type Row = {
  key: string
  itemId: string
  itemName: string
  unit: string
  inStore: number
  qty: string
  remarks: string
  returnable: boolean
}
const blank = (): Row => ({
  key: Math.random().toString(36).slice(2),
  itemId: '', itemName: '', unit: '', inStore: 0,
  qty: '', remarks: '', returnable: false,
})

export function NewRequestForm({
  items, projects, rules, roleLabels, today,
}: {
  items: WhItem[]
  projects: Array<{ id: string; name: string }>
  rules: Rule[]
  roleLabels: Record<string, string>
  today: string
}) {
  const router = useRouter()
  const [busy, start] = useTransition()


  // No "send it to another store" here. An engineer asking for material is
  // asking for his own site, full stop; store-to-store movement is the
  // keeper's business and is done from Gate OUT, where the stock actually is.
  const toLocationId = null
  const [projectId, setProject] = useState('')
  const [purpose, setPurpose] = useState('')
  const [needBy, setNeedBy] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [short, setShort] = useState<ShortLine[]>([])
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [catalogue, setCatalogue] = useState<PickerItem[]>([])

  // No source store, and no destination store either: the engineer says what he
  // needs and the keeper decides
  // which of nine stores serves it. That also means the cross-project returnable
  // rule cannot be judged here — it is applied at Gate OUT, where the store is
  // finally known. The tick below is therefore the engineer's own call again.

  // The catalogue with TOTAL stock folded in — across every store, since no one
  // store has been chosen. The picker separates "we hold some" from "we hold
  // none anywhere", which is the only distinction that helps before a keeper
  // decides where it comes from.
  useEffect(() => {
    let live = true
    const base: PickerItem[] = items.map(i => ({
      id: i.id, name: i.name, code: i.code, unit: i.unit, category: i.category, inStore: 0,
    }))
    const load = async () => {
      const held = await storeStock(null)
      if (!live) return
      const folded = foldStock(held)
      setCatalogue(base.map(i => ({ ...i, inStore: folded.get(i.id)?.qty ?? 0 })))
    }
    void load()
    return () => { live = false }
  }, [items])

  const lines = useMemo(() => rows
    .filter(r => r.itemId && Number(r.qty) > 0)
    .map(r => ({
      itemId: r.itemId, qty: Number(r.qty),
      note: r.remarks.trim() || null,
      isReturnable:  r.returnable,
    })), [rows])

  const est = useMemo(() => {
    const byId = new Map(items.map(i => [i.id, i]))
    return estimateValue(lines.map(l => ({ qty: l.qty, lastRate: byId.get(l.itemId)?.lastRate ?? null })))
  }, [lines, items])
  const anyPriced = useMemo(() => {
    const byId = new Map(items.map(i => [i.id, i]))
    return lines.some(l => byId.get(l.itemId)?.lastRate != null)
  }, [lines, items])

  const preview = waitingOn(rules, 'pending', anyPriced ? est.value : null,
    r => roleLabels[r] ?? r, formatINR)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      if (lines.length === 0) { if (live) setShort([]); return }
      const s = await checkStock(null, lines.map(l => ({ itemId: l.itemId, qty: l.qty })))
      if (live) setShort(s)
    }, 450)
    return () => { live = false; clearTimeout(t) }
  }, [lines])

  const blocker = raiseBlocker({
    fromLocationId: null, toLocationId, projectId: projectId || null,
    purpose, needBy: needBy || null, lines,
  }, today)

  function setRow(key: string, patch: Partial<Row>) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm">
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="req-proj">For which project?</label>
            <select id="req-proj" className={inputCls} value={projectId}
              onChange={e => setProject(e.target.value)}>
              <option value="">— not project-specific —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="req-purpose">What is it for?</label>
            <input id="req-purpose" className={inputCls} value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="Slab shuttering at NGH B, pour on Thursday" />
          </div>
          <div>
            <label className={labelCls} htmlFor="req-need">Needed by</label>
            <input id="req-need" type="date" className={inputCls} value={needBy} min={today}
              onChange={e => setNeedBy(e.target.value)} />
          </div>

        </div>
      </Card>

      {/* Items, in the V1 sheet layout: a header with Add row on the right, then
          one row per line carrying qty, remarks and its own Returnable tick. */}
      <Card className="p-3 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-bold text-slate-800">Items</p>
          <button type="button" onClick={() => setRows(rs => [...rs, blank()])}
            className="rounded-lg border-2 border-slate-200 px-2.5 py-1.5 min-h-[44px] text-[12px] font-bold
                       text-slate-600 hover:border-emerald-300 hover:text-emerald-700
                       inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add row
          </button>
        </div>

        {rows.map(row => (
          <div key={row.key} className="rounded-xl border border-slate-200 p-2 space-y-2">
            {/* On a phone the item gets its own row and qty · remarks · bin share
                the next one. Cramming four controls onto one 375px line put the
                quantity box off the edge of the screen.
                `min-w-0` on the picker is what actually stops the overflow: a
                grid item defaults to min-width:auto, so a long IN4 material name
                sets the column's floor and `truncate` never gets a chance. */}
            <div className="grid grid-cols-[96px_1fr_auto] sm:grid-cols-[1fr_92px_1fr_auto]
                            gap-2 items-start">
              {/* A picker, not a dropdown — 2,803 items is a browsing job. */}
              <button type="button" onClick={() => setPickFor(row.key)}
                className={`${inputCls} min-w-0 col-span-3 sm:col-span-1 text-left
                            flex items-center justify-between gap-2 ${
                  row.itemId ? 'text-slate-900' : 'text-slate-400'}`}>
                <span className="truncate">{row.itemName || '— Select item —'}</span>
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
              </button>

              <input className={`${inputCls} min-w-0`} inputMode="decimal" value={row.qty}
                aria-label="Quantity" placeholder="qty"
                onChange={e => setRow(row.key, { qty: e.target.value })} />

              <input className={`${inputCls} min-w-0`} value={row.remarks}
                aria-label="Remarks" placeholder="remarks"
                onChange={e => setRow(row.key, { remarks: e.target.value })} />

              <button type="button" aria-label="Remove this row" disabled={rows.length === 1}
                onClick={() => setRows(rs => rs.filter(r => r.key !== row.key))}
                className="rounded-lg border-2 border-slate-200 px-2 py-2 min-h-[42px] text-rose-500
                           hover:border-rose-300 hover:bg-rose-50 disabled:opacity-30">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap px-0.5">
              {/* Per LINE, not per request: one pour routinely mixes cement that
                  gets consumed with shuttering that has to come back. */}
              <label className="flex items-start gap-2 text-[11.5px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={row.returnable}
                  className="mt-0.5 h-3.5 w-3.5"
                  onChange={e => setRow(row.key, { returnable: e.target.checked })} />
                <span>Returnable <span className="text-slate-400">
                  (tool / formwork — must come back)
                </span></span>
              </label>
              {row.itemId && (
                <span className={`text-[11px] font-semibold ${
                  row.inStore > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {row.inStore > 0
                    ? `${formatQty(row.inStore)} ${row.unit} in stock`
                    : 'none in any store'}
                </span>
              )}
            </div>
          </div>
        ))}
      </Card>

      {short.length > 0 && (
        <Card className="p-3 shadow-sm bg-amber-50 border-amber-200 space-y-1">
          <p className="text-[12.5px] font-bold text-amber-900 flex items-center gap-1.5">
            <TriangleAlert className="h-4 w-4" /> This store has less than you asked for
          </p>
          {short.map(s => (
            <p key={s.itemName} className="text-[12px] text-amber-900">
              <b>{s.itemName}</b> — you want {formatQty(s.wanted)} {s.unit}, the store holds{' '}
              {formatQty(s.available)} {s.unit}
            </p>
          ))}
          <p className="text-[11.5px] text-amber-800 pt-0.5">
            You can still ask. A request for material a store is out of is how it gets ordered.
          </p>
        </Card>
      )}

      <Card className="p-3 shadow-sm bg-slate-50 border-slate-200">
        <p className="text-[12.5px] text-slate-700 flex items-start gap-2">
          <Stamp className="h-4 w-4 flex-shrink-0 mt-0.5 text-slate-500" />
          <span>{preview}</span>
        </p>
      </Card>

      {blocker && lines.length > 0 && (
        <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex gap-1.5">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
          <span>{blocker}</span>
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" disabled={busy || !!blocker}
          onClick={() => start(async () => {
            const res = await raiseRequest({
              fromLocationId: null, toLocationId, projectId: projectId || null,
              purpose, needBy: needBy || null, lines,
            })
            if (!res.ok) { toast.error(res.error, { duration: 9000 }); return }
            toast.success(res.waiting
              ? `${res.reqNo} raised — waiting for approval`
              : `${res.reqNo} raised — it is with the storekeeper`)
            router.push(`/warehouse/requests/${res.id}`)
          })}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 min-h-[46px] text-[13px] font-bold text-white
                     hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit request
        </button>
        <button type="button" onClick={() => router.push('/warehouse/requests')} disabled={busy}
          className="rounded-lg border-2 border-slate-200 px-4 py-2.5 min-h-[46px] text-[13px] font-bold text-slate-500">
          Cancel
        </button>
      </div>

      <ItemPicker
        open={pickFor !== null}
        onClose={() => setPickFor(null)}
        items={catalogue}
        storeName={null}
        alreadyOn={rows.filter(r => r.key !== pickFor && r.itemId).map(r => r.itemId)}
        onPick={it => {
          if (!pickFor) return
          setRow(pickFor, {
            itemId: it.id, itemName: it.name, unit: it.unit, inStore: it.inStore,
          })
        }}
        onCreate={async (name, unit) => {
          const res = await addCatalogueItem(name, unit)
          if (!res.ok || !res.id) return { ok: false, error: res.error }
          // Drop it straight onto the row that opened the picker, so nobody is
          // sent back to hunt for what they just created.
          if (pickFor) setRow(pickFor, { itemId: res.id, itemName: name, unit, inStore: 0 })
          setCatalogue(c => [{ id: res.id!, name, code: null, unit, category: null, inStore: 0 }, ...c])
          setPickFor(null)
          toast.success(`${name} added to the catalogue`)
          return { ok: true }
        }}
      />
    </div>
  )
}
