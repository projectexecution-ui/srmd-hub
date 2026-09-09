import Link from 'next/link'
import { Search, X, ChevronRight, CheckCircle2 } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { SLA_DAYS, type IndentsCatRow, type IndentFilter, type PendingApproval, type IndentRow } from '@/lib/revamp/indents-tree'
import {
  flattenRows, stageRows, searchRows, groupRows, defaultGroup, groupOptions, isGroupKey, isAgeBand, inAgeBand, bandCounts, AGE_BANDS, GROUP_LABEL,
  headline, pendingValue, supplierOf, shortRef, indentGroups, boardHref,
  type BoardRow, type BoardParams, type GroupKey, type AgeBand, type Headline,
} from '@/lib/revamp/indents-board'
import { ItemLine, Details, cycleSummary } from './IndentRows'

/**
 * The Indents board — one screen for a project's Indent → PO → GRN cycle,
 * shared by the project's Indents tab and the portal-wide tracker.
 *
 * Aksha, 10 Sep 2026: "garbage free and more management friendly … take
 * inspiration from the Indent to PO tracker." So, top to bottom:
 *   1. the pipeline as four numbers with money on them (click one to open it)
 *   2. one list, grouped the way the old tracker grouped — supplier, indent,
 *      category — every group collapsed to a single line with ₹ and the wait
 *   3. search, age bands, and the record only under a chevron
 * Everything is a URL: f (stage), g (grouping), age (band), q (search).
 * Read-only; the doing happens in IN4.
 */

export interface BoardScope { cats: IndentsCatRow[]; pending: PendingApproval[] }

export function IndentBoard({ scopes, base, params, manyProjects = false, months }: {
  scopes: BoardScope[]
  /** The page's path, e.g. /project/<id>/procurement or /procurement-tracker. */
  base: string
  params: BoardParams
  /** Across projects: name the project on each line and offer it as a grouping. */
  manyProjects?: boolean
  /** The tracker's window, for the caption. */
  months?: number
}) {
  const cats = scopes.flatMap(s => s.cats)
  const pending = scopes.flatMap(s => s.pending).sort((a, b) => String(a.since ?? '').localeCompare(String(b.since ?? '')))
  const rows = flattenRows(cats)
  const h = headline(rows, pending)
  const filter: IndentFilter = isFilter(params.f) ? params.f : defaultStage(h)
  const q = params.q?.trim() || undefined
  const group: GroupKey = isGroupKey(params.g) && groupOptions(filter, manyProjects).includes(params.g) ? params.g : defaultGroup(filter, manyProjects)
  const age: AgeBand = isAgeBand(params.age) ? params.age : 'all'
  const href = (patch: Partial<BoardParams>) => boardHref(base, { ...params, f: filter }, patch)

  return (
    <div className="space-y-4">
      <Pipeline h={h} current={filter} href={href} />

      {filter === 'approval'
        ? <Approvals pending={pending} q={q} href={href} base={base} params={{ ...params, f: filter }} manyProjects={manyProjects} />
        : filter === 'all'
          ? <AllIndents cats={cats} q={q} group={group === 'project' || group === 'indent' ? group : 'category'} filter={filter} href={href} base={base} params={{ ...params, f: filter }} manyProjects={manyProjects} />
          : <StageList rows={rows} filter={filter} q={q} group={group} age={age} href={href} base={base} params={{ ...params, f: filter }} manyProjects={manyProjects} />}

      <p className="text-[12px] text-gray-400">
        Live from IN4{months ? ` · indents of the last ${months} months plus every older one still open` : ''} · approvals happen in IN4 · late = over {SLA_DAYS['indent approval']} days for an approval or a PO, over {SLA_DAYS.delivery} for a delivery.
      </p>
    </div>
  )
}

const isFilter = (v: unknown): v is IndentFilter => v === 'all' || v === 'approval' || v === 'po' || v === 'delivery' || v === 'late' || v === 'done'

