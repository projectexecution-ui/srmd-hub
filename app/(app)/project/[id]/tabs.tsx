import Link from 'next/link'
import { formatINR, formatDate } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { loadProjectApprovals, loadProjectStores, loadProjectJmr } from '@/lib/revamp/tab-data'
import { ClipboardCheck, Boxes, HardHat } from 'lucide-react'

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
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
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
                <span className="block text-[11px] text-gray-500">
                  {r.wsCode ?? '—'} · submitted {r.submittedAt ? formatDate(r.submittedAt) : '—'}
                </span>
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span className="inline-flex rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap">
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

export async function StoresTab({ projectId }: { projectId: string }) {
  const { ownStores, requests } = await loadProjectStores(projectId)
  const open = requests.filter(r => r.status === 'pending').length

  return (
    <TabShell
      icon={<Boxes className="h-4 w-4" />}
      title="Stores and material requests"
      summary="Stores this project owns, and what the site has asked for."
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Own stores" value={String(ownStores.length)} />
        <Stat label="Requests" value={String(requests.length)} />
        <Stat label="Still open" value={String(open)} tone={open ? 'amber' : 'plain'} />
      </div>

      {ownStores.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {ownStores.map(s => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-gray-900">
                {s.code && <span className="font-mono text-[11px] text-gray-400 mr-2">{s.code}</span>}
                {s.name}
              </span>
              <span className="text-xs text-gray-500 tabular-nums">{s.items} items</span>
            </div>
          ))}
        </div>
      )}

      {requests.length === 0 ? (
        <EmptyState
          title="No material requests"
          description={ownStores.length === 0
            ? 'This project has no store of its own yet, and nobody has raised a request against it.'
            : 'Nobody has raised a request against this project yet.'}
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {requests.map(r => (
            <Link key={r.id} href={`/warehouse/requests/${r.id}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-gray-50 min-h-[44px]">
              <span className="min-w-0">
                <span className="block text-sm text-gray-900 truncate">{r.purpose || '(no purpose given)'}</span>
                <span className="block text-[11px] text-gray-500">{r.reqNo ?? '—'} · {r.date ? formatDate(r.date) : '—'}</span>
              </span>
              <span className="inline-flex rounded-full bg-gray-100 text-gray-700 text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap">
                {r.status.replace('_', ' ')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </TabShell>
  )
}

// ── JMR ─────────────────────────────────────────────────────────────────────

export async function JmrTab({ projectId }: { projectId: string }) {
  const jmr = await loadProjectJmr(projectId)

  return (
    <TabShell
      icon={<HardHat className="h-4 w-4" />}
      title="Measured work"
      summary="Day-by-day machine and manpower logged on this site."
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Entries" value={String(jmr.entries)} />
        <Stat label="Awaiting approval" value={String(jmr.pending)} tone={jmr.pending ? 'amber' : 'plain'} />
        <Stat label="Value" value={jmr.totalAmount > 0 ? formatINR(jmr.totalAmount) : '—'} />
        <Stat label="Last entry" value={jmr.lastEntry ? formatDate(jmr.lastEntry) : '—'} />
      </div>

      {jmr.recent.length === 0 ? (
        <EmptyState title="No JMR entries" description="Nothing has been logged against this project yet." />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {jmr.recent.map(e => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm text-gray-900 truncate">
                  {e.description?.trim() || '(no description)'}
                </span>
                <span className="block text-[11px] text-gray-500">
                  {e.date ? formatDate(e.date) : '—'} · qty {e.qty.toLocaleString('en-IN')}
                </span>
              </span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span className={`inline-flex rounded-full text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap ${
                  e.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {e.status}
                </span>
                <span className="tabular-nums text-gray-900">{formatINR(e.amount)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </TabShell>
  )
}
