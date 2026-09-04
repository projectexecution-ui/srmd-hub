import Link from 'next/link'
import { requirePermission, can } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { readLastSync } from '@/lib/in4/sync'
import { formatDateTime } from '@/lib/utils'
import { Database } from 'lucide-react'
import { BphHubClient } from './bph-hub-client'

export const dynamic = 'force-dynamic'

// The BPH hub is the full ERP budget. It used to be a client component with
// no gate at all — any signed-in account, viewers included, could open it,
// and the module on/off switch never reached it. The gate lives here; the
// iframe shell is unchanged in bph-hub-client.tsx.
export default async function BPHReportHubPage() {
  const perms = await requirePermission('budget-vs-actual', 'view')
  const supabase = await createClient()
  const last = await readLastSync(supabase)
  const isAdmin = can(perms, 'budget-vs-actual', 'admin')

  return (
    <div className="flex flex-col h-screen">
      {/* IN4 sync status — one quiet line, so whoever uploads knows whether
          the upload is still needed. */}
      {(last || isAdmin) && (
        <div className={`flex items-center gap-2 px-4 py-1.5 text-[12px] border-b ${last?.mode === 'live' ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
          <Database className="h-3.5 w-3.5 flex-shrink-0" />
          {last
            ? last.ok
              ? <span>IN4 live sync · {last.mode === 'live' ? 'this report is now written from IN4 twice a day — no upload needed' : 'shadow mode — upload still the source'} · last {formatDateTime(last.at)}{typeof last.exact === 'number' && last.figures ? ` · ${Math.round((last.exact / last.figures) * 100)}% matches the last upload` : ''}</span>
              : <span>IN4 live sync failed at {formatDateTime(last.at)} — {last.error}</span>
            : <span>IN4 live sync has not run yet.</span>}
          {isAdmin && <Link href="/admin/in4" className="ml-auto font-semibold text-blue-700 hover:underline whitespace-nowrap">Open sync</Link>}
        </div>
      )}
      <BphHubClient />
    </div>
  )
}
