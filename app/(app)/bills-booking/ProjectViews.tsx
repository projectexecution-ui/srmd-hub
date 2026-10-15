// The Bills home, project-first (Aksha, 12 Oct 2026; enhanced the same day:
// "Still i am unhappy with the view - can u enhance").
//
//   Step strip   Entered → … → Trust: bills, money and late per step — tap one to filter.
//   Scope        Waiting on me · My projects · All, plus search, person and sort.
//   Projects     one card per IN4 main project: pending money, the steps as
//                coloured labels, IN4's whole position (orders · billed · paid ·
//                balance); inside, each sub-project with its team and its bills.
//   Tree         main project → sub-project → bills; the steps as columns with
//                count and money, a Late column, totals at the foot.
//
// Server-rendered: filters are links and a GET form, folds are <details>.
// Card → box → row, the hub's three shapes. Phone: text lines, no bars.

import Link from 'next/link'
import { ChevronRight, FolderTree, LayoutList, Search, X } from 'lucide-react'
import { formatDate, formatINR, formatINRCompact } from '@/lib/utils'
import { stageDef, type AgeTone, type BbStage } from '@/lib/bills-booking/stages'
import {
  TREE_STAGES, stageLine,
  type MainNode, type SubNode, type StageCell, type Position, type Scope, type SortBy, type ShownBill,
} from '@/lib/bills-booking/project-views'

const SHORT: Partial<Record<BbStage, string>> = {
  submitted: 'Entered', site_head: 'Site Head', disc_head: 'Disc Head', ct_head: 'CT Head',
  ct_billing: 'CT Billing', atm_in4: 'Atm (IN4)', trust: 'Trust',
}
const label = (s: BbStage) => SHORT[s] ?? stageDef(s).label
const days = (d: number) => (d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`)

// One colour per step, the same on the strip, the cards and the tree.
const TONE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-800 ring-slate-300',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  gray: 'bg-gray-100 text-gray-700 ring-gray-200',
  rose: 'bg-rose-50 text-rose-800 ring-rose-200',
}
const tone = (s: BbStage) => TONE[stageDef(s).tone] ?? TONE.gray
const AGE: Record<AgeTone, string> = {
  ok: 'text-gray-600', warn: 'font-semibold text-amber-700', late: 'font-bold text-rose-700', none: 'text-gray-500',
}

function StepPill({ s, n }: { s: BbStage; n?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone(s)}`}>
      {label(s)}{n != null && <b className="tabular-nums">{n}</b>}
    </span>
  )
}

// ── The step strip ───────────────────────────────────────────────────────
function StepTile({ href, on, title, c, s }: { href: string; on: boolean; title: string; c: StageCell; s?: BbStage }) {
  return (
    <Link href={href} scroll={false} aria-current={on ? 'true' : undefined}
          className={`flex min-h-[58px] flex-col justify-between rounded-xl border px-2 py-1.5 transition-colors sm:min-h-[72px] sm:px-3 sm:py-2 ${
            on ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : c.n ? 'border-gray-200 bg-white hover:border-indigo-300' : 'border-dashed border-gray-200 bg-gray-50/60'}`}>
      <span className="flex items-center gap-1 truncate text-[9.5px] font-bold uppercase tracking-wide text-gray-500 sm:gap-1.5 sm:text-[10.5px]">
        {s && <span className={`h-2 w-2 rounded-full ring-1 ring-inset ${tone(s)}`} aria-hidden />}{title}
      </span>
      <span className={`text-[17px] font-extrabold leading-none tabular-nums sm:text-[20px] ${c.n ? 'text-gray-900' : 'text-gray-300'}`}>{c.n}</span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-[10.5px] tabular-nums text-gray-600 sm:text-[11.5px]">
        <span className="hidden sm:inline">{c.n ? formatINRCompact(c.amount) : '—'}</span>
        {c.late > 0 && <b className="font-bold text-rose-700">{c.late} late</b>}
      </span>
    </Link>
  )
}

