import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { SLA_DAYS, type IndentRow, type IndentsCatRow, type IndentsSubRow, type ChainStep, type IndentItem, type PendingApproval, type IndentFilter } from '@/lib/revamp/indents-tree'

/**
 * The Indents screens, shared by the project tab and the portal tracker.
 *
 * Aksha, 10 Sep 2026: "too much data — too clumsy". So the screen leads with
 * ONE question — what needs someone now — as five tiles that are also the
 * tabs; each opens a plain list of just those lines. The full tree is the
 * last tile, slim: one line per category, sub-category, indent and item, the
 * cycle in a phrase, and the audit trail, POs and receipts under "Details".
 */

export const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null)
const qty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const days = (n: number | null) => (n == null ? '' : n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`)

/* ── The tiles that are the tabs ────────────────────────────────────────── */

export type Tile = { key: IndentFilter; label: string; count: number; tone?: 'amber' | 'rose' | 'green' }

export function tilesFor(counts: Record<IndentFilter, number> & { indents: number }, pending: number): Tile[] {
  return [
    { key: 'approval', label: 'Waiting for approval', count: pending, tone: pending > 0 ? 'amber' : undefined },
    { key: 'po', label: 'Awaiting PO', count: counts.po, tone: counts.po > 0 ? 'amber' : undefined },
    { key: 'delivery', label: 'Awaiting delivery', count: counts.delivery, tone: counts.delivery > 0 ? 'amber' : undefined },
    { key: 'late', label: 'Late', count: counts.late, tone: counts.late > 0 ? 'rose' : undefined },
    { key: 'all', label: 'All indents', count: counts.indents },
  ]
}

/** Which tile to open when the URL says nothing: the first that needs someone. */
export function defaultTile(tiles: Tile[]): IndentFilter {
  return tiles.find(t => t.key !== 'all' && t.count > 0)?.key ?? 'all'
}

export function Tiles({ tiles, current, href }: { tiles: Tile[]; current: IndentFilter; href: (f: IndentFilter) => string }) {
  return (
    <nav aria-label="Show" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {tiles.map(t => {
        const active = t.key === current
        const num = t.tone === 'rose' ? 'text-rose-700' : t.tone === 'amber' ? 'text-amber-700' : 'text-gray-900'
        return (
          <Link key={t.key} href={href(t.key)} aria-current={active ? 'page' : undefined}
            className={`rounded-lg border px-3 py-2 min-h-[44px] block ${active ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <p className="text-[12px] text-gray-500">{t.label}</p>
            <p className={`text-[17px] font-semibold tabular-nums ${num}`}>{t.count.toLocaleString('en-IN')}</p>
          </Link>
        )
      })}
    </nav>
  )
}

/* ── Waiting for approval ───────────────────────────────────────────────── */

