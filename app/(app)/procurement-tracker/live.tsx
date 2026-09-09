import Link from 'next/link'
import { AlertTriangle, Info, Upload } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadIndentsAll, filterIndentsTree, itemMatches, type IndentFilter, type ProjectIndents } from '@/lib/revamp/indents-tree'
import { formatINR } from '@/lib/utils'
import { Kpi, Pending, FilterChips, TreeHeader, TreeBody } from '../project/[id]/IndentRows'

/**
 * The Indent → PO tracker, live from IN4, every project at once: what waits
 * for approval, what waits for a PO, what waits for delivery, what is late by
 * the same SLA the digest uses — grouped by IN4's own project, so nothing is
 * left out for want of a CT Hub mapping. The same rows as each project's
 * Indents tab. Read-only; the doing happens in IN4.
 */
export async function LiveTracker({ filter, project, months }: { filter: IndentFilter; project: string | null; months: number }) {
  const { projects, in4, error } = await loadIndentsAll({ months })
  if (in4 !== 'live') {
    return <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title={in4 === 'not-configured' ? 'IN4 is not connected on this deployment' : 'IN4 did not answer'} description={error ?? 'The tracker reads IN4 live; it could not be reached just now.'} action={<Link href="/procurement-tracker?view=upload" className="text-[13px] font-semibold text-indigo-700 hover:underline">Open the upload-based tracker instead</Link>} />
  }

  const all = projects.flatMap(p => p.tree.cats.flatMap(c => c.subs.flatMap(s => s.indents.flatMap(r => r.items))))
  const counts = {
    all: all.length,
    approval: all.filter(i => itemMatches('approval', i)).length,
    po: all.filter(i => itemMatches('po', i)).length,
    delivery: all.filter(i => itemMatches('delivery', i)).length,
    late: all.filter(i => i.late).length,
    done: all.filter(i => itemMatches('done', i)).length,
  }
  const pending = projects.flatMap(p => p.tree.pending.map(x => ({ ...x, project: p.project }))).sort((a, b) => String(a.since ?? '').localeCompare(String(b.since ?? '')))
  const shown = project ? projects.filter(p => String(p.projectId) === project) : projects
  const keep = { view: undefined, p: project ?? undefined, months: months !== 12 ? String(months) : undefined }

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Projects with indents" value={projects.length.toLocaleString('en-IN')} />
          <Kpi label="Waiting for approval" value={pending.length.toLocaleString('en-IN')} tone={pending.length > 0 ? 'amber' : undefined} sub="indents and POs, in IN4" />
          <Kpi label="Items awaiting PO" value={counts.po.toLocaleString('en-IN')} tone={counts.po > 0 ? 'amber' : undefined} />
          <Kpi label="Items awaiting delivery" value={counts.delivery.toLocaleString('en-IN')} tone={counts.delivery > 0 ? 'amber' : undefined} />
          <Kpi label="Late (past the SLA)" value={counts.late.toLocaleString('en-IN')} tone={counts.late > 0 ? 'rose' : undefined} sub="approval or PO 2 days · delivery 7 days" />
          <Kpi label="PO’d (with GST)" value={formatINR(projects.reduce((t, p) => t + p.tree.totals.poValue, 0))} />
        </div>

        <Pending list={pending} showProject />

        {/* Project pills — the projects that need something first. */}
        <nav aria-label="Project" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Pill href={hrefFor(null, filter, months)} active={!project}>All projects <span className="tabular-nums text-[12px] opacity-70">{projects.length}</span></Pill>
          {projects.map(p => {
            const open = p.tree.pending.length + p.tree.totals.awaitingPo + p.tree.totals.awaitingDelivery
            return (
              <Pill key={p.projectId} href={hrefFor(String(p.projectId), filter, months)} active={project === String(p.projectId)}>
                {p.project}{open > 0 && <span className="tabular-nums text-[12px] text-amber-800">{open}</span>}
              </Pill>
            )
          })}
        </nav>
        <FilterChips base="/procurement-tracker" current={filter} counts={counts} keep={keep} />

        <p className="text-[12px] text-gray-500 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>Live from IN4 — indents raised in the last {months} months plus every older one still waiting for something. Same rows as each project’s Indents tab. The <Link href="/procurement-tracker?view=upload" className="text-indigo-700 hover:underline inline-flex items-center gap-1"><Upload className="h-3 w-3" /> upload-based tracker</Link> is still there for the chase notes and the digest.</span>
        </p>

        {shown.map(p => <ProjectBlock key={p.projectId} p={p} filter={filter} single={!!project} />)}
        {shown.length === 0 && <EmptyState title="No indents in IN4" description="Nothing raised in this period." />}
      </div>
    </RowDetailProvider>
  )
}

function hrefFor(project: string | null, filter: IndentFilter, months: number) {
  const p = new URLSearchParams()
  if (project) p.set('p', project)
  if (filter !== 'all') p.set('f', filter)
  if (months !== 12) p.set('months', String(months))
  const s = p.toString()
  return s ? `/procurement-tracker?${s}` : '/procurement-tracker'
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] min-h-[44px] inline-flex items-center gap-1.5 ${active ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
      {children}
    </Link>
  )
}

function ProjectBlock({ p, filter, single }: { p: ProjectIndents; filter: IndentFilter; single: boolean }) {
  const cats = filterIndentsTree(p.tree.cats, filter)
  if (cats.length === 0 && filter !== 'all') return null
  const t = p.tree.totals
  const key = `proj:${p.projectId}`
  const body = (
    <>
      <TreeHeader />
      {cats.length === 0
        ? <p className="px-4 py-6 text-center text-[13px] text-gray-500">No indents in IN4 for this project in the period.</p>
        : <TreeBody cats={cats} idPrefix={`${p.projectId}:`} openAll={filter !== 'all'} />}
    </>
  )
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
        {single ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={cats.length} label="this project’s indents" />}
        <h2 className="text-[13px] font-semibold text-gray-900">{p.project}</h2>
        <span className="text-[12px] text-gray-500 tabular-nums">{t.indents} indent{t.indents === 1 ? '' : 's'} · {t.items} items · PO’d {formatINR(t.poValue)}</span>
        {p.tree.pending.length > 0 && <span className="text-[12px] font-semibold text-amber-800">{p.tree.pending.length} waiting for approval</span>}
        {t.awaitingPo > 0 && <span className="text-[12px] text-amber-700">{t.awaitingPo} await PO</span>}
        {t.awaitingDelivery > 0 && <span className="text-[12px] text-amber-700">{t.awaitingDelivery} await delivery</span>}
      </div>
      {single ? body : <RowDetail id={key}>{body}</RowDetail>}
    </section>
  )
}
