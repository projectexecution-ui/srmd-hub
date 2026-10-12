// The Bills home, project-first — two looks behind one toggle (Aksha, 12 Oct
// 2026). "Projects": one card per IN4 main project, your projects first and
// open, the rest folded; inside, each sub-project with its team and its bills.
// "Tree": main project → sub-project → bills, the status as columns.
// Card → box → row, the hub's three shapes. Server-rendered; <details> folds.

import Link from 'next/link'
import { ChevronRight, FolderTree, LayoutList } from 'lucide-react'
import { formatINR, formatINRCompact } from '@/lib/utils'
import { stageDef, type BbStage } from '@/lib/bills-booking/stages'
import { TREE_STAGES, stageLine, type MainNode, type SubNode, type StageCell } from '@/lib/bills-booking/project-views'

const SHORT: Partial<Record<BbStage, string>> = {
  submitted: 'Entered', site_head: 'Site Head', disc_head: 'Disc Head', ct_head: 'CT Head',
  ct_billing: 'CT Billing', atm_in4: 'Atm (IN4)', trust: 'Trust',
}
const label = (s: BbStage) => SHORT[s] ?? stageDef(s).label
const days = (d: number) => (d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`)

export type Look = 'projects' | 'tree'

export function LookToggle({ look, hrefs }: { look: Look; hrefs: Record<Look, string> }) {
  const btn = (k: Look, icon: React.ReactNode, text: string) => (
    <Link href={hrefs[k]} scroll={false} aria-pressed={look === k}
          className={`inline-flex min-h-[40px] items-center gap-1.5 px-3 text-[13px] font-semibold ${
            look === k ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}>
      {icon} {text}
    </Link>
  )
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white divide-x divide-gray-300">
      {btn('projects', <LayoutList className="h-4 w-4" />, 'Projects')}
      {btn('tree', <FolderTree className="h-4 w-4" />, 'Tree')}
    </div>
  )
}

