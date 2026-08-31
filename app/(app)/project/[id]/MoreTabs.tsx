import { Fragment } from 'react'
import Link from 'next/link'
import { formatINR, formatDateTime } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow } from '@/components/cost-control/project-tree'
import {
  loadProjectProcurement, loadProjectDiscussions, type ProcurementGroup,
} from '@/lib/revamp/tab-data'
import { Truck, MessageSquare, Info } from 'lucide-react'

function Stat({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'amber' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === 'amber' ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tone === 'amber' ? 'text-amber-900' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

// ── Indent → PO ─────────────────────────────────────────────────────────────

export async function ProcurementTab({ projectId }: { projectId: string }) {
  const p = await loadProjectProcurement(projectId)

  return (
    <section className="space-y-3">
      <header className="flex items-start gap-2.5">
        <Truck className="h-4 w-4 mt-0.5 text-gray-400" />
        <div>
          <h2 className="text-sm font-bold text-gray-900">Indents and purchase orders</h2>
          <p className="text-xs text-gray-500">From the Indent → PO tracker upload.</p>
        </div>
      </header>

      {p.matchedName ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="Indent lines" value={p.totalLines.toLocaleString('en-IN')} />
            <Stat label="Still pending" value={p.pendingLines.toLocaleString('en-IN')} tone={p.pendingLines ? 'amber' : 'plain'} />
            <Stat label="Pending value" value={p.pendingValue > 0 ? formatINR(p.pendingValue) : '—'} tone={p.pendingValue > 0 ? 'amber' : 'plain'} />
            <Stat label="PO raised" value={p.poValue > 0 ? formatINR(p.poValue) : '—'} />
            <Stat label="Received (GRN)" value={p.grnValue > 0 ? formatINR(p.grnValue) : '—'} />
          </div>
          {/* Name the sub-projects these lines came from — a group's total
              covers several, and the reader should not have to guess which. */}
          <details className="text-[11px] text-gray-500">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              From {p.matchedName!.split(', ').length} sub-project
              {p.matchedName!.split(', ').length === 1 ? '' : 's'} in the upload
              <span className="text-gray-400"> — show</span>
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {p.matchedName!.split(', ').map(n => (
                <li key={n} className="text-gray-600">{n}</li>
              ))}
            </ul>
          </details>
          <IndentLines groups={p.byDiscipline} />

          <Link href="/procurement-tracker" className="inline-block text-xs font-medium text-indigo-700 hover:underline">
            Open the full tracker →
          </Link>
        </>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <Info className="h-4 w-4" />
            {p.uploadCovers > 0
              ? 'This project has no name in the tracker upload'
              : 'No tracker upload yet'}
          </p>
          <p className="text-xs text-amber-800 mt-1">
            {p.uploadCovers > 0
              ? <>The upload covers {p.uploadCovers} projects, but IN4 identifies them by name and none
                  of those names is this project. That is the same naming gap the Reports tab has.</>
              : <>Nothing has been uploaded to the tracker yet.</>}
          </p>
          {p.unmatchedNames.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              In the upload: {p.unmatchedNames.slice(0, 8).join(' · ')}
              {p.unmatchedNames.length > 8 && ` · +${p.unmatchedNames.length - 8} more`}
            </p>
          )}
          <div className="flex flex-wrap gap-3 mt-2">
            <Link href="/masters/mapping" className="text-xs font-semibold text-amber-900 underline">
              Why names do not match →
            </Link>
            <Link href="/procurement-tracker" className="text-xs font-medium text-amber-900 underline">
              Open the tracker →
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}

/** The indent lines themselves — category over line, the same tree the
 *  Internal Estimate uses, so it collapses and reads the same way. Numbers
 *  alone are not something anyone can chase. */
function IndentLines({ groups }: { groups: ProcurementGroup[] }) {
  if (groups.length === 0) return null
  const catIds = groups.map(g => g.discipline)

  return (
    <TreeProvider allCatIds={catIds} emptyCount={0}>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-900">Every indent line</span>
          <TreeToolbar />
        </div>

        {/* Desktop. Body scrolls in this box with sticky header cells — page
            level sticky does not work in this app (AGENTS.md). */}
        <div className="overflow-auto max-h-[70vh] hidden md:block">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[280px]">Category / Material</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[150px]">Supplier</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">Ordered / Got</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">Pending</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <Fragment key={g.discipline}>
                  <tr className="bg-gray-50/60 border-t border-gray-200">
                    <td className="px-3 py-2 font-semibold text-gray-800">
                      <CatChevron catId={g.discipline} />
                      {g.discipline}
                      <span className="ml-2 text-[11px] font-normal text-gray-400">{g.lines.length} lines</span>
                    </td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700">
                      {g.pendingValue > 0 ? formatINR(g.pendingValue) : '—'}
                    </td>
                    <td className="px-3 py-2"></td>
                  </tr>
                  <CatRows catId={g.discipline}>
                    {g.lines.map(l => (
                      <SubRow key={l.id} empty={false}>
                        <tr className="border-t border-gray-100 hover:bg-gray-50/60 align-top">
                          <td className="pl-9 pr-3 py-2 text-gray-700">
                            <span className="block">{l.material || '—'}</span>
                            <span className="block text-[11px] text-gray-400 font-mono">
                              {l.indentNo}{l.indentDate ? ` · ${l.indentDate}` : ''}
                              {l.ageDays > 0 ? ` · ${l.ageDays}d old` : ''}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{l.supplier || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {l.orderedQty.toLocaleString('en-IN')} / {l.receivedQty.toLocaleString('en-IN')}
                            <span className="text-[11px] text-gray-400"> {l.uom}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.pendingValue > 0
                              ? <span className="font-semibold text-amber-700">{formatINR(l.pendingValue)}</span>
                              : <span className="text-gray-300">—</span>}
                            {l.pendingQty > 0 && (
                              <span className="block text-[11px] text-gray-400">
                                {l.pendingQty.toLocaleString('en-IN')} {l.uom} due
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <StatusChip status={l.status} />
                          </td>
                        </tr>
                      </SubRow>
                    ))}
                  </CatRows>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile — same lines as cards, category bar pinned. */}
        <div className="md:hidden divide-y divide-gray-100 overflow-auto max-h-[70vh]">
          {groups.map(g => (
            <div key={g.discipline}>
              <div className="sticky top-0 z-10 px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
                <span className="flex items-center min-w-0 text-[12px] font-semibold text-gray-800">
                  <CatChevron catId={g.discipline} />
                  <span className="truncate">{g.discipline}</span>
                </span>
                {g.pendingValue > 0 && (
                  <span className="text-[11px] text-amber-700 flex-shrink-0 tabular-nums">{formatINR(g.pendingValue)}</span>
                )}
              </div>
              <CatRows catId={g.discipline}>
                {g.lines.map(l => (
                  <div key={l.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-gray-900 min-w-0">{l.material || '—'}</p>
                      <StatusChip status={l.status} />
                    </div>
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{l.indentNo}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {l.supplier || 'no supplier'} · {l.orderedQty}/{l.receivedQty} {l.uom}
                      {l.pendingValue > 0 && (
                        <span className="font-semibold text-amber-700"> · {formatINR(l.pendingValue)} pending</span>
                      )}
                    </p>
                  </div>
                ))}
              </CatRows>
            </div>
          ))}
        </div>
      </div>
    </TreeProvider>
  )
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'received' ? 'bg-emerald-100 text-emerald-800'
    : status === 'no_po' ? 'bg-rose-100 text-rose-800'
    : 'bg-amber-100 text-amber-800'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ── Discussions ─────────────────────────────────────────────────────────────

export async function DiscussionsTab({ projectId }: { projectId: string }) {
  const comments = await loadProjectDiscussions(projectId)

  return (
    <section className="space-y-3">
      <header className="flex items-start gap-2.5">
        <MessageSquare className="h-4 w-4 mt-0.5 text-gray-400" />
        <div>
          <h2 className="text-sm font-bold text-gray-900">Discussions</h2>
          <p className="text-xs text-gray-500">
            Every comment written on this project&rsquo;s budget sheets, newest first — the conversation
            for the project as a whole, which today can only be read one sheet at a time.
          </p>
        </div>
      </header>

      {comments.length === 0 ? (
        <EmptyState
          title="Nothing said yet"
          description="No comments have been written on any of this project's budget sheets."
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {comments.map(c => (
            <div key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold text-gray-900">{c.author}</p>
                <p className="text-[11px] text-gray-400">{formatDateTime(c.createdAt)}</p>
              </div>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{c.body}</p>
              <Link
                href={`/cost-control/working-sheets/${c.wsId}`}
                className="inline-block mt-1.5 text-[11px] font-medium text-indigo-700 hover:underline"
              >
                on {c.wsCode ?? 'a sheet'} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
