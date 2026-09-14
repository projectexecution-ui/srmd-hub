'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, Loader2, Ruler } from 'lucide-react'
import { priceAbstract, type MakerLine } from '@/lib/bills-booking/maker'
import { formatINR, formatNumber } from '@/lib/utils'

/** The Abstract Sheet, filled in CT Hub.
 *
 *  Aksha, 14 Sep 2026: "make the Abstract maker in CT Hub … it should be in
 *  screenshot format" — the concept sheet from the design phase, kept to the
 *  letter: four column groups (Work Order · This bill · Cumulative · Balance),
 *  one row per BOQ item, and ONE typed number per row.
 *
 *  Everything else computes as you type: This Amt, the cumulative, the
 *  balance, GST, retention and the green Net Payable line. The rate is never
 *  editable — it is what the work order ordered, and a rate somebody can
 *  retype is a rate that ends up wrong. */
export function AbstractMaker({ billId, woNo, vendor, work, seed, gstPct, retentionPct, canEdit, raLabel }: {
  billId: string
  woNo: string
  vendor: string
  work: string | null
  seed: MakerLine[]
  gstPct: number
  retentionPct: number
  canEdit: boolean
  /** "RA-4", for the strip along the top. */
  raLabel: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [gst, setGst] = useState(String(gstPct))
  const [ret, setRet] = useState(String(retentionPct))
  const [qty, setQty] = useState<Record<number, string>>(
    () => Object.fromEntries(seed.map(l => [l.sr, l.thisQty ? String(l.thisQty) : ''])))

  const lines: MakerLine[] = useMemo(
    () => seed.map(l => ({ ...l, thisQty: Number(qty[l.sr]) || 0 })), [seed, qty])

  const sheet = useMemo(
    () => priceAbstract(lines, { gstPct: Number(gst) || 0, retentionPct: Number(ret) || 0 }),
    [lines, gst, ret])

  const touched = sheet.lines.filter(l => l.thisQty !== 0).length

  function save() {
    setErr(null)
    start(async () => {
      const { error } = await supabase.rpc('bb_rpc_save_abstract', {
        p_bill: billId,
        p_gst: Number(gst) || 0,
        p_retention: Number(ret) || 0,
        p_lines: sheet.lines.map(l => ({
          item_id: l.itemId, sr: l.sr, particular: l.particular, uom: l.uom,
          ordered_qty: l.orderedQty, rate: l.rate, ordered_amt: l.orderedAmt,
          prior_qty: l.priorQty, prior_amt: l.priorAmt, this_qty: l.thisQty,
        })),
      })
      if (error) { setErr(error.message); return }
      toast.success(`Abstract saved — ${touched} ${touched === 1 ? 'item' : 'items'}, net payable ${formatINR(sheet.netThisBill)}`)
      router.refresh()
    })
  }

  const n = (v: number) => (v === 0 ? '—' : formatNumber(v, v % 1 === 0 ? 0 : 2))
  const m = (v: number) => (v === 0 ? '—' : formatINR(v))

  return (
    <Card className="overflow-hidden p-0">
      {/* Masthead, as on the concept sheet */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-800 px-4 py-3 text-white">
        <Ruler className="h-4 w-4 shrink-0 text-amber-300" />
        <h2 className="text-[15px] font-bold">Abstract Sheet — RA Bill</h2>
        <span className="ml-auto rounded-md bg-amber-300 px-2.5 py-0.5 text-[11px] font-extrabold text-slate-900">
          {raLabel} · {woNo}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-gray-200 px-4 py-3 text-[13px] sm:grid-cols-2">
        <div><dt className="inline w-16 font-semibold text-gray-500">Vendor </dt><dd className="inline">{vendor}</dd></div>
        <div><dt className="inline w-16 font-semibold text-gray-500">WO No </dt><dd className="inline font-mono text-xs">{woNo}</dd></div>
        {work && <div className="sm:col-span-2"><dt className="inline w-16 font-semibold text-gray-500">Work </dt><dd className="inline">{work}</dd></div>}
      </dl>

      {err && <p role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      <div className="overflow-x-auto px-2 pt-2">
        <table className="w-full min-w-[980px] border-collapse text-[12px]">
          <thead>
            <tr>
              <Th l>#</Th><Th l>Particular</Th><Th>Qty</Th><Th>Unit</Th><Th>Rate</Th>
              <Th g="wo">WO Amt</Th>
              <Th g="this">This Qty</Th><Th g="this">This Amt</Th>
              <Th g="cum">Cum Qty</Th><Th g="cum">Cum Amt</Th>
              <Th g="bal">Bal Qty</Th><Th g="bal">Bal Amt</Th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map(l => (
              <tr key={l.sr} className={l.overrun ? 'bg-rose-50' : 'hover:bg-gray-50/60'}>
                <Td l>{l.sr}</Td>
                <Td l className="max-w-[260px] whitespace-normal">{l.particular}</Td>
                <Td>{n(l.orderedQty)}</Td>
                <Td>{l.uom ?? '—'}</Td>
                <Td>{m(l.rate)}</Td>
                <Td g="wo">{m(l.orderedAmt)}</Td>
                <Td g="this">
                  {canEdit ? (
                    <input
                      inputMode="decimal"
                      value={qty[l.sr] ?? ''}
                      onChange={e => setQty(q => ({ ...q, [l.sr]: e.target.value.replace(/[^\d.]/g, '') }))}
                      placeholder="0"
                      aria-label={`Quantity this bill for ${l.particular}`}
                      className="w-[72px] rounded-md border border-slate-300 bg-amber-50/60 px-1.5 py-1 text-right tabular-nums focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  ) : n(l.thisQty)}
                </Td>
                <Td g="this" className="font-semibold">{m(l.thisAmt)}</Td>
                <Td g="cum">{n(l.cumQty)}</Td>
                <Td g="cum">{m(l.cumAmt)}</Td>
                <Td g="bal" className={l.overrun ? 'font-semibold text-rose-700' : l.complete ? 'text-emerald-700' : ''}>
                  {l.overrun ? `over ${n(Math.abs(l.balQty))}` : l.complete ? 'done' : n(l.balQty)}
                </Td>
                <Td g="bal">{m(l.balAmt)}</Td>
              </tr>
            ))}
          </tbody>

          <tbody>
            {sheet.totals.map(t => (
              <tr key={t.kind} className={
                t.kind === 'net' ? 'bg-emerald-700 font-bold text-white'
                  : t.kind === 'retention' ? 'bg-rose-50 font-bold text-rose-900'
                    : t.kind === 'gst' ? 'bg-amber-50 font-bold' : 'bg-slate-50 font-bold'}>
                <td className="border border-gray-100 px-2 py-1.5 text-left" colSpan={6}>
                  {t.label}
                  {t.rate != null && (
                    canEdit
                      ? <> @ <input inputMode="decimal" value={t.kind === 'gst' ? gst : ret}
                              onChange={e => (t.kind === 'gst' ? setGst : setRet)(e.target.value.replace(/[^\d.]/g, ''))}
                              aria-label={`${t.label} percentage`}
                              className="w-[46px] rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-gray-900" />%</>
                      : <> @ {t.rate}%</>
                  )}
                </td>
                <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>
                  {t.kind === 'retention' && t.thisBill > 0 ? '− ' : ''}{m(t.thisBill)}
                </td>
                <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>
                  {t.kind === 'retention' && t.cumulative > 0 ? '− ' : ''}{m(t.cumulative)}
                </td>
                <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>{m(t.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 px-4 py-3">
        <Chip k="This bill — net payable" v={formatINR(sheet.netThisBill)} tone="green" />
        <Chip k="Cumulative billed" v={formatINR(sheet.totals[2].cumulative)} />
        <Chip k="Retention held (running)" v={formatINR(sheet.totals[3].cumulative)} tone="red" />
        {canEdit && (
          <Button onClick={save} disabled={busy} className="ml-auto bg-indigo-600 hover:bg-indigo-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save abstract
          </Button>
        )}
      </div>

      {sheet.anyOverrun && (
        <p className="border-t border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          Lines marked <b>over</b> are measured past the quantity ordered. That needs an amendment in IN4 before
          payment — it does not stop the sheet being saved or the bill being checked.
        </p>
      )}

      <p className="px-4 pb-4 pt-2 text-[11.5px] text-gray-500">
        You type only <b>This Qty</b>. This Amt, Cumulative, Balance, GST, Retention and Net Payable all compute.
        The rate is what the work order ordered and is not editable here. Saving writes the figures onto the bill and
        leaves a line in its history.
      </p>
    </Card>
  )
}

function Th({ children, l, g }: { children: React.ReactNode; l?: boolean; g?: 'wo' | 'this' | 'cum' | 'bal' }) {
  const bg = g === 'this' ? 'bg-blue-100' : g === 'cum' ? 'bg-emerald-50' : g === 'wo' ? 'bg-slate-100' : g === 'bal' ? 'bg-gray-50' : 'bg-slate-100'
  return (
    <th className={`border border-gray-200 px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-700 ${bg} ${l ? 'text-left' : 'text-right'}`}>
      {children}
    </th>
  )
}
function Td({ children, l, g, className = '' }: { children: React.ReactNode; l?: boolean; g?: 'wo' | 'this' | 'cum' | 'bal'; className?: string }) {
  const bg = g === 'this' ? 'bg-blue-50/70' : g === 'cum' ? 'bg-emerald-50/40' : g === 'wo' ? 'bg-slate-50/60' : ''
  return (
    <td className={`border border-gray-100 px-2 py-1 tabular-nums ${bg} ${l ? 'text-left' : 'text-right'} ${className}`}>
      {children}
    </td>
  )
}
function Chip({ k, v, tone }: { k: string; v: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
      <div className={`text-base font-extrabold tabular-nums ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-gray-900'}`}>{v}</div>
    </div>
  )
}
