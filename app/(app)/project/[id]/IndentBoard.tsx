import { Fragment } from 'react'
import Link from 'next/link'
import { Search, X, ChevronRight, CheckCircle2 } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import {
  TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow,
  RowDetailProvider, RowDetailToggle, RowDetail,
} from '@/components/cost-control/project-tree'
import { SLA_DAYS, type IndentsCatRow, type IndentFilter, type PendingApproval } from '@/lib/revamp/indents-tree'
import {
  flattenRows, isAgeBand, bandCounts, AGE_BANDS, headline, boardTree, catTotals, subTotals, rollUp, treeTotals, shortRef, cleanName, boardHref,
  stageRows, searchRows,
  type BoardParams, type AgeBand, type Headline, type TreeTotals,
} from '@/lib/revamp/indents-board'
import { IndentItems, cycleSummary } from './IndentRows'
import { IndentApprovals } from './IndentApprovals'
import { NamePencil } from '@/components/names/NamePencil'
import { skillKey } from '@/lib/names'

/**
 * The Indents board — one screen for a project's Indent → PO → GRN cycle,
 * shared by the project's Indents tab and the portal-wide tracker.
 *
 * Aksha, 10 Sep 2026: "garbage free and management friendly", then "it should
 * be in Tree View, also in Table with Qty, rate etc so all are in the same
 * format as IE." So, top to bottom:
 *   1. the pipeline as four numbers with money on them (click one to open it)
 *   2. search and age bands
 *   3. the Internal Estimate's tree — category → sub-category → indent —
 *      with the same machinery and colours (TreeProvider + CatChevron for the
 *      first two levels, RowDetail for the rest), and under each indent its
 *      items as the IE's item-wise table: # · Description · Unit · Qty · Rate
 *      · Amount, then what came in.
 * Everything is a URL: f (stage), age (band), q (search). Read-only; the
 * doing happens in IN4.
 */

export interface BoardScope { name?: string; id?: string; cats: IndentsCatRow[]; pending: PendingApproval[] }

