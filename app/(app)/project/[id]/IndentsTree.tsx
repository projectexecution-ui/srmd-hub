import Link from 'next/link'
import { AlertTriangle, Link2Off, Info, Check, Circle, Dot } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadIndentsTree, type IndentRow, type IndentsCatRow, type IndentsSubRow, type ChainStep, type IndentItem, type PendingApproval } from '@/lib/revamp/indents-tree'

/**
 * The Indents tab in the Internal Estimate's shape — category → sub-category
 * → indent → items — with the approvals waiting in IN4 on top and the whole
 * cycle (Indent → PO → GRN) on every indent. Read live from IN4; approval
 * itself happens in IN4, and the Atm Head is told when it is their turn
 * (lib/in4/approvals-watch.ts).
 */
export async function IndentsTree({ projectId }: { projectId: string }) {
  const t = await loadIndentsTree(projectId)

  if (!t.linked) {
    return (
      <EmptyState
        icon={<Link2Off className="h-10 w-10" />}
        title="Not linked to IN4"
        description="This project is not mapped to an IN4 project yet, so there are no indents to show. Link it under Setup."
        action={<Link href={`/project/${projectId}/setup`} className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 min-h-[44px]">Open Setup</Link>}
      />
    )
  }
  if (t.in4 !== 'live') {
    return <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title={t.in4 === 'not-configured' ? 'IN4 is not connected on this deployment' : 'IN4 did not answer'} description={t.error ?? 'The indents are read live from IN4, which could not be reached just now.'} />
  }

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Indents" value={t.totals.indents.toLocaleString('en-IN')} />
          <Kpi label="Items" value={t.totals.items.toLocaleString('en-IN')} />
          <Kpi label="PO’d (with GST)" value={formatINR(t.totals.poValue)} />
          <Kpi label="Received" value={formatINR(t.totals.receivedValue)} />
          <Kpi label="Items awaiting PO" value={t.totals.awaitingPo.toLocaleString('en-IN')} tone={t.totals.awaitingPo > 0 ? 'amber' : undefined} />
          <Kpi label="Items awaiting delivery" value={t.totals.awaitingDelivery.toLocaleString('en-IN')} tone={t.totals.awaitingDelivery > 0 ? 'amber' : undefined} />
        </div>

        <Pending list={t.pending} />

        <p className="text-[12px] text-gray-500 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>Live from IN4. Each indent shows its whole cycle — Indent (Draft → Submitted → Verify → Approved) → PO → GRN — with who did what and when, from IN4’s own record.{t.totals.hidden > 0 && ` ${t.totals.hidden} cancelled or terminated indent${t.totals.hidden === 1 ? '' : 's'} not shown.`}</span>
        </p>

        {t.cats.length === 0 ? (
          <EmptyState title="No indents in IN4 for this project" description="Nothing has been indented against this project’s sub-projects yet." />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="hidden md:grid grid-cols-[1fr_5rem_7rem_7rem_6rem_6rem] gap-2 px-3 py-1.5 text-[12px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <span>Category · sub-category · indent</span><span className="text-right">Items</span><span className="text-right">PO’d</span><span className="text-right">Received</span><span className="text-right">Await PO</span><span className="text-right">Await delivery</span>
            </div>
            <div className="divide-y divide-gray-100">
              {t.cats.map(c => <CatRow key={c.id} c={c} />)}
            </div>
          </div>
        )}
      </div>
    </RowDetailProvider>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`text-[15px] font-semibold tabular-nums ${tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null)

/** Everything waiting for someone in IN4, oldest first. */
function Pending({ list }: { list: PendingApproval[] }) {
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
            return (
              <li key={`${p.kind}:${p.id}`} className="px-3 py-2 text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={`text-[11px] font-semibold uppercase tracking-wide rounded px-1 ${p.kind === 'indent' ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'}`}>{p.kind === 'indent' ? 'Indent' : 'PO'}</span>
                <span className="font-mono text-gray-900">{p.ref}</span>
                <span className={`text-[12px] font-semibold ${p.stage === 'verify' ? 'text-amber-800' : 'text-gray-700'}`}>{p.status}</span>
                {p.what && <span className="text-[12px] text-gray-600">{p.what}</span>}
                {p.value != null && <span className="text-[12px] tabular-nums text-gray-800">{formatINR(p.value)}</span>}
                <span className="ml-auto text-[12px] text-gray-500 whitespace-nowrap">
                  {p.by ? `${p.by} · ` : ''}{p.since ? formatDate(p.since) : ''}{d != null && d > 0 ? ` · ${d} day${d === 1 ? '' : 's'}` : ''}{p.context ? ` · ${p.context}` : ''}
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

function Cells({ items, poValue, receivedValue, awaitingPo, awaitingDelivery, small }: { items: number; poValue: number; receivedValue: number; awaitingPo: number; awaitingDelivery: number; small?: boolean }) {
  const cls = `text-right tabular-nums ${small ? 'text-[12px] text-gray-700' : 'text-[13px] text-gray-900'}`
  return (
    <>
      <span className={`hidden md:block ${cls}`}>{count(items)}</span>
      <span className={`hidden md:block ${cls}`}>{money(poValue)}</span>
      <span className={`hidden md:block ${cls}`}>{money(receivedValue)}</span>
      <span className={`hidden md:block ${cls} ${awaitingPo > 0 ? 'text-amber-700 font-semibold' : ''}`}>{count(awaitingPo)}</span>
      <span className={`hidden md:block ${cls} ${awaitingDelivery > 0 ? 'text-amber-700 font-semibold' : ''}`}>{count(awaitingDelivery)}</span>
      {/* Mobile: the same five figures as chips under the name. */}
      <span className="md:hidden col-span-full flex flex-wrap gap-x-3 text-[12px] tabular-nums text-gray-600 pl-6">
        <span>{count(items)} items</span><span>PO’d {money(poValue)}</span><span>Recd {money(receivedValue)}</span>
        {awaitingPo > 0 && <span className="text-amber-700">{awaitingPo} await PO</span>}
        {awaitingDelivery > 0 && <span className="text-amber-700">{awaitingDelivery} await delivery</span>}
      </span>
    </>
  )
}

const GRID = 'grid grid-cols-1 md:grid-cols-[1fr_5rem_7rem_7rem_6rem_6rem] gap-x-2 items-center'
const clean = (name: string) => name.replace(/^\d+\s+/, '')

function CatRow({ c }: { c: IndentsCatRow }) {
  return (
    <div>
      <div className={`${GRID} px-3 py-2`}>
        <span className="flex items-center gap-1 text-[13px]">
          <RowDetailToggle id={c.id} count={c.subs.length} />
          {c.code && <span className="font-mono text-[12px] text-gray-500">{c.code}</span>}
          <span className="font-semibold text-gray-900">{clean(c.name)}</span>
          <span className="text-[12px] text-gray-400">{c.indents} indent{c.indents === 1 ? '' : 's'}</span>
        </span>
        <Cells items={c.items} poValue={c.poValue} receivedValue={c.receivedValue} awaitingPo={c.awaitingPo} awaitingDelivery={c.awaitingDelivery} />
      </div>
      <RowDetail id={c.id}>
        <div className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
          {c.subs.map(sb => <SubRow key={sb.id} sb={sb} />)}
        </div>
      </RowDetail>
    </div>
  )
}

function SubRow({ sb }: { sb: IndentsSubRow }) {
  return (
    <div>
      <div className={`${GRID} pl-8 pr-3 py-1.5`}>
        <span className="flex items-center gap-1 text-[13px]">
          <RowDetailToggle id={sb.id} count={sb.indents.length} />
          {sb.code && <span className="font-mono text-[12px] text-gray-500">{sb.code}</span>}
          <span className="font-medium text-gray-900">{clean(sb.name)}</span>
          <span className="text-[12px] text-gray-400">{sb.indents.length} indent{sb.indents.length === 1 ? '' : 's'}</span>
        </span>
        <Cells small items={sb.items} poValue={sb.poValue} receivedValue={sb.receivedValue} awaitingPo={sb.awaitingPo} awaitingDelivery={sb.awaitingDelivery} />
      </div>
      <RowDetail id={sb.id}>
        <div className="bg-white border-t border-gray-100 divide-y divide-gray-100">
          {sb.indents.map(r => <IndentLine key={`${sb.id}:${r.id}`} r={r} idPrefix={sb.id} />)}
        </div>
      </RowDetail>
    </div>
  )
}

function IndentLine({ r, idPrefix }: { r: IndentRow; idPrefix: string }) {
  const key = `${idPrefix}:ind:${r.id}`
  return (
    <div>
      <div className={`${GRID} pl-14 pr-3 py-1.5`}>
        <span className="min-w-0">
          <span className="flex items-center gap-2 flex-wrap text-[13px]">
            <RowDetailToggle id={key} count={r.items.length} />
            <span className="font-mono text-gray-800">{r.ref}</span>
            <StageChip stage={r.stage} label={r.status} />
            {r.date && <span className="text-[12px] text-gray-500">{formatDate(r.date)}</span>}
            {r.raisedBy && <span className="text-[12px] text-gray-500">by {r.raisedBy}</span>}
            {r.woNo && <span className="text-[12px] text-gray-400">{r.woNo}</span>}
          </span>
          <Cycle r={r} />
        </span>
        <Cells small items={r.items.length} poValue={r.poValue} receivedValue={r.receivedValue} awaitingPo={r.awaitingPo} awaitingDelivery={r.awaitingDelivery} />
      </div>
      <RowDetail id={key}>
        <div className="bg-slate-50/60 border-t border-gray-100">
          {r.remarks && <p className="pl-20 pr-3 pt-1.5 text-[12px] text-gray-600 italic">“{r.remarks}”</p>}
          <ul className="divide-y divide-gray-100">
            {r.items.map(it => <ItemLine key={it.id} it={it} />)}
          </ul>
        </div>
      </RowDetail>
    </div>
  )
}

function StageChip({ stage, label }: { stage: ChainStep['stage']; label: string }) {
  const cls = stage === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : stage === 'verify' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : stage === 'closed' ? 'bg-gray-100 text-gray-500 border-gray-200'
    : 'bg-slate-50 text-slate-700 border-slate-200'
  return <span className={`text-[11px] font-semibold rounded border px-1.5 ${cls}`}>{label}</span>
}

/** The cycle on one line: the indent's four steps, then its POs, then receipt. */
function Cycle({ r }: { r: IndentRow }) {
  const steps: Array<{ label: string; state: 'done' | 'now' | 'todo'; hint: string }> = []
  const stageOrder = ['draft', 'submitted', 'verify', 'approved'] as const
  const reached = r.stage === 'closed' ? -1 : stageOrder.indexOf(r.stage as typeof stageOrder[number])
  for (let i = 0; i < stageOrder.length; i++) {
    const st = stageOrder[i]
    const step = [...r.chain].reverse().find(c => c.stage === st)
    const label = st === 'draft' ? 'Draft' : st === 'submitted' ? 'Submitted' : st === 'verify' ? 'Verify' : 'Approved'
    const state: 'done' | 'now' | 'todo' = i < reached ? 'done' : i === reached ? (st === 'approved' ? 'done' : 'now') : 'todo'
    steps.push({ label, state, hint: step ? `${label}${step.at ? ` ${formatDate(step.at)}` : ''}${step.by ? ` · ${step.by}` : ''}${step.remark ? ` — ${step.remark}` : ''}` : `${label} — not yet` })
  }
  if (r.stage === 'closed') steps.push({ label: r.status, state: 'done', hint: 'Taken out of the cycle in IN4' })
  const totalQty = r.items.reduce((t, i) => t + i.qty, 0)
  const poQty = r.items.reduce((t, i) => t + i.poQty, 0)
  const recQty = r.items.reduce((t, i) => t + i.receivedQty, 0)
  if (r.pos.length === 0) steps.push({ label: 'PO', state: 'todo', hint: r.stage === 'approved' ? 'No PO raised yet' : 'PO comes after approval' })
  else for (const p of r.pos) steps.push({ label: `${p.poNo ?? `PO ${p.poId}`} · ${p.status}`, state: p.stage === 'approved' ? 'done' : 'now', hint: `${p.supplier ?? ''}${p.date ? ` · ${formatDate(p.date)}` : ''} · ${formatINR(p.value)}` })
  steps.push({
    label: recQty > 0 ? `Received ${recQty.toLocaleString('en-IN')} of ${(poQty || totalQty).toLocaleString('en-IN')}` : 'GRN',
    state: poQty > 0 && recQty + 0.001 >= poQty ? 'done' : recQty > 0 ? 'now' : 'todo',
    hint: recQty > 0 ? 'Received against the PO(s)' : 'Nothing received yet',
  })
  return (
    <span className="mt-0.5 ml-6 flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map((st, i) => (
        <span key={i} title={st.hint} className={`inline-flex items-center gap-0.5 rounded px-1 ${
          st.state === 'done' ? 'text-emerald-800 bg-emerald-50' : st.state === 'now' ? 'text-amber-800 bg-amber-50 font-semibold' : 'text-gray-400'}`}>
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

function ItemLine({ it }: { it: IndentItem }) {
  const qty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })
  return (
    <li className="pl-20 pr-3 py-1.5 text-[12px]">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium text-gray-900">{it.material}</span>
        <span className="tabular-nums text-gray-700">Indented {qty(it.qty)} {it.uom ?? ''}</span>
        <span className="tabular-nums text-gray-700">PO’d {it.poQty > 0 ? `${qty(it.poQty)} · ${formatINR(it.poValue)}` : '—'}</span>
        <span className="tabular-nums text-gray-700">Received {it.receivedQty > 0 ? qty(it.receivedQty) : '—'}</span>
        <span className={`ml-auto ${it.next === 'done' ? 'text-emerald-700' : it.next === 'closed' ? 'text-gray-400' : 'text-amber-700'}`}>{NEXT_LABEL[it.next]}</span>
      </p>
      {it.pos.map(p => (
        <p key={p.poId} className="pl-3 text-gray-600 flex flex-wrap gap-x-2">
          <span className="font-mono">{p.poNo ?? `PO ${p.poId}`}</span>
          <StageChip stage={p.stage} label={p.status} />
          {p.supplier && <span>{p.supplier}</span>}
          <span className="tabular-nums">{qty(p.qty)}{p.rate != null ? ` @ ${formatINR(p.rate)}` : ''} = {formatINR(p.value)}</span>
          {p.grns.map(g => <span key={g.grnId} className="text-emerald-700">{g.grnNo ?? `GRN ${g.grnId}`}{g.date ? ` ${formatDate(g.date)}` : ''}: {qty(g.qty)}</span>)}
          {p.chain.length > 0 && <span className="text-gray-400" title={p.chain.map(c => `${c.status}${c.at ? ` ${formatDate(c.at)}` : ''}${c.by ? ` · ${c.by}` : ''}`).join(' → ')}>{p.chain.map(c => c.status).join(' → ')}</span>}
        </p>
      ))}
    </li>
  )
}
