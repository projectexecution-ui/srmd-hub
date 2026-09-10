import Link from 'next/link'
import { formatINR, formatDate } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { loadProjectApprovals } from '@/lib/revamp/tab-data'
import { ClipboardCheck } from 'lucide-react'

/** Shared chrome so every tab reads the same way: a title, a one-line summary
 *  of what the numbers mean, then the detail. */
function TabShell({
  icon, title, summary, children,
}: { icon: React.ReactNode; title: string; summary: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 text-gray-400">{icon}</span>
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{summary}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'amber' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === 'amber' ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
      <p className="text-[12px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tone === 'amber' ? 'text-amber-900' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

// ── Approvals ───────────────────────────────────────────────────────────────

export async function ApprovalsTab({ projectId }: { projectId: string }) {
  const rows = await loadProjectApprovals(projectId)
  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <TabShell
      icon={<ClipboardCheck className="h-4 w-4" />}
      title="Waiting on someone"
      summary="Budget requests part-way through the sign-off chain, oldest first."
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Requests" value={String(rows.length)} tone={rows.length ? 'amber' : 'plain'} />
        <Stat label="Value" value={total > 0 ? formatINR(total) : '—'} tone={total > 0 ? 'amber' : 'plain'} />
        <Stat label="Oldest" value={rows[0]?.submittedAt ? formatDate(rows[0].submittedAt) : '—'} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing is waiting" description="Every budget request on this project has been decided." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {rows.map(r => (
            <Link
              key={r.id}
              href={`/cost-control/working-sheets/${r.id}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-gray-50 min-h-[44px]"
            >
              <span className="min-w-0">
                <span className="block text-sm text-gray-900 truncate">
                  {r.category} <span className="text-gray-400">›</span> {r.subSkill}
                </span>
                <span className="block text-[12px] text-gray-500">
                  {r.wsCode ?? '—'} · submitted {r.submittedAt ? formatDate(r.submittedAt) : '—'}
                </span>
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span className="inline-flex rounded-full bg-amber-100 text-amber-800 text-[12px] font-semibold px-2 py-0.5 whitespace-nowrap">
                  {r.waitingOn}
                </span>
                <span className="tabular-nums font-semibold text-gray-900">{formatINR(r.amount)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </TabShell>
  )
}

// ── Stores ──────────────────────────────────────────────────────────────────