export function PendingList({ list, showProject = false }: { list: PendingApproval[]; showProject?: boolean }) {
  if (list.length === 0) return <Calm text="Nothing is waiting for approval in IN4." />
  return (
    <section className="rounded-lg border border-amber-200 bg-white">
      <p className="px-3 py-2 text-[12px] text-amber-900 bg-amber-50/70 border-b border-amber-100 rounded-t-lg flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5" /> These are approved in IN4, not here. Oldest first.
      </p>
      <ul className="divide-y divide-gray-100">
        {list.map(p => {
          const d = daysSince(p.since)
          const late = d != null && d > SLA_DAYS['indent approval']
          return (
            <li key={`${p.kind}:${p.id}`} className="px-3 py-2 grid grid-cols-1 sm:grid-cols-[6rem_1fr_auto] gap-x-3 gap-y-0.5 text-[13px] items-baseline">
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${p.kind === 'indent' ? 'text-indigo-800' : 'text-emerald-800'}`}>{p.kind === 'indent' ? 'Indent' : 'PO'} · {p.status}</span>
              <span className="min-w-0">
                <span className="font-mono text-gray-900">{p.ref}</span>
                {showProject && p.project && <span className="text-gray-500"> · {p.project}</span>}
                {p.what && <span className="block text-[12px] text-gray-500 truncate">{p.what}{p.value != null ? ` · ${formatINR(p.value)}` : ''}</span>}
              </span>
              <span className={`text-[12px] tabular-nums whitespace-nowrap ${late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                {p.by ? `${p.by} · ` : ''}{days(d)}{late ? ' — late' : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ── One flat list of lines that need someone ───────────────────────────── */

export interface ActionRow { item: IndentItem; indent: IndentRow }

const NEXT_SHORT: Record<IndentItem['next'], string> = {
  'indent approval': 'indent approval', 'raise PO': 'PO to be raised', 'PO approval': 'PO approval', 'delivery': 'delivery', 'done': 'received', 'closed': 'closed',
}

export function ActionList({ rows, showProject = false, empty }: { rows: ActionRow[]; showProject?: boolean; empty: string }) {
  if (rows.length === 0) return <Calm text={empty} />
  const sorted = [...rows].sort((a, b) => (b.item.waitingDays ?? 0) - (a.item.waitingDays ?? 0))
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="hidden md:grid grid-cols-[1fr_14rem_10rem_8rem] gap-2 px-3 py-1.5 text-[12px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
        <span>Item</span><span>Indent</span><span>Where it stands</span><span className="text-right">Waiting</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {sorted.map(({ item: it, indent: r }) => {
          const po = it.pos.find(p => p.stage !== 'approved') ?? it.pos[it.pos.length - 1]
          return (
            <li key={`${r.id}:${it.id}`} className="px-3 py-2 grid grid-cols-1 md:grid-cols-[1fr_14rem_10rem_8rem] gap-x-2 gap-y-0.5 text-[13px] items-baseline">
              <span className="min-w-0">
                <span className="font-medium text-gray-900">{it.material}</span>
                <span className="text-gray-500"> · {qty(it.qty)} {it.uom ?? ''}{it.poQty > 0 && it.poQty + 0.001 < it.qty ? ` (${qty(it.poQty)} ordered)` : ''}</span>
              </span>
              <span className="min-w-0 text-[12px]">
                <span className="font-mono text-gray-700">{r.ref}</span>
                {showProject && (r.subproject ?? r.project) && <span className="block text-gray-500 truncate">{r.subproject ?? r.project}</span>}
              </span>
              <span className="text-[12px] text-gray-600 min-w-0">
                {it.next === 'PO approval' || it.next === 'delivery'
                  ? <>{po?.poNo ?? 'PO'}{po ? ` · ${po.status}` : ''}{it.next === 'delivery' && it.receivedQty > 0 ? ` · ${qty(it.receivedQty)} received` : ''}</>
                  : NEXT_SHORT[it.next]}
              </span>
              <span className={`text-[12px] tabular-nums md:text-right ${it.late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                {days(it.waitingDays)}{it.late ? ' — late' : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Calm({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-6 text-center text-[13px] text-emerald-900 flex items-center justify-center gap-2">
      <CheckCircle2 className="h-4 w-4" /> {text}
    </p>
  )
}

/* ── The full tree, slim ────────────────────────────────────────────────── */

const clean = (name: string) => name.replace(/^\d+\s+/, '')
const open = (x: { awaitingPo: number; awaitingDelivery: number }) => x.awaitingPo + x.awaitingDelivery
const ROW = 'grid grid-cols-[1fr_auto] md:grid-cols-[1fr_7rem_8rem] gap-x-3 items-center'

function Right({ openCount, money, small }: { openCount: number; money: number; small?: boolean }) {
  return (
    <>
      <span className={`text-right tabular-nums ${small ? 'text-[12px]' : 'text-[13px]'} ${openCount > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>{openCount > 0 ? `${openCount} open` : '—'}</span>
      <span className={`hidden md:block text-right tabular-nums ${small ? 'text-[12px] text-gray-500' : 'text-[13px] text-gray-600'}`}>{money > 0.5 ? formatINR(money) : '—'}</span>
    </>
  )
}

export function TreeHeader() {
  return (
    <div className={`${ROW} px-3 py-1.5 text-[12px] uppercase tracking-wide text-gray-400 border-b border-gray-100`}>
      <span>Category · sub-category · indent</span><span className="text-right">Open items</span><span className="hidden md:block text-right">PO’d</span>
    </div>
  )
}

export function TreeBody({ cats, idPrefix = '' }: { cats: IndentsCatRow[]; idPrefix?: string }) {
  return <div className="divide-y divide-gray-100">{cats.map(c => <CatRow key={c.id} c={c} idPrefix={idPrefix} />)}</div>
}

function CatRow({ c, idPrefix }: { c: IndentsCatRow; idPrefix: string }) {
  const key = `${idPrefix}${c.id}`
  return (
    <div>
      <div className={`${ROW} px-3 py-2`}>
        <span className="flex items-center gap-1 text-[13px] min-w-0">
          <RowDetailToggle id={key} count={c.subs.length} label="sub-categories" />
          <span className="font-semibold text-gray-900 truncate">{clean(c.name)}</span>
          <span className="text-[12px] text-gray-400 whitespace-nowrap">{c.indents} indent{c.indents === 1 ? '' : 's'}</span>
        </span>
        <Right openCount={open(c)} money={c.poValue} />
      </div>
      <RowDetail id={key}>
        <div className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
          {c.subs.map(sb => <SubRow key={sb.id} sb={sb} idPrefix={idPrefix} />)}
        </div>
      </RowDetail>
    </div>
  )
}

function SubRow({ sb, idPrefix }: { sb: IndentsSubRow; idPrefix: string }) {
  const key = `${idPrefix}${sb.id}`
  return (
    <div>
      <div className={`${ROW} pl-8 pr-3 py-1.5`}>
        <span className="flex items-center gap-1 text-[13px] min-w-0">
          <RowDetailToggle id={key} count={sb.indents.length} label="indents" />
          <span className="font-medium text-gray-900 truncate">{clean(sb.name)}</span>
          <span className="text-[12px] text-gray-400 whitespace-nowrap">{sb.indents.length}</span>
        </span>
        <Right small openCount={open(sb)} money={sb.poValue} />
      </div>
      <RowDetail id={key}>
        <div className="bg-white border-t border-gray-100 divide-y divide-gray-100">
          {sb.indents.map(r => <IndentLine key={`${sb.id}:${r.id}`} r={r} idPrefix={key} />)}
        </div>
      </RowDetail>
    </div>
  )
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
  if (pendingPo) return { text: `${pendingPo.poNo ?? 'PO'} at ${pendingPo.status}${since}`, tone: late ? 'late' : 'wait' }
  if (waiting.some(i => i.next === 'raise PO')) return { text: `Partly ordered — ${r.items.filter(i => i.next === 'raise PO').length} line${r.items.filter(i => i.next === 'raise PO').length === 1 ? '' : 's'} without a PO${since}`, tone: late ? 'late' : 'wait' }
  if (recQty + 0.001 >= poQty) return { text: `Received in full${r.pos.length === 1 ? ` · ${r.pos[0].poNo ?? 'PO'}` : ` · ${r.pos.length} POs`}`, tone: 'ok' }
  return { text: `Received ${qty(recQty)} of ${qty(poQty)}${since}`, tone: late ? 'late' : 'wait' }
}

export function IndentLine({ r, idPrefix, showProject = false }: { r: IndentRow; idPrefix: string; showProject?: boolean }) {
  const key = `${idPrefix}:ind:${r.id}`
  const sum = cycleSummary(r)
  const tone = sum.tone === 'late' ? 'text-rose-700' : sum.tone === 'wait' ? 'text-amber-700' : sum.tone === 'ok' ? 'text-emerald-700' : 'text-gray-500'
  return (
    <div>
      <div className={`${ROW} pl-14 pr-3 py-1.5`}>
        <span className="min-w-0">
          <span className="flex items-center gap-2 flex-wrap text-[13px]">
            <RowDetailToggle id={key} count={r.items.length} label="items" />
            <span className="font-mono text-gray-800">{r.ref}</span>
            {r.date && <span className="text-[12px] text-gray-500">{formatDate(r.date)}</span>}
            {r.raisedBy && <span className="text-[12px] text-gray-500 hidden sm:inline">{r.raisedBy}</span>}
            {showProject && (r.subproject ?? r.project) && <span className="text-[12px] text-gray-500">{r.subproject ?? r.project}</span>}
          </span>
          <span className={`block ml-6 text-[12px] ${tone}`}>{sum.text}</span>
        </span>
        <Right small openCount={open(r)} money={r.poValue} />
      </div>
      <RowDetail id={key}>
        <div className="bg-slate-50/60 border-t border-gray-100">
          <ul className="divide-y divide-gray-100">{r.items.map(it => <ItemLine key={it.id} it={it} />)}</ul>
          <div className="pl-20 pr-3 py-1.5 flex items-center gap-1 text-[12px] text-gray-500">
            <RowDetailToggle id={`${key}:detail`} count={1} label="the audit trail, POs and receipts" />
            <span>Details — who did what and when, POs, receipts</span>
          </div>
          <RowDetail id={`${key}:detail`}><Details r={r} /></RowDetail>
        </div>
      </RowDetail>
    </div>
  )
}

function ItemLine({ it }: { it: IndentItem }) {
  const phrase = it.next === 'done' ? (it.closedForPo && it.poQty + 0.001 < it.qty ? `received in full · closed for PO at ${qty(it.poQty)}` : 'received in full')
    : it.next === 'closed' ? 'closed'
    : `${NEXT_SHORT[it.next]}${it.waitingDays != null && it.waitingDays > 0 ? ` · ${days(it.waitingDays)}` : ''}${it.late ? ' — late' : ''}`
  return (
    <li className="pl-20 pr-3 py-1.5 text-[12px] flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="font-medium text-gray-900">{it.material}</span>
      <span className="tabular-nums text-gray-600">{qty(it.qty)} {it.uom ?? ''}{it.poQty > 0 && it.poQty + 0.001 < it.qty ? ` · ${qty(it.poQty)} ordered` : ''}{it.receivedQty > 0 && it.receivedQty + 0.001 < it.poQty ? ` · ${qty(it.receivedQty)} received` : ''}</span>
      <span className={`ml-auto ${it.next === 'done' ? 'text-emerald-700' : it.next === 'closed' ? 'text-gray-400' : it.late ? 'text-rose-700 font-semibold' : 'text-amber-700'}`}>{phrase}</span>
    </li>
  )
}

/** The full record: the indent's chain, then each PO with its chain and receipts. */
function Details({ r }: { r: IndentRow }) {
  const step = (c: ChainStep) => `${c.status}${c.at ? ` ${formatDate(c.at)}` : ''}${c.by ? ` · ${c.by}` : ''}${c.remark ? ` — “${c.remark}”` : ''}`
  const pos = new Map<number, IndentItem['pos'][number]>()
  for (const it of r.items) for (const p of it.pos) if (!pos.has(p.poId)) pos.set(p.poId, p)
  return (
    <div className="pl-20 pr-3 pb-2 text-[12px] text-gray-600 space-y-1.5">
      {r.remarks && <p className="italic">“{r.remarks}”</p>}
      <p><span className="text-gray-400">Indent · </span>{r.chain.length ? r.chain.map(step).join(' → ') : 'no audit trail in IN4'}{r.woNo ? ` · for ${r.woNo}` : ''}</p>
      {[...pos.values()].map(p => (
        <p key={p.poId}>
          <span className="text-gray-400">PO · </span><span className="font-mono text-gray-800">{p.poNo ?? p.poId}</span>{p.supplier ? ` · ${p.supplier}` : ''} · {formatINR(r.items.flatMap(i => i.pos).filter(x => x.poId === p.poId).reduce((t, x) => t + x.value, 0))}
          {p.chain.length > 0 && <> · {p.chain.map(step).join(' → ')}</>}
          {p.grns.length > 0 && <> · received {p.grns.map(g => `${qty(g.qty)}${g.date ? ` on ${formatDate(g.date)}` : ''}`).join(', ')}</>}
          {' · '}<a href={`/api/in4/purchase-order/${p.poId}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">PO</a>
          {' · '}<a href={`/api/in4/purchase-order/${p.poId}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">ledger</a>
        </p>
      ))}
    </div>
  )
}
