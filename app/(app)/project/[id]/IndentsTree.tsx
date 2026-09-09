import Link from 'next/link'
import { AlertTriangle, Link2Off } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { loadIndentsTree } from '@/lib/revamp/indents-tree'
import type { BoardParams } from '@/lib/revamp/indents-board'
import { IndentBoard } from './IndentBoard'

/**
 * The Indents tab: the project's Indent → PO → GRN cycle as one board
 * (IndentBoard.tsx), read live from IN4. Approval itself happens in IN4.
 */
export async function IndentsTree({ projectId, params }: { projectId: string; params: BoardParams }) {
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

  return <IndentBoard scopes={[{ cats: t.cats, pending: t.pending }]} base={`/project/${projectId}/procurement`} params={params} />
}