function BillRow({ b }: { b: SubNode['bills'][number] }) {
  return (
    <Link href={`/bills-booking/${b.id}`}
          className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 hover:bg-gray-50 ${b.mine ? 'bg-indigo-50/50' : ''}`}>
      <span className="min-w-0 break-words text-[13px] font-semibold text-gray-900">{b.vendor}</span>
      <span className="text-right text-[13px] font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</span>
      <span className="col-span-2 text-[11.5px] text-gray-600">
        <span className="font-mono text-gray-500">{b.billNo ?? '—'}</span>
        {' · '}<b className="font-semibold text-gray-800">{stageDef(b.stage).label}</b>
        {b.holders.length > 0 && <> — {b.holders.join(', ')}</>}
        {' · '}{days(b.days)} at this desk
        {b.mine && <b className="font-semibold text-indigo-700"> · waiting on you</b>}
      </span>
    </Link>
  )
}

function Team({ s }: { s: SubNode }) {
  const seats = s.team.filter(t => t.names.length)
  if (!seats.length) return <p className="px-3 pb-2 text-[11.5px] text-amber-700">No desk set for this sub-project yet — set it under Desks.</p>
  return (
    <p className="px-3 pb-2 text-[11.5px] text-gray-600">
      {seats.map((t, i) => <span key={t.label}>{i > 0 && ' · '}<span className="text-gray-400">{t.label}:</span> {t.names.join(', ')}</span>)}
    </p>
  )
}

function ProjectCard({ m, open }: { m: MainNode; open: boolean }) {
  return (
    <details open={open} className="group rounded-2xl border border-gray-200 bg-white shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3 min-h-[44px]">
        <span className="min-w-0 text-[15px] font-bold text-gray-900">
          <ChevronRight className="mr-1 inline h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />{m.name}
        </span>
        <span className="text-[15px] font-bold tabular-nums text-gray-900">{formatINRCompact(m.amount)}</span>
        <span className="col-span-2 text-[12px] text-gray-600">
          {m.n} {m.n === 1 ? 'bill' : 'bills'} · {m.subs.length} {m.subs.length === 1 ? 'sub-project' : 'sub-projects'} · longest at a desk {days(m.oldestDays)}
          {m.waitingOnMe > 0 && <b className="font-semibold text-indigo-700"> · {m.waitingOnMe} waiting on you</b>}
        </span>
      </summary>
      <div className="space-y-2.5 px-3 pb-3">
        {m.subs.map(s => (
          <div key={s.key} className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 pt-2.5 pb-1">
              <span className="text-[13px] font-semibold text-gray-900" title={s.fullName}>{s.name}</span>
              <span className="text-[12px] tabular-nums text-gray-600">{s.n} {s.n === 1 ? 'bill' : 'bills'} · {formatINRCompact(s.amount)}</span>
            </div>
            <Team s={s} />
            <div className="divide-y divide-gray-100 border-t border-gray-200 bg-white">
              {s.bills.map(b => <BillRow key={b.id} b={b} />)}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

export function ProjectsLook({ mains }: { mains: MainNode[] }) {
  const mine = mains.filter(m => m.mine)
  const others = mains.filter(m => !m.mine)
  const few = mains.length <= 3
  return (
    <div className="space-y-3">
      {mine.length > 0 && (
        <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Your projects</p>
      )}
      {mine.map(m => <ProjectCard key={m.key} m={m} open />)}
      {mine.length > 0 && others.length > 0 && (
        <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Other projects</p>
      )}
      {others.map(m => <ProjectCard key={m.key} m={m} open={few && mine.length === 0} />)}
    </div>
  )
}

// ── Tree ──────────────────────────────────────────────────────────────────
const GRID = 'md:grid-cols-[minmax(220px,2.4fr)_repeat(7,minmax(70px,1fr))_minmax(96px,1.1fr)]'

function Cell({ c }: { c: StageCell | undefined }) {
  if (!c?.n) return <span className="hidden text-center text-gray-300 md:block">·</span>
  return (
    <span className="hidden text-center md:block">
      <b className="block text-[13px] tabular-nums text-gray-900">{c.n}</b>
      <span className="block text-[10.5px] tabular-nums text-gray-500">{formatINRCompact(c.amount)}</span>
    </span>
  )
}

function TreeRow({ name, n, amount, byStage, depth, extra }: {
  name: React.ReactNode; n: number; amount: number; byStage: MainNode['byStage']; depth: 0 | 1; extra?: React.ReactNode
}) {
  return (
    <>
      <span className={`min-w-0 ${depth === 0 ? 'text-[14px] font-bold' : 'pl-5 text-[13px] font-semibold'} text-gray-900`}>
        {name}
        <span className="block text-[11.5px] font-normal text-gray-500 md:hidden">{stageLine(byStage, label)}</span>
        {extra}
      </span>
      {TREE_STAGES.map(st => <Cell key={st} c={byStage[st]} />)}
      <span className="text-right">
        <b className="block text-[13px] tabular-nums text-gray-900">{formatINRCompact(amount)}</b>
        <span className="block text-[10.5px] text-gray-500">{n} {n === 1 ? 'bill' : 'bills'}</span>
      </span>
    </>
  )
}

export function TreeLook({ mains }: { mains: MainNode[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
      <div className="md:min-w-[900px]">
        <div className={`hidden ${GRID} gap-x-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-[10.5px] font-bold uppercase tracking-wide text-gray-500 md:grid`}>
          <span>Project → sub-project</span>
          {TREE_STAGES.map(st => <span key={st} className="text-center">{label(st)}</span>)}
          <span className="text-right">Total</span>
        </div>
        {mains.map(m => (
          <details key={m.key} open={m.mine} className="group/m border-b border-gray-100 last:border-b-0">
            <summary className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-x-2 px-4 py-2.5 min-h-[44px] hover:bg-gray-50`}>
              <TreeRow depth={0} n={m.n} amount={m.amount} byStage={m.byStage}
                name={<><ChevronRight className="mr-1 inline h-4 w-4 text-gray-400 transition-transform group-open/m:rotate-90" />{m.name}</>}
                extra={m.waitingOnMe > 0 ? <span className="block text-[11px] font-semibold text-indigo-700">{m.waitingOnMe} waiting on you</span> : null} />
            </summary>
            {m.subs.map(s => (
              <details key={s.key} className="group/s border-t border-gray-100 bg-gray-50/40">
                <summary className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-x-2 px-4 py-2 min-h-[44px] hover:bg-gray-50`}>
                  <TreeRow depth={1} n={s.n} amount={s.amount} byStage={s.byStage}
                    name={<><ChevronRight className="mr-1 inline h-3.5 w-3.5 text-gray-400 transition-transform group-open/s:rotate-90" />{s.name}</>} />
                </summary>
                <div className="divide-y divide-gray-100 border-t border-gray-100 bg-white">
                  {s.bills.map(b => (
                    <Link key={b.id} href={`/bills-booking/${b.id}`}
                          className={`grid grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-x-2 px-4 py-2 hover:bg-indigo-50/40 ${b.mine ? 'bg-indigo-50/50' : ''}`}>
                      <span className="min-w-0 pl-10 text-[12.5px] text-gray-800">
                        <span className="font-semibold">{b.vendor}</span>
                        <span className="block text-[11px] text-gray-500"><span className="font-mono">{b.billNo ?? '—'}</span> · {days(b.days)} at this desk{b.holders.length ? ` — ${b.holders.join(', ')}` : ''}</span>
                        <span className="block text-[11px] font-semibold text-gray-700 md:hidden">{stageDef(b.stage).label}</span>
                      </span>
                      {TREE_STAGES.map(st => (
                        <span key={st} className="hidden text-center md:block">
                          {st === b.stage ? <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10.5px] font-bold text-indigo-800">here</span> : <span className="text-gray-200">·</span>}
                        </span>
                      ))}
                      <span className="text-right text-[12.5px] font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</span>
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </details>
        ))}
      </div>
    </div>
  )
}