export function IndentBoard({ scopes, base, params, manyProjects = false, months, namer = false, projectId = null }: {
  scopes: BoardScope[]
  /** May this person rename categories here? (name layer, Phase 3) */
  namer?: boolean
  /** The hub project when the board is inside one — enables "only for this project". */
  projectId?: string | null
  /** The page's path, e.g. /project/<id>/procurement or /procurement-tracker. */
  base: string
  params: BoardParams
  /** Across projects: one tree per project, each under its own header. */
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
  const age: AgeBand = isAgeBand(params.age) ? params.age : 'all'
  const href = (patch: Partial<BoardParams>) => boardHref(base, { ...params, f: filter }, patch)
  const narrowed = filter !== 'all' || !!q || age !== 'all'

  return (
    <div className="space-y-4">
      <Pipeline h={h} current={filter} href={href} />

      {filter === 'approval'
        ? <><Toolbar base={base} params={{ ...params, f: filter }} q={q} href={href} placeholder="Indent, PO, supplier, who raised it…" /><IndentApprovals pending={pending} rows={rows} q={q} manyProjects={manyProjects} /></>
        : (
          <>
            <Toolbar base={base} params={{ ...params, f: filter }} q={q} age={age} bands={filter === 'done' ? undefined : bandCounts(searchRows(stageRows(rows, filter), q))} href={href} />
            {manyProjects
              ? <ProjectTrees scopes={scopes} filter={filter} q={q} age={age} narrowed={narrowed} namer={namer} />
              : <Tree cats={boardTree(cats, filter, q, age)} filter={filter} narrowed={narrowed} q={q} age={age} namer={namer} projectId={projectId} />}
          </>
        )}

      <p className="text-[12px] text-gray-400">
        Live from IN4{months ? ` · indents of the last ${months} months plus every older one still open` : ''} · approvals happen in IN4 · late = over {SLA_DAYS['indent approval']} days for an approval or a PO, over {SLA_DAYS.delivery} for a delivery.
      </p>
    </div>
  )
}

const isFilter = (v: unknown): v is IndentFilter => v === 'all' || v === 'approval' || v === 'po' || v === 'delivery' || v === 'late' || v === 'done'

/** With nothing in the URL: the first stage of the cycle that has something waiting, else the full tree. */
function defaultStage(h: Headline): IndentFilter {
  if (h.approval.count) return 'approval'
  if (h.po.count) return 'po'
  if (h.delivery.count) return 'delivery'
  return 'all'
}

const d = (n: number | null) => (n == null ? '' : `${n}d`)
const Dash = () => <span className="text-gray-300">—</span>
const money = (v: number) => (v > 0.5 ? formatINR(v) : <Dash />)

/* ── 1. The pipeline ────────────────────────────────────────────────────── */

function Pipeline({ h, current, href }: { h: Headline; current: IndentFilter; href: (p: Partial<BoardParams>) => string }) {
  const stage = (key: IndentFilter, label: string, count: number, sub: string, tone: 'wait' | 'late' | 'ok' | 'muted') => {
    const active = current === key
    const num = tone === 'late' ? 'text-rose-700' : tone === 'wait' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-gray-400'
    return (
      <Link key={key} href={href({ f: key, q: undefined, age: undefined })} aria-current={active ? 'page' : undefined}
        className={`relative rounded-lg border px-3 py-2 min-h-[44px] block ${active ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
        <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`text-[20px] leading-tight font-semibold tabular-nums ${num}`}>{count.toLocaleString('en-IN')}</p>
        <p className="text-[12px] text-gray-500 truncate">{sub || ' '}</p>
        <ChevronRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" aria-hidden />
      </Link>
    )
  }
  const sub = (x: { oldest: number | null; late: number }, toCome?: number) =>
    [toCome && toCome > 0.5 ? `${formatINR(toCome)} to come` : null, x.oldest != null && x.oldest > 0 ? `oldest ${d(x.oldest)}` : null, x.late ? `${x.late} late` : null].filter(Boolean).join(' · ')
  return (
    <section aria-label="Indent → PO → GRN">
      <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-x-5 gap-y-2 items-stretch">
        {stage('approval', 'Waiting approval', h.approval.count, sub(h.approval), h.approval.late ? 'late' : h.approval.count ? 'wait' : 'muted')}
        {stage('po', 'To be ordered', h.po.count, sub(h.po), h.po.late ? 'late' : h.po.count ? 'wait' : 'muted')}
        {stage('delivery', 'On order', h.delivery.count, sub(h.delivery, h.delivery.value), h.delivery.late ? 'late' : h.delivery.count ? 'wait' : 'muted')}
        {stage('done', 'Received', h.received.count, h.received.value > 0.5 ? formatINR(h.received.value) : '', 'ok')}
        <div className="col-span-2 md:col-span-1 flex md:flex-col gap-2 md:w-36">
          <Link href={href({ f: 'late', q: undefined, age: undefined })} aria-current={current === 'late' ? 'page' : undefined}
            className={`flex-1 rounded-lg border px-3 py-1.5 min-h-[44px] flex items-center justify-between gap-2 ${current === 'late' ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300' : h.late.count ? 'border-rose-200 bg-white hover:bg-rose-50/40' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <span className="text-[12px] text-gray-600">Late</span>
            <span className={`text-[15px] font-semibold tabular-nums ${h.late.count ? 'text-rose-700' : 'text-gray-400'}`}>{h.late.count}</span>
          </Link>
          <Link href={href({ f: 'all', q: undefined, age: undefined })} aria-current={current === 'all' ? 'page' : undefined}
            className={`flex-1 rounded-lg border px-3 py-1.5 min-h-[44px] flex items-center justify-between gap-2 ${current === 'all' ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <span className="text-[12px] text-gray-600">All indents</span>
            <span className="text-[12px] text-gray-500 tabular-nums">{h.ordered.pos} PO{h.ordered.pos === 1 ? '' : 's'}</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ── 2. Search · age ────────────────────────────────────────────────────── */

function Toolbar({ base, params, q, age, bands, href, placeholder = 'Material, indent, PO, supplier, who raised it…' }: {
  base: string; params: BoardParams; q?: string
  age?: AgeBand; bands?: ReturnType<typeof bandCounts>
  href: (p: Partial<BoardParams>) => string
  placeholder?: string
}) {
  const keep = (['p', 'months', 'f', 'age'] as const).filter(k => params[k] && !(k === 'f' && params[k] === 'all') && !(k === 'age' && params[k] === 'all'))
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2">
      <form action={base} method="get" role="search" className="relative flex-1 min-w-0 md:max-w-sm">
        {keep.map(k => <input key={k} type="hidden" name={k} value={params[k]} />)}
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <input type="search" name="q" defaultValue={q ?? ''} placeholder={placeholder} aria-label="Search"
          className="w-full min-h-[44px] md:min-h-[36px] rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        {q && <Link href={href({ q: undefined })} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-8 w-8 rounded text-gray-400 hover:text-gray-800"><X className="h-3.5 w-3.5" /></Link>}
      </form>
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

/* ── 3. The tree — the Internal Estimate's shape ────────────────────────── */

const STAGE_TITLE: Record<IndentFilter, string> = {
  all: 'Category — indent wise', approval: 'Waiting for approval', po: 'Lines to be ordered', delivery: 'Lines on order', late: 'Late lines', done: 'Lines received',
}

function Tree({ cats, filter, narrowed, q, age, title, namer = false, projectId = null }: { cats: IndentsCatRow[]; filter: IndentFilter; narrowed: boolean; q?: string; age: AgeBand; title?: string; namer?: boolean; projectId?: string | null }) {
  if (cats.length === 0) {
    return <Calm text={q ? `Nothing matches “${q}”.` : age !== 'all' ? 'Nothing in this age band.' : filter === 'all' ? 'No indents in IN4 for this project yet.' : filter === 'po' ? 'Every approved line has its PO.' : filter === 'delivery' ? 'Nothing ordered is still to arrive.' : filter === 'late' ? 'Nothing is past its time.' : filter === 'done' ? 'Nothing received yet.' : 'Nothing here.'} />
  }
  const totals = treeTotals(cats)
  const catIds = cats.map(c => c.id)
  // A narrowed tree (a stage, a search, an age band) opens all the way down
  // to the indents — the reader asked for those lines. The full tree opens
  // rolled up, the management view (feedback: declutter, collapse by default).
  const openRows = narrowed ? cats.flatMap(c => c.subs.map(sb => sb.id)) : []
  const COLS = 7

  return (
    <TreeProvider allCatIds={catIds} emptyCount={0} initialCollapsedIds={narrowed ? [] : catIds}>
      <RowDetailProvider initialOpen={openRows}>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-900">
              {title ?? STAGE_TITLE[filter]}
              <span className="ml-2 text-[12px] font-normal text-gray-500">
                {cats.length} categor{cats.length === 1 ? 'y' : 'ies'} · {totals.indents} indent{totals.indents === 1 ? '' : 's'} · {totals.items} line item{totals.items === 1 ? '' : 's'} · live from IN4
              </span>
            </span>
            <TreeToolbar />
          </div>

          {/* Desktop */}
          <div className="overflow-auto max-h-[70vh] hidden md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <Th className="min-w-[300px] text-left">Category / sub-category / indent</Th>
                  <Th className="text-right w-20">Items</Th>
                  <Th className="text-right w-20">Open</Th>
                  <Th className="text-right w-36">PO’d</Th>
                  <Th className="text-right w-36">Received</Th>
                  <Th className="text-right w-32">To come</Th>
                  <Th className="text-right w-24">Waiting</Th>
                </tr>
              </thead>
              <tbody>
                {cats.map(c => {
                  const ct = catTotals(c)
                  return (
                    <Fragment key={c.id}>
                      <tr className="bg-gray-50/60 border-t border-gray-200">
                        <td className="px-3 py-2 font-semibold text-gray-800">
                          <CatChevron catId={c.id} />
                          {cleanName(c.name)}{namer && c.skillId != null && <NamePencil kind="skill" nameKey={skillKey(c.skillId)} shown={cleanName(c.name)} original={c.in4Name ?? cleanName(c.name)} projectId={projectId} module="procurement" moduleLabel="Indents" size="xs" />}
                          <span className="ml-2 text-[12px] font-normal text-gray-500">{ct.indents} indent{ct.indents === 1 ? '' : 's'}</span>
                        </td>
                        <Cells t={ct} bold />
                      </tr>
                      <CatRows catId={c.id}>
                        {c.subs.map(sb => {
                          const st = subTotals(sb)
                          return (
                            <SubRow key={sb.id} empty={false}>
                              {/* Level 2 — sub-category. Its chevron opens the indents. */}
                              <tr className="border-t border-gray-100 hover:bg-gray-50/60">
                                <td className="pl-6 pr-3 py-2 text-gray-700">
                                  <RowDetailToggle id={sb.id} count={sb.indents.length} label="indents" />
                                  {cleanName(sb.name)}{namer && sb.skillId != null && <NamePencil kind="skill" nameKey={skillKey(sb.skillId)} shown={cleanName(sb.name)} original={sb.in4Name ?? cleanName(sb.name)} projectId={projectId} module="procurement" moduleLabel="Indents" size="xs" />}
                                  <span className="ml-2 text-[12px] text-gray-400">{sb.indents.length} indent{sb.indents.length === 1 ? '' : 's'}</span>
                                </td>
                                <Cells t={st} />
                              </tr>
                              {/* Level 3 — the indents. */}
                              <RowDetail id={sb.id}>
                                {sb.indents.map(r => {
                                  const key = `${sb.id}:${r.id}`
                                  const sum = cycleSummary(r)
                                  const it = rollUp([r])
                                  return (
                                    <Fragment key={key}>
                                      <tr className="border-t border-gray-100 bg-slate-50/50">
                                        <td className="pl-12 pr-3 py-1.5">
                                          <RowDetailToggle id={key} count={r.items.length} label="items" />
                                          <span className="text-[12px] text-gray-800 font-medium">{shortRef(r.ref)}</span>
                                          {r.date && <span className="ml-2 text-[12px] text-gray-500">{formatDate(r.date)}</span>}
                                          {r.raisedBy && <span className="ml-2 text-[12px] text-gray-500">{r.raisedBy}</span>}
                                          <span className="ml-2 text-[12px] text-gray-400">{r.items.length} item{r.items.length === 1 ? '' : 's'}</span>
                                          <span className={`block mt-0.5 ml-6 text-[12px] ${TONE[sum.tone]}`}>{sum.text}</span>
                                        </td>
                                        <Cells t={it} small />
                                      </tr>
                                      {/* Level 4 — the items, as the IE's item-wise table inside one full-width cell. */}
                                      <RowDetail id={key}>
                                        <tr className="border-t border-gray-100 bg-gray-50/40">
                                          <td colSpan={COLS} className="pl-12 pr-3 py-3">
                                            <IndentItems r={r} idPrefix={key} />
                                          </td>
                                        </tr>
                                      </RowDetail>
                                    </Fragment>
                                  )
                                })}
                              </RowDetail>
                            </SubRow>
                          )
                        })}
                      </CatRows>
                    </Fragment>
                  )
                })}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-gray-900">
                    Total
                    <span className="ml-2 text-[12px] font-normal text-gray-500">{totals.indents} indent{totals.indents === 1 ? '' : 's'}</span>
                  </td>
                  <Cells t={totals} bold />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile — the same levels as nested cards. */}
          <div className="md:hidden divide-y divide-gray-100 overflow-auto max-h-[70vh]">
            {cats.map(c => {
              const ct = catTotals(c)
              return (
                <div key={c.id}>
                  <div className="sticky top-0 z-10 px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
                    <span className="flex items-center min-w-0 text-[12px] font-semibold text-gray-800">
                      <CatChevron catId={c.id} />
                      <span className="truncate">{cleanName(c.name)}{namer && c.skillId != null && <NamePencil kind="skill" nameKey={skillKey(c.skillId)} shown={cleanName(c.name)} original={c.in4Name ?? cleanName(c.name)} projectId={projectId} module="procurement" moduleLabel="Indents" size="xs" />}</span>
                    </span>
                    <span className="text-[12px] text-gray-600 flex-shrink-0 whitespace-nowrap tabular-nums">{money(ct.poValue)}</span>
                  </div>
                  <CatRows catId={c.id}>
                    {c.subs.map(sb => (
                      <div key={sb.id} className="px-4 py-2.5 border-t border-gray-50">
                        <p className="text-[13px] text-gray-900 flex items-center">
                          <RowDetailToggle id={sb.id} count={sb.indents.length} label="indents" />
                          {cleanName(sb.name)}{namer && sb.skillId != null && <NamePencil kind="skill" nameKey={skillKey(sb.skillId)} shown={cleanName(sb.name)} original={sb.in4Name ?? cleanName(sb.name)} projectId={projectId} module="procurement" moduleLabel="Indents" size="xs" />}
                        </p>
                        <Chips t={subTotals(sb)} />
                        <RowDetail id={sb.id}>
                          <div className="mt-2 ml-6 space-y-2">
                            {sb.indents.map(r => {
                              const key = `${sb.id}:${r.id}`
                              const sum = cycleSummary(r)
                              return (
                                <div key={key} className="rounded-lg border border-gray-100 bg-slate-50/50 px-3 py-2">
                                  <p className="text-[12px] flex items-center">
                                    <RowDetailToggle id={key} count={r.items.length} label="items" />
                                    <span className="text-gray-800 font-medium">{shortRef(r.ref)}</span>
                                    {r.date && <span className="ml-2 text-gray-500">{formatDate(r.date)}</span>}
                                  </p>
                                  {r.raisedBy && <p className="ml-6 text-[12px] text-gray-500">{r.raisedBy}</p>}
                                  <p className={`ml-6 text-[12px] ${TONE[sum.tone]}`}>{sum.text}</p>
                                  <Chips t={rollUp([r])} />
                                  <RowDetail id={key}><div className="mt-2"><IndentItems r={r} idPrefix={key} /></div></RowDetail>
                                </div>
                              )
                            })}
                          </div>
                        </RowDetail>
                      </div>
                    ))}
                  </CatRows>
                </div>
              )
            })}
            <div className="px-4 py-3 bg-gray-50 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-gray-900">Total PO’d</span>
                <span className="text-[12px] font-semibold text-gray-900 tabular-nums">{formatINR(totals.poValue)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-gray-600 flex-wrap gap-x-3">
                <span>Received {formatINR(totals.receivedValue)} · {totals.open} open</span>
                {totals.toCome > 0.5 && <span className="font-semibold text-amber-700 tabular-nums">To come {formatINR(totals.toCome)}</span>}
              </div>
            </div>
          </div>
        </div>
      </RowDetailProvider>
    </TreeProvider>
  )
}

const TONE = { ok: 'text-emerald-700', wait: 'text-amber-700', late: 'text-rose-700 font-semibold', muted: 'text-gray-500' } as const

/** The six figures on a tree row: items · open · PO'd · received · to come · waiting. */
function Cells({ t, bold, small }: { t: TreeTotals; bold?: boolean; small?: boolean }) {
  const cls = `px-3 py-2 text-right tabular-nums ${small ? 'text-[12px]' : ''}`
  return (
    <>
      <td className={`${cls} text-gray-600`}>{t.items}</td>
      <td className={`${cls} ${t.open ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>{t.open || <Dash />}</td>
      <td className={`${cls} ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{money(t.poValue)}</td>
      <td className={`${cls} ${bold ? 'font-semibold text-emerald-800' : 'text-emerald-700'}`}>{money(t.receivedValue)}</td>
      <td className={`${cls} ${t.toCome > 0.5 ? 'text-amber-700' : ''}`}>{money(t.toCome)}</td>
      <td className={`${cls} ${t.late ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>{t.oldest != null && t.oldest > 0 ? d(t.oldest) : <Dash />}{t.late ? <span className="block text-[11px] font-normal">{t.late} late</span> : null}</td>
    </>
  )
}

function Chips({ t }: { t: TreeTotals }) {
  return (
    <p className="ml-6 mt-0.5 text-[12px] text-gray-500 tabular-nums flex flex-wrap gap-x-2">
      <span>{t.items} item{t.items === 1 ? '' : 's'}</span>
      {t.open > 0 && <span className="text-amber-700">{t.open} open</span>}
      {t.poValue > 0.5 && <span>PO’d {formatINR(t.poValue)}</span>}
      {t.receivedValue > 0.5 && <span className="text-emerald-700">in {formatINR(t.receivedValue)}</span>}
      {t.toCome > 0.5 && <span className="text-amber-700">to come {formatINR(t.toCome)}</span>}
      {t.oldest != null && t.oldest > 0 && <span className={t.late ? 'text-rose-700 font-semibold' : ''}>{d(t.oldest)}{t.late ? ' late' : ''}</span>}
    </p>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 ${className ?? ''}`}>
      {children}
    </th>
  )
}

/* ── Across projects: one tree per project ──────────────────────────────── */

function ProjectTrees({ scopes, filter, q, age, narrowed, namer = false }: { scopes: BoardScope[]; filter: IndentFilter; q?: string; age: AgeBand; narrowed: boolean; namer?: boolean }) {
  const trees = scopes.map(s => ({ s, cats: boardTree(s.cats, filter, q, age) })).filter(x => x.cats.length > 0)
  if (trees.length === 0) return <Tree cats={[]} filter={filter} narrowed={narrowed} q={q} age={age} namer={namer} />
  // Busiest project first; a lone project's tree opens by itself.
  trees.sort((a, b) => { const ta = treeTotals(a.cats), tb = treeTotals(b.cats); return tb.open - ta.open || tb.poValue - ta.poValue })
  const openAll = trees.length === 1 || !!q
  return (
    <RowDetailProvider initialOpen={openAll ? trees.map(x => `proj:${x.s.id ?? x.s.name}`) : []}>
      <div className="space-y-3">
        {trees.map(({ s, cats }) => {
          const key = `proj:${s.id ?? s.name}`
          const t = treeTotals(cats)
          return (
            <section key={key} className="rounded-lg border border-gray-200 bg-white">
              <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
                <RowDetailToggle id={key} count={cats.length} label="this project’s indents" />
                <h2 className="text-[13px] font-semibold text-gray-900">{s.name ?? 'Project'}</h2>
                <span className="text-[12px] text-gray-500 tabular-nums">{t.indents} indent{t.indents === 1 ? '' : 's'} · {t.items} line{t.items === 1 ? '' : 's'} · PO’d {formatINR(t.poValue)}{t.toCome > 0.5 ? ` · to come ${formatINR(t.toCome)}` : ''}</span>
                <span className={`ml-auto text-[12px] tabular-nums ${t.open > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>{t.open > 0 ? `${t.open} open${t.late ? ` · ${t.late} late` : ''}` : 'nothing open'}</span>
              </div>
              {/* Across projects there is no single hub project, so a rename here is Everywhere or only-in-Indents. */}
              <RowDetail id={key}><div className="p-2"><Tree cats={cats} filter={filter} narrowed={narrowed} q={q} age={age} title={s.name} namer={namer} /></div></RowDetail>
            </section>
          )
        })}
      </div>
    </RowDetailProvider>
  )
}

function Calm({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-6 text-center text-[13px] text-emerald-900 flex items-center justify-center gap-2">
      <CheckCircle2 className="h-4 w-4" /> {text}
    </p>
  )
}