/** With nothing in the URL: the first stage of the cycle that has something waiting, else the full list. */
function defaultStage(h: Headline): IndentFilter {
  if (h.approval.count) return 'approval'
  if (h.po.count) return 'po'
  if (h.delivery.count) return 'delivery'
  return 'all'
}

const d = (n: number | null) => (n == null ? '' : `${n}d`)
const qty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })

/* ── 1. The pipeline ────────────────────────────────────────────────────── */

function Pipeline({ h, current, href }: { h: Headline; current: IndentFilter; href: (p: Partial<BoardParams>) => string }) {
  const stage = (key: IndentFilter, label: string, count: number, sub: string, tone: 'wait' | 'late' | 'ok' | 'muted') => {
    const active = current === key
    const num = tone === 'late' ? 'text-rose-700' : tone === 'wait' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-gray-400'
    return (
      <Link key={key} href={href({ f: key, q: undefined, g: undefined, age: undefined })} aria-current={active ? 'page' : undefined}
        className={`relative rounded-lg border px-3 py-2 min-h-[44px] block ${active ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
        <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`text-[20px] leading-tight font-semibold tabular-nums ${num}`}>{count.toLocaleString('en-IN')}</p>
        <p className="text-[12px] text-gray-500 truncate">{sub || ' '}</p>
        <ChevronRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" aria-hidden />
      </Link>
    )
  }
  const sub = (x: { oldest: number | null; late: number }, money?: number) =>
    [money && money > 0.5 ? `${formatINR(money)} to come` : null, x.oldest != null && x.oldest > 0 ? `oldest ${d(x.oldest)}` : null, x.late ? `${x.late} late` : null].filter(Boolean).join(' · ')
  return (
    <section aria-label="Indent → PO → GRN">
      <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-x-5 gap-y-2 items-stretch">
        {stage('approval', 'Waiting approval', h.approval.count, sub(h.approval), h.approval.late ? 'late' : h.approval.count ? 'wait' : 'muted')}
        {stage('po', 'To be ordered', h.po.count, sub(h.po), h.po.late ? 'late' : h.po.count ? 'wait' : 'muted')}
        {stage('delivery', 'On order', h.delivery.count, sub(h.delivery, h.delivery.value), h.delivery.late ? 'late' : h.delivery.count ? 'wait' : 'muted')}
        {stage('done', 'Received', h.received.count, h.received.value > 0.5 ? formatINR(h.received.value) : '', 'ok')}
        <div className="col-span-2 md:col-span-1 flex md:flex-col gap-2 md:w-36">
          <Link href={href({ f: 'late', q: undefined, g: undefined, age: undefined })} aria-current={current === 'late' ? 'page' : undefined}
            className={`flex-1 rounded-lg border px-3 py-1.5 min-h-[44px] flex items-center justify-between gap-2 ${current === 'late' ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300' : h.late.count ? 'border-rose-200 bg-white hover:bg-rose-50/40' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <span className="text-[12px] text-gray-600">Late</span>
            <span className={`text-[15px] font-semibold tabular-nums ${h.late.count ? 'text-rose-700' : 'text-gray-400'}`}>{h.late.count}</span>
          </Link>
          <Link href={href({ f: 'all', q: undefined, g: undefined, age: undefined })} aria-current={current === 'all' ? 'page' : undefined}
            className={`flex-1 rounded-lg border px-3 py-1.5 min-h-[44px] flex items-center justify-between gap-2 ${current === 'all' ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <span className="text-[12px] text-gray-600">All indents</span>
            <span className="text-[12px] text-gray-500 tabular-nums">{h.ordered.pos} PO{h.ordered.pos === 1 ? '' : 's'}</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ── Toolbar: search · grouping · age ───────────────────────────────────── */

function Toolbar({ base, params, q, group, groups, age, bands, href, placeholder }: {
  base: string; params: BoardParams; q?: string
  group?: GroupKey; groups?: GroupKey[]
  age?: AgeBand; bands?: ReturnType<typeof bandCounts>
  href: (p: Partial<BoardParams>) => string
  placeholder: string
}) {
  const keep = (['p', 'months', 'f', 'g', 'age'] as const).filter(k => params[k] && !(k === 'f' && params[k] === 'all') && !(k === 'age' && params[k] === 'all'))
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2">
      <form action={base} method="get" role="search" className="relative flex-1 min-w-0 md:max-w-xs">
        {keep.map(k => <input key={k} type="hidden" name={k} value={params[k]} />)}
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <input type="search" name="q" defaultValue={q ?? ''} placeholder={placeholder} aria-label="Search"
          className="w-full min-h-[44px] md:min-h-[36px] rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        {q && <Link href={href({ q: undefined })} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-8 w-8 rounded text-gray-400 hover:text-gray-800"><X className="h-3.5 w-3.5" /></Link>}
      </form>
      {groups && groups.length > 1 && (
        <nav aria-label="Group by" className="inline-flex rounded-lg bg-gray-100 p-0.5 self-start">
          {groups.map(g => (
            <Link key={g} href={href({ g })} aria-current={group === g ? 'page' : undefined}
              className={`px-2.5 py-1.5 min-h-[36px] inline-flex items-center rounded-md text-[12px] font-medium whitespace-nowrap ${group === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {g === 'none' ? GROUP_LABEL.none : `By ${GROUP_LABEL[g].toLowerCase()}`}
            </Link>
          ))}
        </nav>
      )}
      {bands && bands.all.count > 0 && (
        <nav aria-label="Waiting" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:ml-auto">
          {AGE_BANDS.map(b => {
            const c = bands[b.key]
            if (b.key !== 'all' && c.count === 0) return null
            const active = age === b.key
            const hot = b.key === '30plus' || b.key === '14to30'
            return (
              <Link key={b.key} href={href({ age: b.key })} aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full border px-2.5 py-1 min-h-[36px] inline-flex items-center gap-1 text-[12px] ${active ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold' : `border-gray-200 bg-white ${hot ? 'text-rose-700' : 'text-gray-600'} hover:bg-gray-50`}`}>
                {b.label}<span className="tabular-nums text-gray-400">{c.count}</span>
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  )
}

/* ── 2. A stage’s lines, grouped ─────────────────────────────────────────── */

function StageList({ rows, filter, q, group, age, href, base, params, manyProjects }: {
  rows: BoardRow[]; filter: IndentFilter; q?: string; group: GroupKey; age: AgeBand
  href: (p: Partial<BoardParams>) => string; base: string; params: BoardParams; manyProjects: boolean
}) {
  const stage = searchRows(stageRows(rows, filter), q)
  const bands = bandCounts(stage)
  const shown = stage.filter(r => inAgeBand(r, age))
  const groups = groupRows(shown, group)
  const money = filter !== 'po'
  const openAll = q || groups.length <= 3
  const empty = filter === 'po' ? 'Every approved line has its PO.' : filter === 'delivery' ? 'Nothing ordered is still to arrive.' : filter === 'late' ? 'Nothing is past its time.' : filter === 'done' ? 'Nothing received yet.' : 'Nothing here.'

  return (
    <RowDetailProvider initialOpen={openAll ? groups.map(g => `g:${g.key}`) : []}>
      <Toolbar base={base} params={params} q={q} group={group} groups={groupOptions(filter, manyProjects)} age={age} bands={bands} href={href}
        placeholder="Material, indent, PO, supplier…" />

      {shown.length === 0
        ? <Calm text={q ? `Nothing matches “${q}”.` : age !== 'all' ? 'Nothing in this age band.' : empty} />
        : (
          <div className="space-y-2">
            {groups.map(g => {
              const key = `g:${g.key}`
              const solo = group === 'none'
              return (
                <section key={g.key} className="rounded-lg border border-gray-200 bg-white">
                  <header className="px-3 py-2 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_7rem_9rem_5rem] gap-x-3 items-center">
                    <span className="flex items-center gap-1 min-w-0 text-[13px]">
                      {solo ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={g.rows.length} label="lines" />}
                      <span className="font-semibold text-gray-900 truncate">{g.label}</span>
                      {g.sub && <span className="hidden sm:inline text-[12px] text-gray-500 truncate">{g.sub}</span>}
                    </span>
                    <span className="text-[12px] text-gray-500 tabular-nums text-right">{g.rows.length} line{g.rows.length === 1 ? '' : 's'}</span>
                    <span className="hidden md:block text-[13px] text-gray-700 tabular-nums text-right">{money && g.value > 0.5 ? formatINR(g.value) : ''}</span>
                    <span className={`hidden md:block text-[12px] tabular-nums text-right ${g.late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>{d(g.oldest)}</span>
                  </header>
                  {solo ? <Lines g={g} filter={filter} money={money} manyProjects={manyProjects} /> : <RowDetail id={key}><Lines g={g} filter={filter} money={money} manyProjects={manyProjects} /></RowDetail>}
                </section>
              )
            })}
          </div>
        )}
    </RowDetailProvider>
  )
}

function Lines({ g, filter, money, manyProjects }: { g: ReturnType<typeof groupRows>[number]; filter: IndentFilter; money: boolean; manyProjects: boolean }) {
  return <ul className="border-t border-gray-100 divide-y divide-gray-100 bg-slate-50/40">{g.rows.map(r => <Line key={`${r.indent.id}:${r.item.id}`} r={r} filter={filter} money={money} manyProjects={manyProjects} />)}</ul>
}

/** One line: material · where it is · ₹ to come · days. Nothing else. */
function Line({ r, filter, money, manyProjects }: { r: BoardRow; filter: IndentFilter; money: boolean; manyProjects: boolean }) {
  const it = r.item
  const openPo = it.pos.find(p => p.stage !== 'approved') ?? it.pos.find(p => p.grnQty + 0.001 < p.qty) ?? it.pos[it.pos.length - 1]
  const where =
    it.next === 'raise PO' ? `${shortRef(r.indent.ref)}${manyProjects && r.indent.project ? ` · ${r.indent.project}` : ''}`
    : it.next === 'PO approval' ? `${supplierOf(it) ?? ''} · PO ${shortRef(openPo?.poNo)} at ${openPo?.status ?? 'Verify'}`
    : it.next === 'delivery' ? `${supplierOf(it) ?? 'supplier'} · PO ${shortRef(openPo?.poNo)}${it.receivedQty > 0 ? ` · ${qty(it.receivedQty)} of ${qty(it.poQty)} in` : ''}`
    : it.next === 'done' ? `${supplierOf(it) ?? ''} · PO ${shortRef(openPo?.poNo)}${it.pos.flatMap(p => p.grns).slice(-1).map(g => g.date ? ` · ${formatDate(g.date)}` : '').join('')}`
    : it.next === 'indent approval' ? `${shortRef(r.indent.ref)} · ${r.indent.status}`
    : shortRef(r.indent.ref)
  const value = filter === 'done' ? it.receivedValue : pendingValue(it)
  return (
    <li className="px-3 py-2 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_7rem_9rem_5rem] gap-x-3 gap-y-0.5 items-baseline text-[13px]">
      <span className="min-w-0 col-span-2 md:col-span-1">
        <span className="font-medium text-gray-900">{it.material}</span>
        <span className="text-gray-500"> · {qty(it.qty)} {it.uom ?? ''}</span>
        <span className="block text-[12px] text-gray-500 truncate">{where}{filter === 'late' ? ` · ${it.next === 'raise PO' ? 'no PO yet' : it.next === 'PO approval' ? 'PO not approved' : it.next === 'delivery' ? 'not delivered' : it.next}` : ''}</span>
      </span>
      <span className="hidden md:block" />
      <span className="text-[13px] text-gray-700 tabular-nums text-right">{money && value > 0.5 ? formatINR(value) : ''}</span>
      <span className={`text-[12px] tabular-nums text-right ${it.late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>{filter === 'done' ? '' : d(it.waitingDays)}{it.late ? ' late' : ''}</span>
    </li>
  )
}

/* ── Waiting for approval ───────────────────────────────────────────────── */

function Approvals({ pending, q, href, base, params, manyProjects }: { pending: PendingApproval[]; q?: string; href: (p: Partial<BoardParams>) => string; base: string; params: BoardParams; manyProjects: boolean }) {
  const needle = q?.toLowerCase()
  const list = needle ? pending.filter(p => [p.ref, p.what, p.by, p.context, p.project].map(x => (x ?? '').toLowerCase()).join(' | ').includes(needle)) : pending
  const kinds: Array<{ kind: PendingApproval['kind']; label: string; note: string }> = [
    { kind: 'indent', label: 'Indents', note: 'the Atm Head approves in IN4' },
    { kind: 'po', label: 'Purchase orders', note: 'approved in IN4' },
  ]
  if (pending.length === 0) return <Calm text="Nothing is waiting for approval in IN4." />
  return (
    <div className="space-y-3">
      <Toolbar base={base} params={params} q={q} href={href} placeholder="Indent, PO, supplier, who raised it…" />
      {list.length === 0 && <Calm text={`Nothing matches “${q}”.`} />}
      {kinds.map(k => {
        const items = list.filter(p => p.kind === k.kind)
        if (items.length === 0) return null
        return (
          <section key={k.kind} className="rounded-lg border border-gray-200 bg-white">
            <header className="px-3 py-2 flex items-baseline gap-2 text-[13px]">
              <span className="font-semibold text-gray-900">{k.label}</span>
              <span className="text-[12px] text-gray-500">{items.length} · oldest first · {k.note}</span>
            </header>
            <ul className="border-t border-gray-100 divide-y divide-gray-100">
              {items.map(p => {
                const days = p.since ? Math.max(0, Math.floor((Date.now() - Date.parse(p.since)) / 86400000)) : null
                const late = days != null && days > SLA_DAYS['indent approval']
                return (
                  <li key={`${p.kind}:${p.id}`} className="px-3 py-2 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_9rem_5rem] gap-x-3 gap-y-0.5 items-baseline text-[13px]">
                    <span className="min-w-0 col-span-2 md:col-span-1">
                      <span className="font-medium text-gray-900">{shortRef(p.ref)}</span>
                      <span className="text-gray-500"> · {p.status}{manyProjects && p.project ? ` · ${p.project}` : ''}</span>
                      <span className="block text-[12px] text-gray-500 truncate">{[p.what, p.context, p.by ? `by ${p.by}` : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="text-[13px] text-gray-700 tabular-nums text-right">{p.value != null && p.value > 0.5 ? formatINR(p.value) : ''}</span>
                    <span className={`text-[12px] tabular-nums text-right ${late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>{d(days)}{late ? ' late' : ''}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ── All indents, one line each, grouped and collapsed ──────────────────── */

function AllIndents({ cats, q, group, filter, href, base, params, manyProjects }: {
  cats: IndentsCatRow[]; q?: string; group: 'category' | 'project' | 'indent'; filter: IndentFilter
  href: (p: Partial<BoardParams>) => string; base: string; params: BoardParams; manyProjects: boolean
}) {
  const groups = indentGroups(cats, group, q)
  const openAll = q || groups.length <= 3 || group === 'indent'
  if (cats.length === 0) return <Calm text="No indents in IN4 for this project yet." />
  return (
    <RowDetailProvider initialOpen={openAll ? groups.map(g => `g:${g.key}`) : []}>
      <Toolbar base={base} params={params} q={q} group={group} groups={groupOptions(filter, manyProjects)} href={href} placeholder="Indent, material, PO, supplier, who raised it…" />
      {groups.length === 0 && <Calm text={`Nothing matches “${q}”.`} />}
      <div className="space-y-2">
        {groups.map(g => {
          const key = `g:${g.key}`
          const solo = group === 'indent'
          const body = <div className="border-t border-gray-100 divide-y divide-gray-100">{g.indents.map(r => <IndentLine key={r.id} r={r} idPrefix={key} showProject={manyProjects && group !== 'project'} showCategory={group !== 'category'} />)}</div>
          return (
            <section key={g.key} className="rounded-lg border border-gray-200 bg-white">
              <header className="px-3 py-2 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_7rem_9rem] gap-x-3 items-center">
                <span className="flex items-center gap-1 min-w-0 text-[13px]">
                  {solo ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={g.indents.length} label="indents" />}
                  <span className="font-semibold text-gray-900 truncate">{g.label}</span>
                  <span className="text-[12px] text-gray-500 tabular-nums whitespace-nowrap">{g.indents.length} indent{g.indents.length === 1 ? '' : 's'}</span>
                </span>
                <span className={`text-[12px] tabular-nums text-right ${g.open ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>{g.open ? `${g.open} open` : 'nothing open'}</span>
                <span className="hidden md:block text-[13px] text-gray-700 tabular-nums text-right">{g.poValue > 0.5 ? formatINR(g.poValue) : ''}</span>
              </header>
              {solo ? body : <RowDetail id={key}>{body}</RowDetail>}
            </section>
          )
        })}
      </div>
    </RowDetailProvider>
  )
}

/** One indent, one line: ref · date · who · where it stands · PO'd. Items and the record under the chevron. */
function IndentLine({ r, idPrefix, showProject, showCategory }: { r: IndentRow; idPrefix: string; showProject: boolean; showCategory: boolean }) {
  const key = `${idPrefix}:i:${r.id}`
  const sum = cycleSummary(r)
  const tone = sum.tone === 'late' ? 'text-rose-700' : sum.tone === 'wait' ? 'text-amber-700' : sum.tone === 'ok' ? 'text-emerald-700' : 'text-gray-500'
  const tags = [showProject ? (r.subproject ?? r.project) : null, showCategory ? r.materialType : null].filter(Boolean)
  return (
    <div className="bg-slate-50/40">
      <div className="pl-3 pr-3 py-2 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_16rem_9rem] gap-x-3 gap-y-0.5 items-baseline text-[13px]">
        <span className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
          <RowDetailToggle id={key} count={r.items.length} label="items" />
          <span className="font-medium text-gray-900">{shortRef(r.ref)}</span>
          {r.date && <span className="text-[12px] text-gray-500">{formatDate(r.date)}</span>}
          {r.raisedBy && <span className="hidden sm:inline text-[12px] text-gray-500">{r.raisedBy}</span>}
          <span className="text-[12px] text-gray-500">{r.items.length} item{r.items.length === 1 ? '' : 's'}</span>
          {tags.map(t => <span key={t} className="text-[11px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{t}</span>)}
        </span>
        <span className={`text-[12px] md:text-right ${tone} col-span-2 md:col-span-1 ml-6 md:ml-0 truncate`}>{sum.text}</span>
        <span className="hidden md:block text-[13px] text-gray-700 tabular-nums text-right">{r.poValue > 0.5 ? formatINR(r.poValue) : ''}</span>
      </div>
      <RowDetail id={key}>
        <div className="bg-white border-t border-gray-100">
          <ul className="divide-y divide-gray-100">{r.items.map(it => <ItemLine key={it.id} it={it} indent={4} />)}</ul>
          <div className="pl-10 pr-3 py-1.5 flex items-center gap-1 text-[12px] text-gray-500">
            <RowDetailToggle id={`${key}:d`} count={1} label="the audit trail, POs and receipts" />
            <span>Who did what and when · POs · receipts</span>
          </div>
          <RowDetail id={`${key}:d`}><Details r={r} indent={10} /></RowDetail>
        </div>
      </RowDetail>
    </div>
  )
}

function Calm({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-6 text-center text-[13px] text-emerald-900 flex items-center justify-center gap-2">
      <CheckCircle2 className="h-4 w-4" /> {text}
    </p>
  )
}
