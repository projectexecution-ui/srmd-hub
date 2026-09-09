import Link from 'next/link'
import { AlertTriangle, Check, Circle, Dot } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { FILTER_LABEL, SLA_DAYS, type IndentRow, type IndentsCatRow, type IndentsSubRow, type ChainStep, type IndentItem, type PendingApproval, type IndentFilter } from '@/lib/revamp/indents-tree'

/**
 * The rows of the Indents screens — shared by the project tab and the
 * portal-wide tracker so the two never read differently. Category →
 * sub-category → indent (with its cycle strip) → items (with what each waits
 * for, since when, and whether that is late by the same SLA the digest uses).
 */

export function Kpi({ label, value, tone, sub }: { label: string; value: string; tone?: 'amber' | 'rose'; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`text-[15px] font-semibold tabular-nums ${tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[12px] text-gray-400">{sub}</p>}
    </div>
  )
}

export const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null)

/** Chips that filter the screen; plain links so the choice lives in the URL. */
export function FilterChips({ base, current, counts, keep = {} }: { base: string; current: IndentFilter; counts: Partial<Record<IndentFilter, number>>; keep?: Record<string, string | undefined> }) {
  const href = (f: IndentFilter) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v)
    if (f !== 'all') p.set('f', f)
    const s = p.toString()
    return s ? `${base}?${s}` : base
  }
  return (
    <nav aria-label="Show" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {(Object.keys(FILTER_LABEL) as IndentFilter[]).map(f => (
        <Link key={f} href={href(f)} aria-current={f === current ? 'page' : undefined}
          className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] min-h-[44px] inline-flex items-center gap-1.5 ${
            f === current ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'} ${f === 'late' && (counts.late ?? 0) > 0 && f !== current ? 'text-amber-800 border-amber-200' : ''}`}>
          {FILTER_LABEL[f]}{counts[f] != null && <span className="tabular-nums text-[12px] opacity-70">{counts[f]!.toLocaleString('en-IN')}</span>}
        </Link>
      ))}
    </nav>
  )
}

