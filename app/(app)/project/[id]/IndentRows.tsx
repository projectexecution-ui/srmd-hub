import { formatINR, formatDate } from '@/lib/utils'
import type { IndentRow, ChainStep, IndentItem } from '@/lib/revamp/indents-tree'

/**
 * The pieces of an indent's record that the Indents board (IndentBoard.tsx)
 * shows only when a reader opens a chevron: one line per item, and the
 * full record — the indent's chain, each PO with its chain and receipts.
 * Kept apart so the board file stays about layout.
 */

export const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null)
const qty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const days = (n: number | null) => (n == null ? '' : n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`)

const NEXT_SHORT: Record<IndentItem['next'], string> = {
  'indent approval': 'waiting for indent approval', 'raise PO': 'PO to be raised', 'PO approval': 'PO waiting for approval', 'delivery': 'to be delivered', 'done': 'received', 'closed': 'closed',
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
  if (pendingPo) return { text: `PO ${pendingPo.poNo?.replace(/^PO\/[A-Z0-9]+\//, '') ?? ''} at ${pendingPo.status}${since}`, tone: late ? 'late' : 'wait' }
  const noPo = r.items.filter(i => i.next === 'raise PO').length
  if (noPo) return { text: `Partly ordered — ${noPo} line${noPo === 1 ? '' : 's'} without a PO${since}`, tone: late ? 'late' : 'wait' }
  if (recQty + 0.001 >= poQty) return { text: `Received in full${r.pos.length === 1 ? ` · ${r.pos[0].supplier ?? ''}` : ` · ${r.pos.length} POs`}`, tone: 'ok' }
  return { text: `Received ${qty(recQty)} of ${qty(poQty)}${since}`, tone: late ? 'late' : 'wait' }
}

/** One item under an opened indent: material · quantities · where it stands. */
export function ItemLine({ it, indent = 4 }: { it: IndentItem; indent?: number }) {
  const phrase = it.next === 'done' ? (it.closedForPo && it.poQty + 0.001 < it.qty ? `received in full · closed for PO at ${qty(it.poQty)}` : 'received in full')
    : it.next === 'closed' ? 'closed'
    : `${NEXT_SHORT[it.next]}${it.waitingDays != null && it.waitingDays > 0 ? ` · ${days(it.waitingDays)}` : ''}${it.late ? ' — late' : ''}`
  return (
    <li className="pr-3 py-1.5 text-[12px] flex flex-wrap items-baseline gap-x-3 gap-y-0.5" style={{ paddingLeft: `${indent * 0.5}rem` }}>
      <span className="font-medium text-gray-900">{it.material}</span>
      <span className="tabular-nums text-gray-600">{qty(it.qty)} {it.uom ?? ''}{it.poQty > 0 && it.poQty + 0.001 < it.qty ? ` · ${qty(it.poQty)} ordered` : ''}{it.receivedQty > 0 && it.receivedQty + 0.001 < it.poQty ? ` · ${qty(it.receivedQty)} received` : ''}</span>
      <span className={`ml-auto ${it.next === 'done' ? 'text-emerald-700' : it.next === 'closed' ? 'text-gray-400' : it.late ? 'text-rose-700 font-semibold' : 'text-amber-700'}`}>{phrase}</span>
    </li>
  )
}

/** The full record: the indent's chain, then each PO with its chain and receipts, with the print and ledger links. */
export function Details({ r, indent = 10 }: { r: IndentRow; indent?: number }) {
  const step = (c: ChainStep) => `${c.status}${c.at ? ` ${formatDate(c.at)}` : ''}${c.by ? ` · ${c.by}` : ''}${c.remark ? ` — “${c.remark}”` : ''}`
  const pos = new Map<number, IndentItem['pos'][number]>()
  for (const it of r.items) for (const p of it.pos) if (!pos.has(p.poId)) pos.set(p.poId, p)
  return (
    <div className="pr-3 pb-2 text-[12px] text-gray-600 space-y-1.5" style={{ paddingLeft: `${indent * 0.5}rem` }}>
      {r.remarks && <p className="italic">“{r.remarks}”</p>}
      <p><span className="text-gray-400">Indent · </span>{r.chain.length ? r.chain.map(step).join(' → ') : 'no audit trail in IN4'}{r.woNo ? ` · for ${r.woNo}` : ''}</p>
      {[...pos.values()].map(p => (
        <p key={p.poId}>
          <span className="text-gray-400">PO · </span><span className="text-gray-800">{p.poNo ?? p.poId}</span>{p.supplier ? ` · ${p.supplier}` : ''} · {formatINR(r.items.flatMap(i => i.pos).filter(x => x.poId === p.poId).reduce((t, x) => t + x.value, 0))}
          {p.chain.length > 0 && <> · {p.chain.map(step).join(' → ')}</>}
          {p.grns.length > 0 && <> · received {p.grns.map(g => `${qty(g.qty)}${g.date ? ` on ${formatDate(g.date)}` : ''}`).join(', ')}</>}
          {' · '}<a href={`/api/in4/purchase-order/${p.poId}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">PO</a>
          {' · '}<a href={`/api/in4/purchase-order/${p.poId}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">ledger</a>
        </p>
      ))}
    </div>
  )
}
