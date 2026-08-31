import Link from 'next/link'
import { formatDateTime } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { loadProjectProcurement, loadProjectDiscussions } from '@/lib/revamp/tab-data'
import { IndentViews } from './IndentViews'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { notFound } from 'next/navigation'
import { MentionText } from '@/components/mentions/MentionText'
import { Truck, MessageSquare, Info } from 'lucide-react'

// ── Indent → PO ─────────────────────────────────────────────────────────────

export async function ProcurementTab({ projectId }: { projectId: string }) {
  const [p, cockpit] = await Promise.all([loadProjectProcurement(projectId), loadCockpit(projectId)])
  if (!cockpit) notFound()
  const projectName = cockpit.project.code ?? cockpit.project.name

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
          {/* The tracker's own three views, on this project's lines. */}
          <IndentViews lines={p.lines} projectName={projectName} />

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

// ── Discussions ─────────────────────────────────────────────────────────────

export async function DiscussionsTab({ projectId }: { projectId: string }) {
  const { comments, mentionUsers, mentioningMe } = await loadProjectDiscussions(projectId)

  // Anything aimed at you first, then newest. A mention is the only part of a
  // thread that is actually a task, and today it can only be found by opening
  // each sheet in turn.
  const ordered = [...comments].sort((a, b) =>
    Number(b.mentionsMe) - Number(a.mentionsMe) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <section className="space-y-3">
      <header className="flex items-start gap-2.5">
        <MessageSquare className="h-4 w-4 mt-0.5 text-gray-400" />
        <div>
          <h2 className="text-sm font-bold text-gray-900">
            Discussions
            {comments.length > 0 && (
              <span className="ml-2 text-[11px] font-normal text-gray-500">
                {comments.length} comment{comments.length === 1 ? '' : 's'}
                {mentioningMe > 0 && (
                  <span className="font-semibold text-blue-700"> · {mentioningMe} mentioning you</span>
                )}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500">
            Every comment written on this project&rsquo;s budget sheets — the conversation for the
            project as a whole, which today can only be read one sheet at a time.
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
          {ordered.map(c => (
            <div
              key={c.id}
              className={`px-4 py-3 ${c.mentionsMe ? 'bg-blue-50/50 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold text-gray-900">
                  {c.author}
                  {c.mentionsMe && (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 align-middle">
                      mentions you
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400">{formatDateTime(c.createdAt)}</p>
              </div>
              {/* MentionText, the same renderer the per-sheet comments panel
                  uses, so an @name looks identical in both places instead of
                  arriving here as plain text. */}
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">
                <MentionText text={c.body} users={mentionUsers} />
              </p>
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