/** Everything waiting for someone in IN4, oldest first. */
export function Pending({ list, showProject = false }: { list: PendingApproval[]; showProject?: boolean }) {
  return (
    <section className={`rounded-lg border ${list.length ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-white'}`}>
      <div className="px-3 py-2 flex items-center gap-2 border-b border-amber-100/80">
        <AlertTriangle className={`h-4 w-4 ${list.length ? 'text-amber-700' : 'text-gray-300'}`} />
        <h3 className="text-[13px] font-semibold text-gray-900">Pending approvals in IN4</h3>
        <span className="ml-auto text-[12px] text-gray-600 tabular-nums">{list.length ? `${list.length} waiting` : 'nothing waiting'}</span>
      </div>
      {list.length > 0 && (
        <ul className="divide-y divide-amber-100/80">
          {list.map(p => {
            const d = daysSince(p.since)
            const late = d != null && d > SLA_DAYS['indent approval']
            return (
              <li key={`${p.kind}:${p.id}`} className="px-3 py-2 text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={`text-[11px] font-semibold uppercase tracking-wide rounded px-1 ${p.kind === 'indent' ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'}`}>{p.kind === 'indent' ? 'Indent' : 'PO'}</span>
                <span className="font-mono text-gray-900">{p.ref}</span>
                {showProject && p.project && <span className="text-[12px] text-gray-600">{p.project}</span>}
                <span className={`text-[12px] font-semibold ${p.stage === 'verify' ? 'text-amber-800' : 'text-gray-700'}`}>{p.status}</span>
                {p.what && <span className="text-[12px] text-gray-600">{p.what}</span>}
                {p.value != null && <span className="text-[12px] tabular-nums text-gray-800">{formatINR(p.value)}</span>}
                <span className={`ml-auto text-[12px] whitespace-nowrap ${late ? 'text-amber-800 font-semibold' : 'text-gray-500'}`}>
                  {p.by ? `${p.by} · ` : ''}{p.since ? formatDate(p.since) : ''}{d != null && d > 0 ? ` · waiting ${d} day${d === 1 ? '' : 's'}` : ''}{p.context ? ` · ${p.context}` : ''}
                </span>
                <span className="w-full text-[12px] text-amber-800">{p.stage === 'verify' ? 'Waiting for the Atm Head to approve in IN4.' : 'Waiting in IN4 for the next step.'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const money = (v: number) => (v > 0.5 ? formatINR(v) : '—')
const count = (v: number) => (v > 0 ? v.toLocaleString('en-IN') : '—')

export function Cells({ items, poValue, receivedValue, awaitingPo, awaitingDelivery, small }: { items: number; poValue: number; receivedValue: number; awaitingPo: number; awaitingDelivery: number; small?: boolean }) {
  const cls = `text-right tabular-nums ${small ? 'text-[12px] text-gray-700' : 'text-[13px] text-gray-900'}`
  return (
    <>
      <span className={`hidden md:block ${cls}`}>{count(items)}</span>
      <span className={`hidden md:block ${cls}`}>{money(poValue)}</span>
      <span className={`hidden md:block ${cls}`}>{money(receivedValue)}</span>
      <span className={`hidden md:block ${cls} ${awaitingPo > 0 ? 'text-amber-700 font-semibold' : ''}`}>{count(awaitingPo)}</span>
      <span className={`hidden md:block ${cls} ${awaitingDelivery > 0 ? 'text-amber-700 font-semibold' : ''}`}>{count(awaitingDelivery)}</span>
      <span className="md:hidden col-span-full flex flex-wrap gap-x-3 text-[12px] tabular-nums text-gray-600 pl-6">
        <span>{count(items)} items</span><span>PO’d {money(poValue)}</span><span>Recd {money(receivedValue)}</span>
        {awaitingPo > 0 && <span className="text-amber-700">{awaitingPo} await PO</span>}
        {awaitingDelivery > 0 && <span className="text-amber-700">{awaitingDelivery} await delivery</span>}
      </span>
    </>
  )
}

export const GRID = 'grid grid-cols-1 md:grid-cols-[1fr_5rem_7rem_7rem_6rem_6rem] gap-x-2 items-center'
const clean = (name: string) => name.replace(/^\d+\s+/, '')

export function TreeHeader() {
  return (
    <div className="hidden md:grid grid-cols-[1fr_5rem_7rem_7rem_6rem_6rem] gap-2 px-3 py-1.5 text-[12px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
      <span>Category · sub-category · indent</span><span className="text-right">Items</span><span className="text-right">PO’d</span><span className="text-right">Received</span><span className="text-right">Await PO</span><span className="text-right">Await delivery</span>
    </div>
  )
}

export function TreeBody({ cats, idPrefix = '', openAll = false }: { cats: IndentsCatRow[]; idPrefix?: string; openAll?: boolean }) {
  return <div className="divide-y divide-gray-100">{cats.map(c => <CatRow key={c.id} c={c} idPrefix={idPrefix} openAll={openAll} />)}</div>
}

function CatRow({ c, idPrefix, openAll }: { c: IndentsCatRow; idPrefix: string; openAll: boolean }) {
  const key = `${idPrefix}${c.id}`
  const body = (
    <div className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
      {c.subs.map(sb => <SubRow key={sb.id} sb={sb} idPrefix={idPrefix} openAll={openAll} />)}
    </div>
  )
  return (
    <div>
      <div className={`${GRID} px-3 py-2`}>
        <span className="flex items-center gap-1 text-[13px]">
          {openAll ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={c.subs.length} label="sub-categories" />}
          {c.code && <span className="font-mono text-[12px] text-gray-500">{c.code}</span>}
          <span className="font-semibold text-gray-900">{clean(c.name)}</span>
          <span className="text-[12px] text-gray-400">{c.indents} indent{c.indents === 1 ? '' : 's'}</span>
        </span>
        <Cells items={c.items} poValue={c.poValue} receivedValue={c.receivedValue} awaitingPo={c.awaitingPo} awaitingDelivery={c.awaitingDelivery} />
      </div>
      {openAll ? body : <RowDetail id={key}>{body}</RowDetail>}
    </div>
  )
}

function SubRow({ sb, idPrefix, openAll }: { sb: IndentsSubRow; idPrefix: string; openAll: boolean }) {
  const key = `${idPrefix}${sb.id}`
  const body = (
    <div className="bg-white border-t border-gray-100 divide-y divide-gray-100">
      {sb.indents.map(r => <IndentLine key={`${sb.id}:${r.id}`} r={r} idPrefix={key} openAll={openAll} />)}
    </div>
  )
  return (
    <div>
      <div className={`${GRID} pl-8 pr-3 py-1.5`}>
        <span className="flex items-center gap-1 text-[13px]">
          {openAll ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={sb.indents.length} label="indents" />}
          {sb.code && <span className="font-mono text-[12px] text-gray-500">{sb.code}</span>}
          <span className="font-medium text-gray-900">{clean(sb.name)}</span>
          <span className="text-[12px] text-gray-400">{sb.indents.length} indent{sb.indents.length === 1 ? '' : 's'}</span>
        </span>
        <Cells small items={sb.items} poValue={sb.poValue} receivedValue={sb.receivedValue} awaitingPo={sb.awaitingPo} awaitingDelivery={sb.awaitingDelivery} />
      </div>
      {openAll ? body : <RowDetail id={key}>{body}</RowDetail>}
    </div>
  )
}

export function IndentLine({ r, idPrefix, openAll = false, showProject = false }: { r: IndentRow; idPrefix: string; openAll?: boolean; showProject?: boolean }) {
  const key = `${idPrefix}:ind:${r.id}`
  const lateItems = r.items.filter(i => i.late).length
  const body = (
    <div className="bg-slate-50/60 border-t border-gray-100">
      {r.remarks && <p className="pl-20 pr-3 pt-1.5 text-[12px] text-gray-600 italic">“{r.remarks}”</p>}
      <ul className="divide-y divide-gray-100">{r.items.map(it => <ItemLine key={it.id} it={it} />)}</ul>
    </div>
  )
  return (
    <div>
      <div className={`${GRID} pl-14 pr-3 py-1.5`}>
        <span className="min-w-0">
          <span className="flex items-center gap-2 flex-wrap text-[13px]">
            {openAll ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={r.items.length} label="items" />}
            <span className="font-mono text-gray-800">{r.ref}</span>
            <StageChip stage={r.stage} label={r.status} />
            {lateItems > 0 && <span className="text-[11px] font-semibold rounded border border-amber-200 bg-amber-50 text-amber-800 px-1.5">{lateItems} late</span>}
            {r.date && <span className="text-[12px] text-gray-500">{formatDate(r.date)}</span>}
            {r.raisedBy && <span className="text-[12px] text-gray-500">by {r.raisedBy}</span>}
            {showProject && r.project && <span className="text-[12px] text-gray-500">{r.subproject ?? r.project}</span>}
            {r.woNo && <span className="text-[12px] text-gray-400">{r.woNo}</span>}
          </span>
          <Cycle r={r} />
        </span>
        <Cells small items={r.items.length} poValue={r.poValue} receivedValue={r.receivedValue} awaitingPo={r.awaitingPo} awaitingDelivery={r.awaitingDelivery} />
      </div>
      {openAll ? body : <RowDetail id={key}>{body}</RowDetail>}
    </div>
  )
}

export function StageChip({ stage, label }: { stage: ChainStep['stage']; label: string }) {
  const cls = stage === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : stage === 'verify' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : stage === 'closed' ? 'bg-gray-100 text-gray-500 border-gray-200'
    : 'bg-slate-50 text-slate-700 border-slate-200'
  return <span className={`text-[11px] font-semibold rounded border px-1.5 ${cls}`}>{label}</span>
}

/** The cycle on one line: the indent's four steps, then its POs, then receipt. */
export function Cycle({ r }: { r: IndentRow }) {
  const steps: Array<{ label: string; state: 'done' | 'now' | 'todo'; hint: string; late?: boolean }> = []
  const stageOrder = ['draft', 'submitted', 'verify', 'approved'] as const
  const reached = r.stage === 'closed' ? -1 : stageOrder.indexOf(r.stage as typeof stageOrder[number])
  const waitingAtIndent = r.items.find(i => i.next === 'indent approval')
  for (let i = 0; i < stageOrder.length; i++) {
    const st = stageOrder[i]
    const step = [...r.chain].reverse().find(c => c.stage === st)
    const label = st === 'draft' ? 'Draft' : st === 'submitted' ? 'Submitted' : st === 'verify' ? 'Verify' : 'Approved'
    const state: 'done' | 'now' | 'todo' = i < reached ? 'done' : i === reached ? (st === 'approved' ? 'done' : 'now') : 'todo'
    const days = state === 'now' && waitingAtIndent?.waitingDays ? ` · ${waitingAtIndent.waitingDays} d` : ''
    steps.push({ label: label + days, state, late: state === 'now' && !!waitingAtIndent?.late, hint: step ? `${label}${step.at ? ` ${formatDate(step.at)}` : ''}${step.by ? ` · ${step.by}` : ''}${step.remark ? ` — ${step.remark}` : ''}` : `${label} — not yet` })
  }
  if (r.stage === 'closed') steps.push({ label: r.status, state: 'done', hint: 'Taken out of the cycle in IN4' })
  const totalQty = r.items.reduce((t, i) => t + i.qty, 0)
  const poQty = r.items.reduce((t, i) => t + i.poQty, 0)
  const recQty = r.items.reduce((t, i) => t + i.receivedQty, 0)
  const waitingPo = r.items.find(i => i.next === 'raise PO')
  if (r.pos.length === 0) steps.push({ label: waitingPo?.waitingDays ? `PO · ${waitingPo.waitingDays} d` : 'PO', state: waitingPo ? 'now' : 'todo', late: !!waitingPo?.late, hint: r.stage === 'approved' ? 'No PO raised yet' : 'PO comes after approval' })
  else for (const p of r.pos) steps.push({ label: `${p.poNo ?? `PO ${p.poId}`} · ${p.status}`, state: p.stage === 'approved' ? 'done' : 'now', hint: `${p.supplier ?? ''}${p.date ? ` · ${formatDate(p.date)}` : ''} · ${formatINR(p.value)}` })
  const waitingDelivery = r.items.find(i => i.next === 'delivery')
  steps.push({
    label: recQty > 0 ? `Received ${recQty.toLocaleString('en-IN')} of ${(poQty || totalQty).toLocaleString('en-IN')}` : waitingDelivery?.waitingDays ? `GRN · ${waitingDelivery.waitingDays} d` : 'GRN',
    state: poQty > 0 && recQty + 0.001 >= poQty ? 'done' : recQty > 0 || waitingDelivery ? 'now' : 'todo',
    late: !!waitingDelivery?.late,
    hint: recQty > 0 ? 'Received against the PO(s)' : 'Nothing received yet',
  })
  return (
    <span className="mt-0.5 ml-6 flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map((st, i) => (
        <span key={i} title={st.hint} className={`inline-flex items-center gap-0.5 rounded px-1 ${
          st.state === 'done' ? 'text-emerald-800 bg-emerald-50' : st.state === 'now' ? (st.late ? 'text-amber-900 bg-amber-100 font-semibold ring-1 ring-amber-300' : 'text-amber-800 bg-amber-50 font-semibold') : 'text-gray-400'}`}>
          {st.state === 'done' ? <Check className="h-3 w-3" /> : st.state === 'now' ? <Dot className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
          {st.label}
        </span>
      ))}
    </span>
  )
}

const NEXT_LABEL: Record<IndentItem['next'], string> = {
  'indent approval': 'waiting for indent approval', 'raise PO': 'PO to be raised', 'PO approval': 'waiting for PO approval',
  'delivery': 'awaiting delivery', 'done': 'received in full', 'closed': 'closed',
}

export function ItemLine({ it }: { it: IndentItem }) {
  const qty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })
  const waiting = it.waitingDays != null && it.next !== 'done' && it.next !== 'closed' ? ` · ${it.waitingDays} day${it.waitingDays === 1 ? '' : 's'}` : ''
  return (
    <li className="pl-20 pr-3 py-1.5 text-[12px]">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium text-gray-900">{it.material}</span>
        <span className="tabular-nums text-gray-700">Indented {qty(it.qty)} {it.uom ?? ''}</span>
        <span className="tabular-nums text-gray-700">PO’d {it.poQty > 0 ? `${qty(it.poQty)} · ${formatINR(it.poValue)}` : '—'}</span>
        <span className="tabular-nums text-gray-700">Received {it.receivedQty > 0 ? qty(it.receivedQty) : '—'}</span>
        {it.closedForPo && it.poQty + 0.001 < it.qty && <span className="text-gray-500">closed for PO in IN4 at {qty(it.poQty)}</span>}
        <span className={`ml-auto ${it.next === 'done' ? 'text-emerald-700' : it.next === 'closed' ? 'text-gray-400' : it.late ? 'text-amber-900 font-semibold' : 'text-amber-700'}`}>
          {NEXT_LABEL[it.next]}{waiting}{it.late ? ' — late' : ''}
        </span>
      </p>
      {it.pos.map(p => (
        <p key={p.poId} className="pl-3 text-gray-600 flex flex-wrap gap-x-2">
          <span className="font-mono">{p.poNo ?? `PO ${p.poId}`}</span>
          <StageChip stage={p.stage} label={p.status} />
          {p.supplier && <span>{p.supplier}</span>}
          <span className="tabular-nums">{qty(p.qty)}{p.rate != null ? ` @ ${formatINR(p.rate)}` : ''} = {formatINR(p.value)}</span>
          {p.grns.map(g => <span key={g.grnId} className="text-emerald-700">{g.grnNo ?? `GRN ${g.grnId}`}{g.date ? ` ${formatDate(g.date)}` : ''}: {qty(g.qty)}</span>)}
          {p.chain.length > 0 && <span className="text-gray-400" title={p.chain.map(c => `${c.status}${c.at ? ` ${formatDate(c.at)}` : ''}${c.by ? ` · ${c.by}` : ''}`).join(' → ')}>{p.chain.map(c => c.status).join(' → ')}</span>}
          <a href={`/api/in4/purchase-order/${p.poId}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">PO</a>
          <a href={`/api/in4/purchase-order/${p.poId}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">ledger</a>
        </p>
      ))}
    </li>
  )
}
