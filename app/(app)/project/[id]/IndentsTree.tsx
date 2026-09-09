import Link from 'next/link'
import { AlertTriangle, Link2Off, Info } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { RowDetailProvider } from '@/components/cost-control/project-tree'
import { loadIndentsTree, filterIndentsTree, itemMatches, type IndentFilter } from '@/lib/revamp/indents-tree'
import { Kpi, Pending, FilterChips, TreeHeader, TreeBody } from './IndentRows'

/**
 * The Indents tab in the Internal Estimate's shape — category → sub-category
 * → indent → items — with the approvals waiting in IN4 on top and the whole
 * cycle (Indent → PO → GRN) on every indent, each step saying how long it has
 * waited and whether that is late. Read live from IN4; approval itself
 * happens in IN4, and the Atm Head is told when it is their turn.
 */
export async function IndentsTree({ projectId, filter = 'all' }: { projectId: string; filter?: IndentFilter }) {
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

  const allItems = t.cats.flatMap(c => c.subs.flatMap(s => s.indents.flatMap(r => r.items)))
  const counts = {
    all: allItems.length,
    approval: allItems.filter(i => itemMatches('approval', i)).length,
    po: allItems.filter(i => itemMatches('po', i)).length,
    delivery: allItems.filter(i => itemMatches('delivery', i)).length,
    late: allItems.filter(i => i.late).length,
    done: allItems.filter(i => itemMatches('done', i)).length,
  }
  const cats = filterIndentsTree(t.cats, filter)

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Indents" value={t.totals.indents.toLocaleString('en-IN')} />
          <Kpi label="Items" value={t.totals.items.toLocaleString('en-IN')} />
          <Kpi label="PO’d (with GST)" value={formatINR(t.totals.poValue)} />
          <Kpi label="Received" value={formatINR(t.totals.receivedValue)} />
          <Kpi label="Items awaiting PO" value={t.totals.awaitingPo.toLocaleString('en-IN')} tone={t.totals.awaitingPo > 0 ? 'amber' : undefined} />
          <Kpi label="Late (past the SLA)" value={counts.late.toLocaleString('en-IN')} tone={counts.late > 0 ? 'rose' : undefined} sub="approval or PO 2 days · delivery 7 days" />
        </div>

        <Pending list={t.pending} />

        <FilterChips base={`/project/${projectId}/procurement`} current={filter} counts={counts} />

        <p className="text-[12px] text-gray-500 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>Live from IN4. Each indent shows its whole cycle — Indent (Draft → Submitted → Verify → Approved) → PO → GRN — with who did what and when from IN4’s own record, and how many days the current step has waited.{t.totals.hidden > 0 && ` ${t.totals.hidden} cancelled or terminated indent${t.totals.hidden === 1 ? '' : 's'} not shown.`}</span>
        </p>

        {cats.length === 0 ? (
          <EmptyState title={filter === 'all' ? 'No indents in IN4 for this project' : `Nothing ${filter === 'late' ? 'late' : `under “${filter}”`}`} description={filter === 'all' ? 'Nothing has been indented against this project’s sub-projects yet.' : 'Every line is somewhere else in the cycle — pick another chip.'} />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white">
            <TreeHeader />
            <TreeBody cats={cats} openAll={filter !== 'all'} />
          </div>
        )}
      </div>
    </RowDetailProvider>
  )
}
