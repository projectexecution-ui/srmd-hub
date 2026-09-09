import { Fragment } from 'react'
import { formatINR, formatDate } from '@/lib/utils'
import { RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import type { IndentRow, ChainStep, IndentItem } from '@/lib/revamp/indents-tree'
import { lineRate, pendingValue, shortRef, supplierOf } from '@/lib/revamp/indents-board'

/**
 * The parts of an indent's record the Indents board (IndentBoard.tsx) shows
 * under a chevron: the item-wise table in the Internal Estimate's shape
 * (# · Description · Unit · Qty · Rate · Amount, then what came in), and the
 * full record — the indent's chain, each PO with its chain and receipts.
 */

export const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null)
const qty = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const days = (n: number | null) => (n == null ? '' : n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`)
const Dash = () => <span className="text-gray-300">—</span>

const NEXT_SHORT: Record<IndentItem['next'], string> = {
  'indent approval': 'waiting for indent approval', 'raise PO': 'PO to be raised', 'PO approval': 'PO waiting for approval', 'delivery': 'to be delivered', 'done': 'received in full', 'closed': 'closed',
}

/** One phrase for where an indent stands. Pure. */
export function cycleSummary(r: IndentRow): { text: string; tone: 'ok' | 'wait' | 'late' | 'muted' } {
  const waiting = r.items.filter(i => i.next !== 'done' && i.next !== 'closed')
  const late = waiting.some(i => i.late)
  const d = Math.max(0, ...waiting.map(i => i.waitingDays ?? 0))
  const since = waiting.length && d > 0 ? ` · ${days(d)}` : ''
  if (r.stage === 'closed') return { text: r.status, tone: 'muted' }
  if (r.stage === 'draft') return { text: 'Still a draft in IN4', tone: 'muted' }
  if (r.stage === 'submitted') return { text: `Submitted, waiting to be verified${since}`, tone: late ? 'late' : 'wait' }
  if (r.stage === 'verify') return { text: `At Verify, waiting for approval${since}`, tone: late ? 'late' : 'wait' }
  const poQty = r.items.reduce((t, i) => t + i.poQty, 0)
  const recQty = r.items.reduce((t, i) => t + i.receivedQty, 0)
  if (r.pos.length === 0) return { text: `Approved, no PO yet${since}`, tone: late ? 'late' : 'wait' }
  const pendingPo = r.pos.find(p => p.stage !== 'approved')
  if (pendingPo) return { text: `PO ${shortRef(pendingPo.poNo)} at ${pendingPo.status}${since}`, tone: late ? 'late' : 'wait' }
  const noPo = r.items.filter(i => i.next === 'raise PO').length
  if (noPo) return { text: `Partly ordered — ${noPo} line${noPo === 1 ? '' : 's'} without a PO${since}`, tone: late ? 'late' : 'wait' }
  if (recQty + 0.001 >= poQty) return { text: `Received in full${r.pos.length === 1 ? ` · ${r.pos[0].supplier ?? ''}` : ` · ${r.pos.length} POs`}`, tone: 'ok' }
  return { text: `Received ${qty(recQty)} of ${qty(poQty)}${since}`, tone: late ? 'late' : 'wait' }
}

/** Where one line stands, in words, with the PO and the wait. */
export function itemStatus(it: IndentItem): { text: string; tone: 'ok' | 'wait' | 'late' | 'muted' } {
  if (it.next === 'done') return { text: it.closedForPo && it.poQty + 0.001 < it.qty ? `received in full · closed for PO in IN4 at ${qty(it.poQty)}` : 'received in full', tone: 'ok' }
  if (it.next === 'closed') return { text: 'closed', tone: 'muted' }
  const po = it.pos.find(p => p.stage !== 'approved') ?? it.pos.find(p => p.grnQty + 0.001 < p.qty)
  const where = it.next === 'PO approval' && po ? `PO ${shortRef(po.poNo)} at ${po.status}` : it.next === 'delivery' && po ? `PO ${shortRef(po.poNo)}${it.receivedQty > 0 ? ` · ${qty(it.receivedQty)} in` : ''}` : NEXT_SHORT[it.next]
  return { text: `${where}${it.waitingDays != null && it.waitingDays > 0 ? ` · ${days(it.waitingDays)}` : ''}${it.late ? ' — late' : ''}`, tone: it.late ? 'late' : 'wait' }
}

const TONE = { ok: 'text-emerald-700', wait: 'text-amber-700', late: 'text-rose-700 font-semibold', muted: 'text-gray-400' } as const

/**
 * The indent's items as their own table inside one full-width cell — the
 * same shape the Internal Estimate uses for a sub-skill's item-wise BOQ and
 * the orders tree for a PO's lines, so a reader who knows one knows all.
 */
export function IndentItems({ r, idPrefix }: { r: IndentRow; idPrefix: string }) {
  const rate = (it: IndentItem) => lineRate(it)
  const poTotal = r.items.reduce((t, i) => t + i.poValue, 0)
  const recTotal = r.items.reduce((t, i) => t + i.receivedValue, 0)
  const toCome = r.items.reduce((t, i) => t + pendingValue(i), 0)
  const detailId = `${idPrefix}:record`
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
        <span className="text-[12px] font-semibold text-gray-900">
          {shortRef(r.ref)}
          <span className="ml-2 font-normal text-gray-500">
            {r.items.length} line item{r.items.length === 1 ? '' : 's'}{r.date ? ` · ${formatDate(r.date)}` : ''}{r.raisedBy ? ` · ${r.raisedBy}` : ''}{r.woNo ? ` · for ${r.woNo}` : ''}
          </span>
        </span>
        <span className="text-[12px] tabular-nums text-gray-700">
          PO’d <b className="text-gray-900">{formatINR(poTotal)}</b>
          {' · '}Received <b className="text-gray-900">{formatINR(recTotal)}</b>
          {toCome > 0.5 && <>{' · '}To come <b className="text-amber-700">{formatINR(toCome)}</b></>}
        </span>
      </div>

      {/* Desktop: the Internal Estimate's columns, then what came in. */}
      <table className="w-full table-fixed text-[12px] hidden md:table">
        <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[4%]">#</th>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[26%]">Description</th>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[6%]">Unit</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[8%]">Qty</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[8%]">PO qty</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[9%]">Rate</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[11%]">Amount</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[8%] text-emerald-700">Received qty</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[11%] text-emerald-700">Received value</th>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[9%]">Where it stands</th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((it, i) => {
            const st = itemStatus(it)
            const sup = supplierOf(it)
            return (
              <tr key={it.id} className="border-t border-gray-100">
                <td className="px-2 py-1.5 text-gray-400 align-top">{i + 1}</td>
                <td className="px-2 py-1.5 text-gray-800 align-top">
                  <p className="truncate" title={it.material}>{it.material}</p>
                  {sup && <p className="text-[12px] text-gray-400 leading-snug truncate">{sup}{it.pos.length === 1 ? ` · PO ${shortRef(it.pos[0].poNo)}` : it.pos.length > 1 ? ` · ${it.pos.length} POs` : ''}</p>}
                </td>
                <td className="px-2 py-1.5 text-gray-600 align-top">{it.uom ?? ''}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top">{qty(it.qty)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top">{it.poQty > 0 ? qty(it.poQty) : <Dash />}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top">{rate(it) == null ? <Dash /> : formatINR(rate(it))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold align-top">{it.poValue > 0.5 ? formatINR(it.poValue) : <Dash />}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top text-emerald-800">{it.receivedQty > 0 ? qty(it.receivedQty) : <Dash />}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top text-emerald-800 font-semibold">{it.receivedValue > 0.5 ? formatINR(it.receivedValue) : <Dash />}</td>
                <td className={`px-2 py-1.5 align-top text-[12px] ${TONE[st.tone]}`}>{st.text}</td>
              </tr>
            )
          })}
          <tr className="border-t border-gray-300 bg-gray-100/70">
            <td />
            <td className="px-2 py-2 font-bold text-gray-900">Lines total</td>
            <td colSpan={4} />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{poTotal > 0.5 ? formatINR(poTotal) : <Dash />}</td>
            <td />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-emerald-800">{recTotal > 0.5 ? formatINR(recTotal) : <Dash />}</td>
            <td />
          </tr>
        </tbody>
      </table>

      {/* Mobile: one card per line, the same figures in the same order. */}
      <ul className="md:hidden divide-y divide-gray-100">
        {r.items.map((it, i) => {
          const st = itemStatus(it)
          return (
            <li key={it.id} className="px-3 py-2">
              <p className="text-[12px] text-gray-800"><span className="text-gray-400 mr-1.5">{i + 1}.</span>{it.material}</p>
              <p className="text-[12px] text-gray-500 tabular-nums">{qty(it.qty)} {it.uom ?? ''}{it.poQty > 0 ? ` · PO qty ${qty(it.poQty)}` : ''}{lineRate(it) != null ? ` · @ ${formatINR(lineRate(it))}` : ''}{it.poValue > 0.5 ? ` · ${formatINR(it.poValue)}` : ''}</p>
              {it.receivedQty > 0 && <p className="text-[12px] text-emerald-800 tabular-nums">Received {qty(it.receivedQty)} · {formatINR(it.receivedValue)}</p>}
              <p className={`text-[12px] ${TONE[st.tone]}`}>{st.text}</p>
            </li>
          )
        })}
      </ul>

      <div className="px-3 py-1.5 border-t border-gray-100 flex items-center gap-1 text-[12px] text-gray-500">
        <RowDetailToggle id={detailId} count={1} label="the audit trail, POs and receipts" />
        <span>Who did what and when · POs · receipts</span>
      </div>
      <RowDetail id={detailId}><Details r={r} /></RowDetail>
    </div>
  )
}

/** The full record: the indent's chain, then each PO with its chain and receipts, with the print and ledger links. */
export function Details({ r }: { r: IndentRow }) {
  const step = (c: ChainStep) => `${c.status}${c.at ? ` ${formatDate(c.at)}` : ''}${c.by ? ` · ${c.by}` : ''}${c.remark ? ` — “${c.remark}”` : ''}`
  const pos = new Map<number, IndentItem['pos'][number]>()
  for (const it of r.items) for (const p of it.pos) if (!pos.has(p.poId)) pos.set(p.poId, p)
  return (
    <div className="px-3 pb-2 text-[12px] text-gray-600 space-y-1.5 border-t border-gray-100 pt-2 bg-gray-50/60 rounded-b-lg">
      {r.remarks && <p className="italic">“{r.remarks}”</p>}
      <p><span className="text-gray-400">Indent · </span>{r.chain.length ? r.chain.map(step).join(' → ') : 'no audit trail in IN4'}</p>
      {[...pos.values()].map(p => (
        <Fragment key={p.poId}>
          <p>
            <span className="text-gray-400">PO · </span><span className="text-gray-800">{p.poNo ?? p.poId}</span>{p.supplier ? ` · ${p.supplier}` : ''} · {formatINR(r.items.flatMap(i => i.pos).filter(x => x.poId === p.poId).reduce((t, x) => t + x.value, 0))}
            {p.chain.length > 0 && <> · {p.chain.map(step).join(' → ')}</>}
            {p.grns.length > 0 && <> · received {p.grns.map(g => `${qty(g.qty)}${g.date ? ` on ${formatDate(g.date)}` : ''}`).join(', ')}</>}
            {' · '}<a href={`/api/in4/purchase-order/${p.poId}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">PO</a>
            {' · '}<a href={`/api/in4/purchase-order/${p.poId}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">ledger</a>
          </p>
        </Fragment>
      ))}
    </div>
  )
}
