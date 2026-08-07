import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { getDashboardSnapshot } from '@/lib/jmr/dashboard'
import { formatINRShort } from '@/lib/jmr/format'
import { Coins, ClipboardCheck } from 'lucide-react'
import { SendReportButton } from './send-report-button'
import { EntriesPendingApproval, type PendingEntry } from './EntriesPendingApproval'

export const dynamic = 'force-dynamic'

export default async function JmrDashboardPage() {
  await requirePermission('jmr', 'view')
  const snap = await getDashboardSnapshot()

  // ── Pending JMR entries awaiting Head approval ──────────────────
  const supabase = await createClient()
  type RelObj<T> = T | T[] | null | undefined
  function unwrap<T>(v: RelObj<T>): T | null {
    if (!v) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }
  const { data: pendingRaw } = await supabase
    .from('jmr_daily_entries')
    .select(`
      id, entry_date, quantity, amount, rate_snapshot, log_sheet_photo_url,
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

  // Batch-mint 1h signed URLs for the log sheet photos so the Head can
  // see them inline on the approval row. jmr-photos is a private bucket.
  const photoPaths = (pendingRaw ?? [])
    .map(r => (r as { log_sheet_photo_url: string | null }).log_sheet_photo_url)
    .filter((p): p is string => !!p)
  const signedByPath = new Map<string, string>()
  if (photoPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from('jmr-photos').createSignedUrls(photoPaths, 3600)
    for (const s of signedList ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const pending: PendingEntry[] = (pendingRaw ?? []).map((r: {
    id: string; entry_date: string; quantity: number | string; amount: number | string; rate_snapshot: number | string;
    log_sheet_photo_url: string | null;
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
      photo_url: r.log_sheet_photo_url ? signedByPath.get(r.log_sheet_photo_url) ?? null : null,
      has_photo: !!r.log_sheet_photo_url,
    }
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="JMR Dashboard" subtitle="Logged spend · approvals (incl. GST)" back="/jmr">
        <SendReportButton />
      </PageHeader>

      <div className="grid grid-cols-2 sm:max-w-md gap-3 mb-4">
        <StatCard
          tone="emerald" icon={<Coins className="h-5 w-5" />}
          label="SPEND (JMR)"
          big={formatINRShort(snap.totals.spend)}
          sub="machinery + manpower · incl. GST"
        />
        <StatCard
          tone="blue" icon={<ClipboardCheck className="h-5 w-5" />}
          label="Pending approval"
          big={String(pending.length)}
          sub={pending.length === 1 ? 'entry to review' : 'entries to review'}
        />
      </div>

      {/* JMR entries awaiting Head approval */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-800">Entries awaiting approval</h2>
          {pending.length > 0 && (
            <p className="text-xs text-gray-500">Add a comment, then ✓ approve or ⚠ flag</p>
          )}
        </div>
        <EntriesPendingApproval initial={pending} />
      </div>

      <Card>
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">Contractor-wise · logged spend</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Value of work logged (rate × qty), GST-inclusive.</p>
        </div>
        {snap.perContractor.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Contractor</th>
                  <th className="px-4 py-2 text-right font-semibold">Spend</th>
                </tr>
              </thead>
              <tbody>
                {snap.perContractor.map(c => (
                  <tr key={c.contractor_id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatINRShort(c.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function StatCard({ tone, icon, label, big, sub }: {
  tone: 'emerald' | 'blue'; icon: React.ReactNode; label: string; big: string; sub: string
}) {
  const colors: Record<string, { bg: string; ic: string; head: string; big: string }> = {
    emerald: { bg: 'bg-emerald-50', ic: 'text-emerald-700', head: 'text-emerald-900', big: 'text-emerald-900' },
    blue:    { bg: 'bg-blue-50',    ic: 'text-blue-700',    head: 'text-blue-900',    big: 'text-blue-900' },
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
