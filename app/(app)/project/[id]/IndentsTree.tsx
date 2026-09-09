import Link from 'next/link'
import { AlertTriangle, Link2Off } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { RowDetailProvider } from '@/components/cost-control/project-tree'
import { loadIndentsTree, itemMatches, type IndentFilter } from '@/lib/revamp/indents-tree'
import { Tiles, tilesFor, defaultTile, PendingList, ActionList, TreeHeader, TreeBody } from './IndentRows'

/**
 * The Indents tab. One question first — what needs someone now — as five
 * tiles that are also the tabs. Each opens a plain list of just those lines;
 * the last tile is the full tree, slim, with the record under "Details".
 * Read live from IN4; approval itself happens in IN4.
 */
export async function IndentsTree({ projectId, filter }: { projectId: string; filter?: IndentFilter }) {
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

  const indents = t.cats.flatMap(c => c.subs.flatMap(s => s.indents))
  const seen = new Set<string>()
  const rows = indents.flatMap(r => r.items.map(item => ({ item, indent: r }))).filter(x => (seen.has(`${x.indent.id}:${x.item.id}`) ? false : (seen.add(`${x.indent.id}:${x.item.id}`), true)))
  const counts: Record<IndentFilter, number> & { indents: number } = {
    all: rows.length, indents: t.totals.indents,
    approval: rows.filter(x => itemMatches('approval', x.item)).length,
    po: rows.filter(x => itemMatches('po', x.item)).length,
    delivery: rows.filter(x => itemMatches('delivery', x.item)).length,
    late: rows.filter(x => x.item.late).length,
    done: rows.filter(x => itemMatches('done', x.item)).length,
  }
  const tiles = tilesFor(counts, t.pending.length)
  const current: IndentFilter = filter && filter !== 'done' ? filter : defaultTile(tiles)
  const href = (f: IndentFilter) => `/project/${projectId}/procurement${f !== 'all' ? `?f=${f}` : ''}`

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <Tiles tiles={tiles} current={current} href={href} />

        {current === 'approval' && <PendingList list={t.pending} />}
        {current === 'po' && <ActionList rows={rows.filter(x => itemMatches('po', x.item))} empty="Every approved line has its PO." />}
        {current === 'delivery' && <ActionList rows={rows.filter(x => itemMatches('delivery', x.item))} empty="Nothing ordered is still to arrive." />}
        {current === 'late' && <ActionList rows={rows.filter(x => x.item.late)} empty="Nothing is past its time — approvals and POs within 2 days, deliveries within 7." />}

        {current === 'all' && (
          t.cats.length === 0
            ? <EmptyState title="No indents in IN4 for this project" description="Nothing has been indented against this project’s sub-projects yet." />
            : (
              <div className="rounded-lg border border-gray-200 bg-white">
                <TreeHeader />
                <TreeBody cats={t.cats} />
              </div>
            )
        )}

        <p className="text-[12px] text-gray-400">
          Live from IN4 · {t.totals.indents} indents · PO’d {formatINR(t.totals.poValue)} · received {formatINR(t.totals.receivedValue)}{t.totals.hidden > 0 ? ` · ${t.totals.hidden} cancelled or terminated not shown` : ''}. Late = approval or PO waiting over 2 days, delivery over 7.
        </p>
      </div>
    </RowDetailProvider>
  )
}
