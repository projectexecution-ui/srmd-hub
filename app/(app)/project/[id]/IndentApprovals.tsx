import { Fragment } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { SLA_DAYS, type IndentRow, type IndentItem, type PendingApproval, type ChainStep } from '@/lib/revamp/indents-tree'
import { shortRef, cleanName, meaningfulRemark, type BoardRow } from '@/lib/revamp/indents-board'
import { loadPriceContext, referenceRate, priceDelta, type MaterialContext } from '@/lib/revamp/approver'
import { daysSince, History } from './IndentRows'

/**
 * Waiting for approval — the approver's table. One row per document waiting
 * in IN4 (an indent at Verify, a PO at Verify), in the Internal Estimate's
 * table style, and under each — open by default, there are only a few — the
 * item-wise table an approver actually decides on:
 *
 *   indent: # · Material · Unit · Qty · Last rate (who, when) · Est. amount ·
 *           Bought on this project so far
 *   PO:     # · Material · Unit · Indent qty · PO qty · Rate · vs last paid ·
 *           Amount
 *
 * then the history (who raised, verified, sent back) and the remarks. The
 * price context is live from IN4 for just these materials. Approval itself
 * happens in IN4.
 */
export async function IndentApprovals({ pending, rows, q, manyProjects }: { pending: PendingApproval[]; rows: BoardRow[]; q?: string; manyProjects: boolean }) {
  const needle = q?.toLowerCase()
  const list = needle ? pending.filter(p => [p.ref, p.what, p.by, p.context, p.project].map(x => (x ?? '').toLowerCase()).join(' | ').includes(needle)) : pending
  if (pending.length === 0) return <Calm text="Nothing is waiting for approval in IN4." />

  // The documents behind the pending rows.
  const indentById = new Map<number, IndentRow>()
  const catOfIndent = new Map<number, string>()
  for (const r of rows) { indentById.set(r.indent.id, r.indent); if (!catOfIndent.has(r.indent.id)) catOfIndent.set(r.indent.id, r.category) }
  const poLines = (poId: number) => {
    const seen = new Set<number>()
    return rows.filter(r => r.item.pos.some(p => p.poId === poId) && !seen.has(r.item.id) && (seen.add(r.item.id), true))
  }
  const docs = list.map(p => {
    if (p.kind === 'indent') { const r = indentById.get(p.id); return { p, indent: r ?? null, items: r?.items ?? [], lines: [] as BoardRow[] } }
    const lines = poLines(p.id)
    return { p, indent: lines[0]?.indent ?? null, items: lines.map(l => l.item), lines }
  })
  const materialIds = docs.flatMap(d => d.items.map(i => i.materialId))
  const projectIds = new Set(docs.map(d => d.indent?.projectId).filter((x): x is number => x != null))
  const projectId = projectIds.size === 1 ? [...projectIds][0] : null
  const ctx = await loadPriceContext(materialIds, projectId)

  const total = (d: (typeof docs)[number]) => d.p.kind === 'po'
    ? d.lines.reduce((t, l) => t + l.item.pos.filter(x => x.poId === d.p.id).reduce((s, x) => s + x.value, 0), 0)
    : d.items.reduce((t, it) => { const ref = referenceRate(ctx.byMaterial.get(it.materialId ?? -1)); return t + (ref ? ref.rate * it.qty : 0) }, 0)

  return (
    <RowDetailProvider initialOpen={docs.map(d => `ap:${d.p.kind}:${d.p.id}`)}>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-900">
            Waiting for approval in IN4
            <span className="ml-2 text-[12px] font-normal text-gray-500">{list.length} document{list.length === 1 ? '' : 's'} · oldest first · approve in IN4</span>
          </span>
          {ctx.in4 !== 'live' && <span className="text-[12px] text-amber-800 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {ctx.in4 === 'not-configured' ? 'No IN4 login on this deployment — last rates are blank.' : 'IN4 did not answer for the price history — last rates are blank.'}</span>}
        </div>
        {docs.length === 0 ? <div className="p-3"><Calm text={`Nothing matches “${q}”.`} /></div> : (
          <div className="overflow-auto max-h-[75vh]">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <Th className="min-w-[280px]">Document</Th>
                  <Th className="w-56">Category · for</Th>
                  <Th className="w-44">Raised by</Th>
                  <Th className="text-right w-20">Items</Th>
                  <Th className="text-right w-36">{docs.some(d => d.p.kind === 'po') && docs.some(d => d.p.kind === 'indent') ? 'Value / est.' : docs.some(d => d.p.kind === 'po') ? 'PO value' : 'Est. value'}</Th>
                  <Th className="text-right w-24">Waiting</Th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => {
                  const key = `ap:${d.p.kind}:${d.p.id}`
                  const days = daysSince(d.p.since)
                  const late = days != null && days > SLA_DAYS['indent approval']
                  const cat = d.indent ? catOfIndent.get(d.indent.id) : undefined
                  const value = total(d)
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-gray-200 bg-gray-50/60">
                        <td className="px-3 py-2">
                          <RowDetailToggle id={key} count={d.items.length} label="the items" />
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mr-2">{d.p.kind === 'indent' ? 'Indent' : 'PO'}</span>
                          <span className="font-semibold text-gray-900">{shortRef(d.p.ref)}</span>
                          <span className="text-gray-500"> · {d.p.status}</span>
                          {d.indent?.date && <span className="ml-2 text-[12px] text-gray-500">{formatDate(d.indent.date)}</span>}
                          {d.p.kind === 'po' && d.p.what && <span className="block ml-6 text-[12px] text-gray-600">{d.p.what}</span>}
                          {d.p.kind === 'indent' && meaningfulRemark(d.indent?.remarks) && <span className="block ml-6 text-[12px] text-gray-600 italic">“{meaningfulRemark(d.indent?.remarks)}”</span>}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-gray-600">
                          {cat && <span className="block">{cleanName(cat)}</span>}
                          {d.indent?.woNo && <span className="block text-gray-500">for {d.indent.woNo}</span>}
                          {(manyProjects || !projectId) && (d.indent?.subproject ?? d.p.project) && <span className="block text-gray-500">{d.indent?.subproject ?? d.p.project}</span>}
                          {d.p.kind === 'po' && d.p.context && <span className="block text-gray-500">{d.p.context}</span>}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-gray-600">{d.indent?.raisedBy ?? d.p.by ?? ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{d.items.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{value > 0.5 ? formatINR(value) : <Dash />}{d.p.kind === 'indent' && value > 0.5 && <span className="block text-[11px] font-normal text-gray-400">at last rates</span>}</td>
                        <td className={`px-3 py-2 text-right tabular-nums text-[12px] ${late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>{days == null ? '' : `${days}d`}{late ? <span className="block text-[11px] font-normal">late</span> : null}</td>
                      </tr>
                      <RowDetail id={key}>
                        <tr className="border-t border-gray-100 bg-gray-50/40">
                          <td colSpan={6} className="pl-9 pr-3 py-3 space-y-3">
                            {d.p.kind === 'indent'
                              ? <IndentDecisionTable items={d.items} ctx={ctx.byMaterial} projectId={projectId} />
                              : <PoDecisionTable poId={d.p.id} lines={d.lines} ctx={ctx.byMaterial} projectId={projectId} />}
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 grid gap-x-8 gap-y-3 md:grid-cols-2">
                              {d.indent && <History title={`Indent ${shortRef(d.indent.ref)}`} chain={d.indent.chain} remark={d.p.kind === 'po' ? meaningfulRemark(d.indent.remarks) : null} />}
                              {d.p.kind === 'po' && <History title={`PO ${shortRef(d.p.ref)}`} sub={d.p.what ?? undefined} chain={poChain(d.lines, d.p.id)} links={<>
                                <a href={`/api/in4/purchase-order/${d.p.id}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Print</a>
                                {' · '}<a href={`/api/in4/purchase-order/${d.p.id}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Ledger</a>
                              </>} />}
                            </div>
                          </td>
                        </tr>
                      </RowDetail>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RowDetailProvider>
  )
}

const poChain = (lines: BoardRow[], poId: number): ChainStep[] => lines.flatMap(l => l.item.pos).find(p => p.poId === poId)?.chain ?? []

const qty = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const Dash = () => <span className="text-gray-300">—</span>
const TH = 'border-b border-gray-100 px-2 py-1.5'

/** What the approver weighs on an indent: the quantity against what the material last cost and what the project already has. */
function IndentDecisionTable({ items, ctx, projectId }: { items: IndentItem[]; ctx: Map<number, MaterialContext>; projectId: number | null }) {
  const rowsOut = items.map((it, i) => {
    const c = ctx.get(it.materialId ?? -1)
    const ref = referenceRate(c)
    const amount = ref ? ref.rate * it.qty : null
    return { it, i, c, ref, amount }
  })
  const est = rowsOut.reduce((t, x) => t + (x.amount ?? 0), 0)
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full table-fixed text-[12px] min-w-[880px]">
        <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className={`${TH} w-[4%]`}>#</th>
            <th className={`${TH} w-[26%]`}>Material</th>
            <th className={`${TH} w-[6%]`}>Unit</th>
            <th className={`${TH} text-right w-[9%]`}>Qty</th>
            <th className={`${TH} text-right w-[17%]`}>Last rate <span className="normal-case text-gray-400 font-normal">who · when</span></th>
            <th className={`${TH} text-right w-[12%]`}>Est. amount</th>
            <th className={`${TH} w-[26%]`}>{projectId != null ? 'Bought on this project so far' : 'Bought so far'}</th>
          </tr>
        </thead>
        <tbody>
          {rowsOut.map(({ it, i, c, ref, amount }) => (
            <tr key={it.id} className="border-t border-gray-100 align-top">
              <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
              <td className="px-2 py-1.5 text-gray-800"><p className="truncate" title={it.material}>{it.material}</p></td>
              <td className="px-2 py-1.5 text-gray-600">{it.uom ?? ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{qty(it.qty)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {ref ? <>
                  <span className="text-gray-900">{formatINR(ref.rate)}</span>
                  <span className="block text-[11px] text-gray-500 truncate">{[ref.from.supplier, ref.from.date ? formatDate(ref.from.date) : null, ref.where === 'elsewhere' ? ref.from.project : null].filter(Boolean).join(' · ')}</span>
                  {c && c.minRate != null && c.maxRate != null && c.maxRate > c.minRate * 1.05 && <span className="block text-[11px] text-gray-400">{c.purchases} buys · {formatINR(c.minRate)}–{formatINR(c.maxRate)}</span>}
                </> : <span className="text-amber-700">first purchase</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{amount ? formatINR(amount) : <Dash />}</td>
              <td className="px-2 py-1.5 text-gray-600">
                {c && c.onProject.pos > 0
                  ? <>{qty(c.onProject.orderedQty)} {it.uom ?? ''} ordered · {qty(c.onProject.receivedQty)} received · {c.onProject.pos} PO{c.onProject.pos === 1 ? '' : 's'} · {formatINR(c.onProject.spend)}</>
                  : c && c.purchases > 0 ? <span className="text-gray-500">none here · {c.purchases} buy{c.purchases === 1 ? '' : 's'} elsewhere</span>
                  : <span className="text-gray-400">never bought</span>}
              </td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 bg-gray-100/70">
            <td />
            <td className="px-2 py-2 font-bold text-gray-900">Estimated at last rates</td>
            <td colSpan={3} />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{est > 0.5 ? formatINR(est) : <Dash />}</td>
            <td className="px-2 py-2 text-[11px] text-gray-400">IN4 holds no rate on an indent line; this is qty × the last PO rate.</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** What the approver weighs on a PO: each rate against the last one paid for that material. */
function PoDecisionTable({ poId, lines, ctx, projectId }: { poId: number; lines: BoardRow[]; ctx: Map<number, MaterialContext>; projectId: number | null }) {
  const rowsOut = lines.map((l, i) => {
    const p = l.item.pos.find(x => x.poId === poId)!
    const c = ctx.get(l.item.materialId ?? -1)
    const delta = priceDelta(p.rate, c)
    const ref = referenceRate(c)
    return { l, i, p, c, delta, ref }
  })
  const total = rowsOut.reduce((t, x) => t + x.p.value, 0)
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full table-fixed text-[12px] min-w-[880px]">
        <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className={`${TH} w-[4%]`}>#</th>
            <th className={`${TH} w-[26%]`}>Material</th>
            <th className={`${TH} w-[6%]`}>Unit</th>
            <th className={`${TH} text-right w-[9%]`}>Indent qty</th>
            <th className={`${TH} text-right w-[9%]`}>PO qty</th>
            <th className={`${TH} text-right w-[10%]`}>Rate</th>
            <th className={`${TH} text-right w-[18%]`}>vs last paid <span className="normal-case text-gray-400 font-normal">{projectId != null ? 'here, else anywhere' : ''}</span></th>
            <th className={`${TH} text-right w-[12%]`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rowsOut.map(({ l, i, p, delta, ref }) => (
            <tr key={l.item.id} className="border-t border-gray-100 align-top">
              <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
              <td className="px-2 py-1.5 text-gray-800"><p className="truncate" title={l.item.material}>{l.item.material}</p><p className="text-[11px] text-gray-400 truncate">{shortRef(l.indent.ref)}</p></td>
              <td className="px-2 py-1.5 text-gray-600">{l.item.uom ?? ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.item.qty)}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${p.qty > l.item.qty + 0.001 ? 'text-rose-700 font-semibold' : ''}`}>{qty(p.qty)}{p.qty > l.item.qty + 0.001 && <span className="block text-[11px] font-normal">over indent</span>}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{p.rate == null ? <Dash /> : formatINR(p.rate)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {ref ? <>
                  <span className={delta == null ? 'text-gray-500' : delta > 5 ? 'text-rose-700 font-semibold' : delta < -5 ? 'text-emerald-700 font-semibold' : 'text-gray-700'}>{delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</span>
                  <span className="block text-[11px] text-gray-500 truncate">{formatINR(ref.rate)} · {[ref.from.supplier, ref.from.date ? formatDate(ref.from.date) : null, ref.where === 'elsewhere' ? ref.from.project : null].filter(Boolean).join(' · ')}</span>
                </> : <span className="text-amber-700">first purchase</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatINR(p.value)}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 bg-gray-100/70">
            <td />
            <td className="px-2 py-2 font-bold text-gray-900">PO total <span className="font-normal text-gray-500">landed, with GST</span></td>
            <td colSpan={5} />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 ${className ?? ''}`}>{children}</th>
}

function Calm({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-6 text-center text-[13px] text-emerald-900 flex items-center justify-center gap-2">
      <CheckCircle2 className="h-4 w-4" /> {text}
    </p>
  )
}
