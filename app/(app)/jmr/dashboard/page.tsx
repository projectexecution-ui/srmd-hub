import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getDashboardSnapshot } from '@/lib/jmr/dashboard'
import { formatINR, formatINRShort } from '@/lib/jmr/format'
import { AlertTriangle, Coins, Receipt, Wallet, Send, FileText } from 'lucide-react'
import { SendReportButton } from './send-report-button'
import { EntriesPendingApproval, type PendingEntry } from './EntriesPendingApproval'

export const dynamic = 'force-dynamic'

export default async function JmrDashboardPage() {
  await requirePermission('jmr', 'view')
  const snap = await getDashboardSnapshot()

  // ── Pending JMR entries awaiting PM approval ────────────────────
  // Fetched here (server-side) so the page is one round trip. The
  // EntriesPendingApproval client component handles approve / flag
  // actions and updates optimistically.
  const supabase = await createClient()
  type RelObj<T> = T | T[] | null | undefined
  function unwrap<T>(v: RelObj<T>): T | null {
    if (!v) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }
  const { data: pendingRaw } = await supabase
    .from('jmr_daily_entries')
    .select(`
      id, entry_date, quantity, amount, rate_snapshot,
      jmr_items ( name, unit ),
      jmr_contractors ( name ),
      projects!jmr_daily_entries_project_id_fkey ( code, name ),
      sub_project:projects!jmr_daily_entries_sub_project_id_fkey ( code, name ),
      engineer:profiles!jmr_daily_entries_logged_by_user_id_fkey ( name, full_name, email )
    `)
    .eq('status', 'submitted')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  const pending: PendingEntry[] = (pendingRaw ?? []).map((r: {
    id: string; entry_date: string; quantity: number | string; amount: number | string; rate_snapshot: number | string;
    jmr_items: RelObj<{ name: string; unit: string }>;
    jmr_contractors: RelObj<{ name: string }>;
    projects: RelObj<{ code: string | null; name: string }>;
    sub_project: RelObj<{ code: string | null; name: string }>;
    engineer: RelObj<{ name: string | null; full_name: string | null; email: string }>;
  }) => {
    const it = unwrap(r.jmr_items)
    const ctr = unwrap(r.jmr_contractors)
    const proj = unwrap(r.projects)
    const sub = unwrap(r.sub_project)
    const eng = unwrap(r.engineer)
    const projLabel = sub?.code || sub?.name || proj?.code || proj?.name || '—'
    return {
      id: r.id,
      entry_date: r.entry_date,
      quantity: Number(r.quantity),
      amount: Number(r.amount),
      rate_snapshot: Number(r.rate_snapshot),
      unit: it?.unit ?? '',
      item_name: it?.name ?? '—',
      project_label: projLabel,
      contractor_name: ctr?.name ?? '—',
      engineer_name: eng?.name ?? eng?.full_name ?? eng?.email ?? '—',
    }
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="PM Dashboard" subtitle="Earned · Billed · Paid · alerts" back="/jmr">
        <SendReportButton />
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          tone="emerald" icon={<Coins className="h-5 w-5" />}
          label="EARNED (JMR)"
          big={formatINRShort(snap.totals.earned)}
          sub="work done · cumulative"
        />
        <StatCard
          tone="blue" icon={<Receipt className="h-5 w-5" />}
          label="BILLED"
          big={formatINRShort(snap.totals.billed)}
          sub={`${snap.billsAwaitingAction.length} bill${snap.billsAwaitingAction.length === 1 ? '' : 's'} awaiting`}
        />
        <StatCard
          tone="amber" icon={<Wallet className="h-5 w-5" />}
          label="PAID"
          big={formatINRShort(snap.totals.paid)}
          sub={`${formatINRShort(snap.totals.pendingRelease)} pending release`}
        />
      </div>

      {snap.totals.unbilled > 0 && (
        <Card className="mb-4 bg-rose-50 border-rose-200">
          <CardContent className="p-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-rose-900">
                Unbilled liability: {formatINRShort(snap.totals.unbilled)}
              </p>
              {snap.oldestGap ? (
                <p className="text-xs text-rose-900/80 mt-0.5">
                  Earned but contractors haven&apos;t billed yet · oldest gap: {snap.oldestGap.days} days
                  ({snap.oldestGap.contractorName}, {snap.oldestGap.projectName})
                </p>
              ) : (
                <p className="text-xs text-rose-900/80 mt-0.5">Earned but not yet billed.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* JMR entries awaiting PM / Head approval */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-800">Entries awaiting approval</h2>
          {pending.length > 0 && (
            <p className="text-xs text-gray-500">Click ✓ to approve, ⚠ to flag</p>
          )}
        </div>
        <EntriesPendingApproval initial={pending} />
      </div>

      <Card className="mb-4">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">Contractor-wise · Earned vs Billed vs Paid</h2>
        </div>
        {snap.perContractor.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Contractor</th>
                  <th className="px-4 py-2 text-right font-semibold">Earned</th>
                  <th className="px-4 py-2 text-right font-semibold">Billed</th>
                  <th className="px-4 py-2 text-right font-semibold">Paid</th>
                  <th className="px-4 py-2 text-right font-semibold">Unbilled</th>
                  <th className="px-4 py-2 text-right font-semibold">Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {snap.perContractor.map(c => (
                  <tr key={c.contractor_id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatINRShort(c.earned)}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatINRShort(c.billed)}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatINRShort(c.paid)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${c.unbilled > 0 ? 'text-rose-700' : 'text-gray-400'}`}>{formatINRShort(c.unbilled)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${c.unpaid > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{formatINRShort(c.unpaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">Bills awaiting your action</h2>
        </div>
        {snap.billsAwaitingAction.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No bills awaiting action.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {snap.billsAwaitingAction.map(b => (
              <li key={b.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="min-w-0">
                  <Link href={`/jmr/bills/${b.id}`} className="font-semibold text-blue-700 hover:underline">{b.bill_number}</Link>
                  <p className="text-xs text-gray-500">{b.contractorName}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-sm">{formatINR(b.total_amount)}</span>
                  <ActionPill status={b.status} flagged={b.variance_flag} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function StatCard({ tone, icon, label, big, sub }: {
  tone: 'emerald' | 'blue' | 'amber'; icon: React.ReactNode; label: string; big: string; sub: string
}) {
  const colors: Record<string, { bg: string; ic: string; head: string; big: string }> = {
    emerald: { bg: 'bg-emerald-50', ic: 'text-emerald-700', head: 'text-emerald-900', big: 'text-emerald-900' },
    blue:    { bg: 'bg-blue-50',    ic: 'text-blue-700',    head: 'text-blue-900',    big: 'text-blue-900' },
    amber:   { bg: 'bg-amber-50',   ic: 'text-amber-700',   head: 'text-amber-900',   big: 'text-amber-900' },
  }
  const c = colors[tone]!
  return (
    <Card className={`${c.bg} border-0`}>
      <CardContent className="p-3">
        <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${c.head}`}>
          <span className={c.ic}>{icon}</span>
          {label}
        </div>
        <p className={`text-2xl font-bold mt-1.5 ${c.big}`}>{big}</p>
        <p className="text-xs text-gray-600 mt-0.5">{sub}</p>
      </CardContent>
    </Card>
  )
}

function ActionPill({ status, flagged }: { status: string; flagged: boolean }) {
  if (flagged) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800">Variance flag</span>
  if (status === 'pm_review') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Awaiting verify</span>
  if (status === 'approved') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Approved · pending pay</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{status}</span>
}
