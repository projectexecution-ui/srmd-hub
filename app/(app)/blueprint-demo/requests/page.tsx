import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, string> = {
  draft:     'bg-stone-100 text-stone-700',
  submitted: 'bg-amber-100 text-amber-800',
  review:    'bg-blue-100 text-blue-800',
  approved:  'bg-emerald-100 text-emerald-800',
  closed:    'bg-stone-200 text-stone-600',
  rejected:  'bg-rose-100 text-rose-800',
}

export default async function BlueprintDemoRequestsPage() {
  await requirePermission('blueprint-demo', 'view')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('blueprint_demo_requests')
    .select('id, request_no, title, status, amount, created_at, projects(code, name)')
    .order('created_at', { ascending: false })

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Demo requests"
          back="/blueprint-demo"
          subtitle="Every row in the sandbox state machine. Click a row to see its detail + role-gated action panel."
        />
        <Link href="/blueprint-demo/requests/new" className="inline-flex items-center gap-1.5 text-xs font-medium bg-purple-700 hover:bg-purple-800 text-white rounded-lg px-3 py-2">
          <Plus className="h-4 w-4" /> Create demo request
        </Link>
      </div>

      {error && (
        <Card className="bg-rose-50 border-rose-200 p-4 text-sm text-rose-800">
          {error.message}
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-stone-500">
                <th className="px-4 py-2">Doc</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(data ?? []).map(r => {
                const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
                return (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2 font-mono text-[11px]">
                      <Link href={`/blueprint-demo/requests/${r.id}`} className="text-purple-700 hover:underline">
                        {r.request_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-stone-800 max-w-[260px] truncate" title={r.title}>{r.title}</td>
                    <td className="px-4 py-2 text-xs text-stone-500">{proj ? `${proj.code} — ${proj.name}` : '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[r.status] ?? 'bg-stone-100 text-stone-700'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-stone-700 whitespace-nowrap">
                      {r.amount != null ? `₹${Number(r.amount).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-stone-500 whitespace-nowrap">{formatDate(r.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