export function StepStrip({ totals, active, hrefFor, allHref }: {
  totals: Record<string, StageCell>; active: BbStage | null
  hrefFor: (s: BbStage) => string; allHref: string
}) {
  const all = Object.values(totals).reduce((a, c) => ({ n: a.n + c.n, amount: a.amount + c.amount, late: a.late + c.late }), { n: 0, amount: 0, late: 0 })
  return (
    <nav aria-label="Bills by step" className="grid grid-cols-4 gap-1.5 sm:gap-2 lg:grid-cols-8">
      <StepTile href={allHref} on={active == null} title="All steps" c={all} />
      {TREE_STAGES.map(s => <StepTile key={s} href={hrefFor(s)} on={active === s} title={label(s)} c={totals[s] ?? { n: 0, amount: 0, late: 0 }} s={s} />)}
    </nav>
  )
}

// ── Scope, view, search ──────────────────────────────────────────────────
export function ViewBar({ scope, counts, scopeHref, look, lookHref, q, who, people, sort, keep, clearHref, openAllHref, openAll }: {
  scope: Scope; counts: Record<Scope, number>; scopeHref: (s: Scope) => string
  look: Look; lookHref: (l: Look) => string
  q: string | null; who: string | null; people: string[]; sort: SortBy
  /** Params the search form must carry along. */
  keep: Record<string, string>
  clearHref: string | null
  openAllHref: string; openAll: boolean
}) {
  const seg = (on: boolean) => `inline-flex min-h-[40px] items-center gap-1.5 px-3 text-[13px] font-semibold ${on ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`
  const SCOPES: Array<[Scope, string, string]> = [['mine', 'Waiting on me', 'On me'], ['projects', 'My projects', 'My projects'], ['all', 'All projects', 'All']]
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-gray-300 divide-x divide-gray-300 sm:inline-flex sm:w-auto">
          {SCOPES.map(([k, t, short]) => (
            <Link key={k} href={scopeHref(k)} scroll={false} aria-current={scope === k ? 'true' : undefined} className={`${seg(scope === k)} justify-center`}>
              <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{t}</span>
              <span className={`tabular-nums ${scope === k ? 'text-indigo-100' : 'text-gray-400'}`}>{counts[k]}</span>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={openAllHref} scroll={false} className="hidden min-h-[40px] items-center rounded-lg px-2 text-[12.5px] font-semibold text-gray-600 hover:text-gray-900 sm:inline-flex">
            {openAll ? 'Fold all' : 'Open all'}
          </Link>
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 divide-x divide-gray-300">
            <Link href={lookHref('projects')} scroll={false} aria-current={look === 'projects' ? 'true' : undefined} className={seg(look === 'projects')}>
              <LayoutList className="h-4 w-4" /> Projects
            </Link>
            <Link href={lookHref('tree')} scroll={false} aria-current={look === 'tree' ? 'true' : undefined} className={seg(look === 'tree')}>
              <FolderTree className="h-4 w-4" /> Tree
            </Link>
          </div>
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Search projects, parties and bill numbers</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input id="bb-pq" name="pq" defaultValue={q ?? ''} placeholder="Project, party or bill no"
                 className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-2 text-[13px] focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </label>
        <label className="flex-1 basis-40 sm:flex-none">
          <span className="sr-only">Who holds it</span>
          <select id="bb-who" name="who" defaultValue={who ?? ''}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-[13px] sm:w-48">
            <option value="">Anyone holding it</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex-1 basis-32 sm:flex-none">
          <span className="sr-only">Order</span>
          <select id="bb-sort" name="sort" defaultValue={sort}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-[13px] sm:w-44">
            <option value="wait">Longest pending first</option>
            <option value="amount">Biggest ₹ first</option>
            <option value="name">Project A–Z</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-lg bg-gray-900 px-3 text-[13px] font-semibold text-white hover:bg-gray-800">Show</button>
        {clearHref && (
          <Link href={clearHref} scroll={false} className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold text-gray-600 hover:text-gray-900">
            <X className="h-3.5 w-3.5" /> Clear
          </Link>
        )}
      </form>
    </div>
  )
}

export type Look = 'projects' | 'tree'

// ── IN4 position ─────────────────────────────────────────────────────────
function PositionGrid({ p, compact = false }: { p: Position; compact?: boolean }) {
  const cells: Array<[string, number, string?]> = [
    ['IN4 orders', p.orders, `${p.woCount} ${p.woCount === 1 ? 'WO' : 'WOs'}`],
    ['Billed', p.billed, p.orders > 0 ? `${Math.round((p.billed / p.orders) * 100)}% of orders` : undefined],
    ['Paid', p.paid],
    ['Balance', p.billed - p.paid, 'billed, not yet paid'],
  ]
  if (compact) {
    return (
      <p className="text-[11.5px] tabular-nums text-gray-600">
        {cells.map(([k, v], i) => <span key={k}>{i > 0 && ' · '}<span className="text-gray-400">{k}</span> {formatINRCompact(v)}</span>)}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 md:grid-cols-4">
      {cells.map(([k, v, note]) => (
        <div key={k} className="bg-gray-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{k}</p>
          <p className={`text-[15px] font-bold tabular-nums ${k === 'Balance' && v > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{formatINRCompact(v)}</p>
          {note && <p className="text-[10.5px] text-gray-500">{note}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Projects ─────────────────────────────────────────────────────────────
function Team({ s }: { s: SubNode }) {
  const seats = s.team.filter(t => t.names.length)
  if (!seats.length) return <p className="text-[11.5px] text-amber-700">No desk set for this sub-project yet — set it under Desks.</p>
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-gray-700">
      {seats.map(t => <span key={t.label}><span className="text-gray-400">{t.label}</span> {t.names.join(', ')}</span>)}
    </p>
  )
}

const FIRST = 8

function BillsTable({ bills, head = true }: { bills: ShownBill[]; head?: boolean }) {
  if (head && bills.length > FIRST + 2) {
    const rest = bills.slice(FIRST)
    return (
      <>
        <BillsTable bills={bills.slice(0, FIRST)} />
        <details className="group/more border-t border-gray-100">
          <summary className="flex min-h-[40px] cursor-pointer list-none items-center px-3 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50/40">
            <span className="group-open/more:hidden">Show {rest.length} more {rest.length === 1 ? 'bill' : 'bills'}</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <BillsTable bills={rest} head={false} />
        </details>
      </>
    )
  }
  return (
    <>
      {/* Laptop: a table. */}
      <table className="hidden w-full table-fixed text-left text-[12.5px] md:table">
        <colgroup><col className="w-[28%]" /><col className="w-[12%]" /><col className="w-[19%]" /><col className="w-[14%]" /><col className="w-[13%]" /><col className="w-[14%]" /></colgroup>
        <thead className={head ? '' : 'sr-only'}>
          <tr className="border-b border-gray-200 text-[10.5px] uppercase tracking-wide text-gray-500">
            <th className="px-3 py-1.5 font-bold">Party · bill no</th>
            <th className="px-3 py-1.5 font-bold">Step</th>
            <th className="px-3 py-1.5 font-bold">With</th>
            <th className="px-3 py-1.5 font-bold">Since entry</th>
            <th className="px-3 py-1.5 font-bold">At this desk</th>
            <th className="px-3 py-1.5 text-right font-bold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bills.map(b => (
            <tr key={b.id} className={`hover:bg-indigo-50/40 ${b.mine ? 'bg-indigo-50/60' : ''}`}>
              <td className="px-3 py-2">
                <Link href={`/bills-booking/${b.id}`} className="font-semibold text-gray-900 hover:text-indigo-700 hover:underline">{b.vendor}</Link>
                <span className="block font-mono text-[11px] text-gray-500">{b.serial ? `${b.serial} · ` : ''}{b.billNo ?? '—'}{b.orderNo ? ` · ${b.orderNo}` : ''}</span>
              </td>
              <td className="px-3 py-2"><StepPill s={b.stage} /></td>
              <td className="px-3 py-2 text-gray-700">
                {b.holders.length ? b.holders.join(', ') : <span className="text-amber-700">nobody set</span>}
                {b.mine && <b className="ml-1 rounded bg-indigo-600 px-1 py-px text-[10px] font-bold text-white">YOU</b>}
              </td>
              <td className="px-3 py-2 tabular-nums">
                <b className="text-gray-900">{days(b.pendingDays)}</b>
                <span className="block text-[11px] text-gray-500">entered {formatDate(b.enteredAt)}</span>
              </td>
              <td className={`px-3 py-2 tabular-nums ${AGE[b.tone]}`}>
                {days(b.days)}{b.tone === 'late' ? ' · late' : ''}
                {b.heldInIn4 && <span className="block text-[11px] font-bold text-rose-700">on hold in IN4</span>}
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Phone: the same lines on every bill. */}
      <ul className="divide-y divide-gray-100 md:hidden">
        {bills.map(b => (
          <li key={b.id}>
            <Link href={`/bills-booking/${b.id}`} className={`block px-3 py-2.5 ${b.mine ? 'bg-indigo-50/60' : ''}`}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-[13px] font-semibold text-gray-900">{b.vendor}</span>
                <span className="text-[13px] font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</span>
              </span>
              <span className="block font-mono text-[11px] text-gray-500">{b.serial ? `${b.serial} · ` : ''}{b.billNo ?? '—'}</span>
              <span className="block text-[12px] text-gray-700">
                {stageDef(b.stage).label} — {b.holders.length ? b.holders.join(', ') : 'nobody set'}{b.mine ? ' (you)' : ''}
              </span>
              <span className="block text-[12px] tabular-nums text-gray-700">Pending <b className="text-gray-900">{days(b.pendingDays)}</b> since entry · entered {formatDate(b.enteredAt)}</span>
              <span className={`block text-[12px] tabular-nums ${AGE[b.tone]}`}>{days(b.days)} at this desk{b.tone === 'late' ? ' · late' : ''}{b.heldInIn4 && <b className="text-rose-700"> · on hold in IN4</b>}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

function ProjectCard({ m, open, openAll }: { m: MainNode; open: boolean; openAll: boolean }) {
  return (
    <details open={open} className={`group rounded-2xl border bg-white shadow-sm ${m.mine ? 'border-indigo-200' : 'border-gray-200'}`}>
      <summary className="cursor-pointer list-none space-y-2.5 px-4 py-3.5 min-h-[44px]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
          <div className="min-w-0">
            <p className="text-[17px] font-bold leading-snug text-gray-900">
              <ChevronRight className="-ml-1 mr-0.5 inline h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />{m.name}
            </p>
            <p className="mt-0.5 text-[12px] text-gray-600">
              {m.subs.length} {m.subs.length === 1 ? 'sub-project' : 'sub-projects'} · {m.n} {m.n === 1 ? 'bill' : 'bills'} pending · longest at a desk {days(m.oldestDays)}
              {m.late > 0 && <b className="font-bold text-rose-700"> · {m.late} late</b>}
              {m.waitingOnMe > 0 && <b className="font-semibold text-indigo-700"> · {m.waitingOnMe} waiting on you</b>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[20px] font-extrabold leading-none tabular-nums text-gray-900">{formatINRCompact(m.amount)}</p>
            <p className="mt-1 text-[10.5px] uppercase tracking-wide text-gray-500">pending here</p>
          </div>
        </div>
        <div className="hidden flex-wrap gap-1.5 md:flex">
          {TREE_STAGES.filter(s => m.byStage[s]?.n).map(s => <StepPill key={s} s={s} n={m.byStage[s]!.n} />)}
        </div>
        <p className="text-[12px] text-gray-700 md:hidden">{stageLine(m.byStage, label)}</p>
        {m.position && <PositionGrid p={m.position} />}
      </summary>
      <div className="space-y-2 border-t border-gray-100 px-3 py-3">
        {m.subs.map(s => (
          <details key={s.key} open={openAll || s.waitingOnMe > 0 || m.subs.length === 1 || m.n <= 6}
                   className="group/sub overflow-hidden rounded-xl border border-gray-200 bg-white">
            <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 bg-gray-50 px-3 py-2.5 min-h-[44px] hover:bg-gray-100/70">
              <span className="min-w-0">
                <span className="text-[14px] font-bold text-gray-900" title={s.fullName}>
                  <ChevronRight className="-ml-0.5 mr-0.5 inline h-3.5 w-3.5 text-gray-400 transition-transform group-open/sub:rotate-90" />{s.name}
                </span>
                <span className="ml-1 hidden flex-wrap gap-1 align-middle md:inline-flex">
                  {TREE_STAGES.filter(st => s.byStage[st]?.n).map(st => <StepPill key={st} s={st} n={s.byStage[st]!.n} />)}
                </span>
              </span>
              <span className="text-right text-[12px] tabular-nums text-gray-700">
                <b className="text-[13px] text-gray-900">{formatINRCompact(s.amount)}</b>
                <span className="block">{s.n} {s.n === 1 ? 'bill' : 'bills'}{s.late > 0 && <b className="text-rose-700"> · {s.late} late</b>}{s.waitingOnMe > 0 && <b className="text-indigo-700"> · {s.waitingOnMe} yours</b>}</span>
              </span>
              <span className="col-span-2 text-[11.5px] text-gray-600 md:hidden">{stageLine(s.byStage, label)}</span>
            </summary>
            <div className="space-y-1 border-t border-gray-100 bg-gray-50/60 px-3 py-2">
              {s.position && <PositionGrid p={s.position} compact />}
              <Team s={s} />
            </div>
            <div className="border-t border-gray-100"><BillsTable bills={s.bills} /></div>
          </details>
        ))}
      </div>
    </details>
  )
}

export function ProjectsLook({ mains, openAll }: { mains: MainNode[]; openAll: boolean }) {
  const mine = mains.filter(m => m.mine)
  const others = mains.filter(m => !m.mine)
  const few = mains.length <= 2
  return (
    <div className="space-y-3">
      {mine.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Your projects</p>}
      {mine.map(m => <ProjectCard key={m.key} m={m} open openAll={openAll} />)}
      {mine.length > 0 && others.length > 0 && <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Other projects</p>}
      {others.map(m => <ProjectCard key={m.key} m={m} open={openAll || few} openAll={openAll} />)}
    </div>
  )
}

// ── Tree ─────────────────────────────────────────────────────────────────
const GRID = 'md:grid-cols-[minmax(240px,2.6fr)_repeat(7,minmax(74px,1fr))_minmax(80px,0.8fr)_minmax(64px,0.7fr)_minmax(104px,1.1fr)]'

function heat(n: number, max: number) {
  if (!n || !max) return ''
  const r = n / max
  return r > 0.66 ? 'bg-indigo-100' : r > 0.33 ? 'bg-indigo-50' : 'bg-indigo-50/40'
}

function Cells({ byStage, late, amount, n, max, strong }: {
  byStage: Partial<Record<BbStage, StageCell>>; late: number; amount: number; n: number; max: number; strong?: boolean
}) {
  return (
    <>
      {TREE_STAGES.map(s => {
        const c = byStage[s]
        return (
          <span key={s} className={`hidden self-stretch rounded px-1 py-1 text-center md:block ${heat(c?.n ?? 0, max)}`}>
            {c?.n ? (
              <>
                <b className={`block tabular-nums text-gray-900 ${strong ? 'text-[13.5px]' : 'text-[12.5px]'}`}>{c.n}</b>
                <span className="block text-[10.5px] tabular-nums text-gray-600">{formatINRCompact(c.amount)}</span>
              </>
            ) : <span className="text-gray-300">·</span>}
          </span>
        )
      })}
      {/* Since entry: shown against each bill, not per project. */}
      <span className="hidden md:block" />
      <span className="hidden text-center md:block">{late ? <b className="text-[12.5px] tabular-nums text-rose-700">{late}</b> : <span className="text-gray-300">·</span>}</span>
      <span className="text-right">
        <b className={`block tabular-nums text-gray-900 ${strong ? 'text-[14px]' : 'text-[13px]'}`}>{formatINRCompact(amount)}</b>
        <span className="block text-[10.5px] text-gray-500">{n} {n === 1 ? 'bill' : 'bills'}</span>
      </span>
    </>
  )
}

export function TreeLook({ mains, openAll }: { mains: MainNode[]; openAll: boolean }) {
  const max = Math.max(1, ...mains.flatMap(m => m.subs.flatMap(s => TREE_STAGES.map(st => s.byStage[st]?.n ?? 0))))
  const foot = TREE_STAGES.map(st => mains.reduce((a, m) => ({ n: a.n + (m.byStage[st]?.n ?? 0), amount: a.amount + (m.byStage[st]?.amount ?? 0), late: a.late + (m.byStage[st]?.late ?? 0) }), { n: 0, amount: 0, late: 0 }))
  const total = mains.reduce((a, m) => ({ n: a.n + m.n, amount: a.amount + m.amount, late: a.late + m.late }), { n: 0, amount: 0, late: 0 })
  const sticky = 'md:sticky md:left-0 md:z-10'
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="md:min-w-[1160px]">
        <div className={`hidden ${GRID} items-end gap-x-1.5 border-b border-gray-200 bg-gray-50 px-4 py-2 text-[10.5px] font-bold uppercase tracking-wide text-gray-500 md:grid`}>
          <span className={`${sticky} bg-gray-50`}>Main project → sub-project → bill</span>
          {TREE_STAGES.map(st => <span key={st} className="text-center"><StepPill s={st} /></span>)}
          <span className="text-center">Since entry</span>
          <span className="text-center text-rose-700">Late</span>
          <span className="text-right">Amount</span>
        </div>
        {mains.map(m => (
          <details key={m.key} open={openAll || m.mine} className="group/m border-b border-gray-200 last:border-b-0">
            <summary className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-x-1.5 px-4 py-2.5 min-h-[48px] hover:bg-gray-50`}>
              <span className={`min-w-0 ${sticky} bg-white`}>
                <span className="text-[14px] font-bold text-gray-900">
                  <ChevronRight className="mr-1 inline h-4 w-4 text-gray-400 transition-transform group-open/m:rotate-90" />{m.name}
                </span>
                <span className="block pl-5 text-[11px] text-gray-500">
                  {m.subs.length} {m.subs.length === 1 ? 'sub-project' : 'sub-projects'}
                  {m.position && <> · billed {formatINRCompact(m.position.billed)} of {formatINRCompact(m.position.orders)}</>}
                  {m.waitingOnMe > 0 && <b className="font-semibold text-indigo-700"> · {m.waitingOnMe} on you</b>}
                </span>
                <span className="block pl-5 text-[11.5px] text-gray-700 md:hidden">{stageLine(m.byStage, label)}</span>
              </span>
              <Cells byStage={m.byStage} late={m.late} amount={m.amount} n={m.n} max={max} strong />
            </summary>
            {m.subs.map(s => (
              <details key={s.key} open={openAll} className="group/s border-t border-gray-100 bg-gray-50/50">
                <summary className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-x-1.5 px-4 py-2 min-h-[44px] hover:bg-gray-100/60`}>
                  <span className={`min-w-0 pl-5 ${sticky} bg-gray-50`}>
                    <span className="text-[13px] font-semibold text-gray-900" title={s.fullName}>
                      <ChevronRight className="mr-1 inline h-3.5 w-3.5 text-gray-400 transition-transform group-open/s:rotate-90" />{s.name}
                    </span>
                    {s.position && <span className="block pl-5 text-[11px] text-gray-500">billed {formatINRCompact(s.position.billed)} of {formatINRCompact(s.position.orders)} · balance {formatINRCompact(s.position.billed - s.position.paid)}</span>}
                    <span className="block pl-5 text-[11.5px] text-gray-700 md:hidden">{stageLine(s.byStage, label)}</span>
                  </span>
                  <Cells byStage={s.byStage} late={s.late} amount={s.amount} n={s.n} max={max} />
                </summary>
                <div className="divide-y divide-gray-100 border-t border-gray-100 bg-white">
                  {s.bills.map(b => (
                    <Link key={b.id} href={`/bills-booking/${b.id}`}
                          className={`grid grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-x-1.5 px-4 py-2 hover:bg-indigo-50/40 ${b.mine ? 'bg-indigo-50/60' : ''}`}>
                      <span className={`min-w-0 pl-10 ${sticky} ${b.mine ? 'bg-indigo-50' : 'bg-white'}`}>
                        <span className="block text-[12.5px] font-semibold text-gray-900">{b.vendor}</span>
                        <span className="block text-[11px] text-gray-500">
                          <span className="font-mono">{b.billNo ?? '—'}</span> · {b.holders.length ? b.holders.join(', ') : 'nobody set'}{b.mine ? ' (you)' : ''}
                          {b.heldInIn4 && <b className="hidden text-rose-700 md:inline"> · on hold in IN4</b>}
                        </span>
                        <span className={`block text-[11.5px] md:hidden ${AGE[b.tone]}`}>{stageDef(b.stage).label} · {days(b.days)} at this desk{b.heldInIn4 && <b className="text-rose-700"> · on hold in IN4</b>}</span>
                        <span className="block text-[11.5px] text-gray-700 md:hidden">Pending {days(b.pendingDays)} since entry · entered {formatDate(b.enteredAt)}</span>
                      </span>
                      {TREE_STAGES.map(st => (
                        <span key={st} className="hidden text-center md:block">
                          {st === b.stage
                            ? <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset tabular-nums ${tone(st)}`}>
                                <span className={b.tone === 'late' ? 'text-rose-700' : b.tone === 'warn' ? 'text-amber-800' : ''}>{days(b.days)}</span>
                              </span>
                            : <span className="text-gray-200">·</span>}
                        </span>
                      ))}
                      <span className="hidden text-center md:block">
                        <b className="block text-[12px] tabular-nums text-gray-900">{days(b.pendingDays)}</b>
                        <span className="block text-[10px] text-gray-500">{formatDate(b.enteredAt)}</span>
                      </span>
                      <span className="hidden text-center md:block">{b.tone === 'late' || b.tone === 'warn' ? <b className="text-[11px] text-rose-700">late</b> : <span className="text-gray-200">·</span>}</span>
                      <span className="text-right text-[12.5px] font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</span>
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </details>
        ))}
        {mains.length > 1 && (
          <div className={`hidden ${GRID} items-center gap-x-1.5 border-t-2 border-gray-300 bg-gray-50 px-4 py-2.5 md:grid`}>
            <span className={`${sticky} bg-gray-50 text-[12px] font-bold uppercase tracking-wide text-gray-600`}>Total — {mains.length} projects</span>
            {foot.map((c, i) => (
              <span key={TREE_STAGES[i]} className="text-center">
                {c.n ? <><b className="block text-[13px] tabular-nums text-gray-900">{c.n}</b><span className="block text-[10.5px] tabular-nums text-gray-600">{formatINRCompact(c.amount)}</span></> : <span className="text-gray-300">·</span>}
              </span>
            ))}
            <span />
            <span className="text-center">{total.late ? <b className="text-[13px] tabular-nums text-rose-700">{total.late}</b> : <span className="text-gray-300">·</span>}</span>
            <span className="text-right"><b className="block text-[14px] tabular-nums text-gray-900">{formatINRCompact(total.amount)}</b><span className="block text-[10.5px] text-gray-500">{total.n} bills</span></span>
          </div>
        )}
      </div>
    </div>
  )
}
