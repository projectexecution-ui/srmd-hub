import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatINR, formatDateTime } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { loadProjectProcurement, loadProjectDiscussions } from '@/lib/revamp/tab-data'
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
          <p className="text-[11px] text-gray-500">
            Matched to <b className="text-gray-700">&ldquo;{p.matchedName}&rdquo;</b> in the upload,
            which covers {p.uploadCovers} projects.
          </p>
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
