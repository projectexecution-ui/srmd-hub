import Link from 'next/link'
import { AlertTriangle, Upload } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { loadIndentsAll } from '@/lib/revamp/indents-tree'
import { boardHref, type BoardParams } from '@/lib/revamp/indents-board'
import { IndentBoard } from '../project/[id]/IndentBoard'

/**
 * The Indent → PO tracker, live from IN4, every project at once — the same
 * board as a project's Indents tab, across projects, with a project pill row
 * on top. Read-only; the doing happens in IN4.
 */
export async function LiveTracker({ params, months }: { params: BoardParams; months: number }) {
  const { projects, in4, error } = await loadIndentsAll({ months })
  if (in4 !== 'live') {
    return <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title={in4 === 'not-configured' ? 'IN4 is not connected on this deployment' : 'IN4 did not answer'} description={error ?? 'The tracker reads IN4 live; it could not be reached just now.'} action={<Link href="/procurement-tracker?view=upload" className="text-[13px] font-semibold text-indigo-700 hover:underline">Open the upload-based tracker instead</Link>} />
  }

  const project = params.p ?? null
  const shown = project ? projects.filter(p => String(p.projectId) === project) : projects
  const pill = (p: string | undefined) => boardHref('/procurement-tracker', params, { p, q: undefined, g: undefined, age: undefined })

  return (
    <div className="space-y-4">
      {/* Projects that need something come first; the number is what is open. */}
      <nav aria-label="Project" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Pill href={pill(undefined)} active={!project}>All projects</Pill>
        {projects.map(p => {
          const openCount = p.tree.pending.length + p.tree.totals.awaitingPo + p.tree.totals.awaitingDelivery
          return (
            <Pill key={p.projectId} href={pill(String(p.projectId))} active={project === String(p.projectId)}>
              {p.project}{openCount > 0 && <span className="tabular-nums text-[12px] text-amber-800">{openCount}</span>}
            </Pill>
          )
        })}
      </nav>

      <IndentBoard scopes={shown.map(p => ({ cats: p.tree.cats, pending: p.tree.pending }))} base="/procurement-tracker" params={params} manyProjects={!project} months={months} />

      <p className="text-[12px] text-gray-400">
        The <Link href="/procurement-tracker?view=upload" className="text-indigo-700 hover:underline inline-flex items-center gap-1"><Upload className="h-3 w-3" /> upload-based tracker</Link> keeps the chase notes and the digest.
      </p>
    </div>
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
