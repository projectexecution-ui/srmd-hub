import Link from 'next/link'
import { AlertTriangle, Upload } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadIndentsAll, itemMatches, type IndentFilter, type ProjectIndents } from '@/lib/revamp/indents-tree'
import { formatINR } from '@/lib/utils'
import { Tiles, tilesFor, defaultTile, PendingList, ActionList, TreeHeader, TreeBody } from '../project/[id]/IndentRows'

/**
 * The Indent → PO tracker, live from IN4, every project at once — the same
 * five tiles as a project's Indents tab, across projects, with the project
 * named on each line. Pick a project pill to narrow. Read-only; the doing
 * happens in IN4.
 */
export async function LiveTracker({ filter, project, months }: { filter?: IndentFilter; project: string | null; months: number }) {
  const { projects, in4, error } = await loadIndentsAll({ months })
  if (in4 !== 'live') {
    return <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title={in4 === 'not-configured' ? 'IN4 is not connected on this deployment' : 'IN4 did not answer'} description={error ?? 'The tracker reads IN4 live; it could not be reached just now.'} action={<Link href="/procurement-tracker?view=upload" className="text-[13px] font-semibold text-indigo-700 hover:underline">Open the upload-based tracker instead</Link>} />
  }

  const shown = project ? projects.filter(p => String(p.projectId) === project) : projects
  const indents = shown.flatMap(p => p.tree.cats.flatMap(c => c.subs.flatMap(s => s.indents)))
  const seen = new Set<string>()
  const rows = indents.flatMap(r => r.items.map(item => ({ item, indent: r }))).filter(x => (seen.has(`${x.indent.id}:${x.item.id}`) ? false : (seen.add(`${x.indent.id}:${x.item.id}`), true)))
  const pending = shown.flatMap(p => p.tree.pending).sort((a, b) => String(a.since ?? '').localeCompare(String(b.since ?? '')))
  const counts = {
    all: rows.length, indents: shown.reduce((t, p) => t + p.tree.totals.indents, 0),
    approval: rows.filter(x => itemMatches('approval', x.item)).length,
    po: rows.filter(x => itemMatches('po', x.item)).length,
    delivery: rows.filter(x => itemMatches('delivery', x.item)).length,
    late: rows.filter(x => x.item.late).length,
    done: rows.filter(x => itemMatches('done', x.item)).length,
  }
  const tiles = tilesFor(counts, pending.length)
  const current: IndentFilter = filter && filter !== 'done' ? filter : defaultTile(tiles)
  const href = (f: IndentFilter, p: string | null = project) => {
    const q = new URLSearchParams()
    if (p) q.set('p', p)
    if (f !== 'all') q.set('f', f)
    if (months !== 12) q.set('months', String(months))
    const s = q.toString()
    return s ? `/procurement-tracker?${s}` : '/procurement-tracker'
  }

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        {/* Projects that need something come first; the number is what is open. */}
        <nav aria-label="Project" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Pill href={href(current, null)} active={!project}>All projects</Pill>
          {projects.map(p => {
            const openCount = p.tree.pending.length + p.tree.totals.awaitingPo + p.tree.totals.awaitingDelivery
            return (
              <Pill key={p.projectId} href={href(current, String(p.projectId))} active={project === String(p.projectId)}>
                {p.project}{openCount > 0 && <span className="tabular-nums text-[12px] text-amber-800">{openCount}</span>}
              </Pill>
            )
          })}
        </nav>

        <Tiles tiles={tiles} current={current} href={f => href(f)} />

        {current === 'approval' && <PendingList list={pending} showProject={!project} />}
        {current === 'po' && <ActionList rows={rows.filter(x => itemMatches('po', x.item))} showProject={!project} empty="Every approved line has its PO." />}
        {current === 'delivery' && <ActionList rows={rows.filter(x => itemMatches('delivery', x.item))} showProject={!project} empty="Nothing ordered is still to arrive." />}
        {current === 'late' && <ActionList rows={rows.filter(x => x.item.late)} showProject={!project} empty="Nothing is past its time — approvals and POs within 2 days, deliveries within 7." />}
        {current === 'all' && shown.map(p => <ProjectBlock key={p.projectId} p={p} single={!!project} />)}

        <p className="text-[12px] text-gray-400">
          Live from IN4 — indents raised in the last {months} months plus every older one still waiting for something. Late = approval or PO waiting over 2 days, delivery over 7.
          The <Link href="/procurement-tracker?view=upload" className="text-indigo-700 hover:underline inline-flex items-center gap-1"><Upload className="h-3 w-3" /> upload-based tracker</Link> keeps the chase notes and the digest.
        </p>
      </div>
    </RowDetailProvider>
  )
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] min-h-[44px] inline-flex items-center gap-1.5 ${active ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
      {children}
    </Link>
  )
}

function ProjectBlock({ p, single }: { p: ProjectIndents; single: boolean }) {
  const t = p.tree.totals
  const key = `proj:${p.projectId}`
  const body = <><TreeHeader /><TreeBody cats={p.tree.cats} idPrefix={`${p.projectId}:`} /></>
  const openCount = p.tree.pending.length + t.awaitingPo + t.awaitingDelivery
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
        {single ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={p.tree.cats.length} label="this project’s indents" />}
        <h2 className="text-[13px] font-semibold text-gray-900">{p.project}</h2>
        <span className="text-[12px] text-gray-500 tabular-nums">{t.indents} indent{t.indents === 1 ? '' : 's'} · PO’d {formatINR(t.poValue)}</span>
        <span className={`ml-auto text-[12px] tabular-nums ${openCount > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>{openCount > 0 ? `${openCount} open` : 'nothing open'}</span>
      </div>
      {single ? body : <RowDetail id={key}>{body}</RowDetail>}
    </section>
  )
}
