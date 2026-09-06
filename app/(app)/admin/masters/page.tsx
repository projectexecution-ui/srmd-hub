import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { loadMasterSummaries } from '@/lib/masters'
import { ArrowRight, Database } from 'lucide-react'

export const dynamic = 'force-dynamic'

/** Masters landing: the lists everything else points at, with IN4's register
 *  as the base and the hub's own lists measured against it. */
export default async function MastersPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const { cards, synced } = await loadMasterSummaries()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Masters"
        subtitle="The lists everything else points at. IN4 keeps the register — contractors, suppliers, materials, stores, trusts — and the hub's own lists are laid against it here."
      />

      {!synced && (
        <Card className="p-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold flex items-center gap-2"><Database className="h-4 w-4" /> IN4's masters have not been mirrored yet.</p>
          <p className="mt-1">Run the <b>Masters</b> feed once from <Link href="/admin/in4" className="underline">IN4 live sync</Link> (it needs the IN4 connection on this deployment). Until then these screens show the hub's own lists only.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map(m => (
          <Link key={m.key} href={m.href} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors block min-h-[44px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{m.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{m.hint}</p>
              </div>
              {m.total !== null && <p className="text-lg font-bold tabular-nums text-gray-900 flex-shrink-0">{m.total.toLocaleString('en-IN')}</p>}
            </div>
            <ul className="mt-2.5 space-y-1">
              {m.lines.map((l, i) => (
                <li key={i} className={`text-[11px] ${l.tone === 'warn' ? 'text-amber-800' : l.tone === 'ok' ? 'text-emerald-800' : 'text-gray-500'}`}>{l.text}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs font-medium text-indigo-700 inline-flex items-center gap-1">Open <ArrowRight className="h-3.5 w-3.5" /></p>
          </Link>
        ))}
      </div>
    </div>
  )
}
