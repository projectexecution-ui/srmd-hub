import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowRight, CheckCircle2, Clock, AlertTriangle, ClipboardList } from 'lucide-react'
import { weekStartIST } from '@/lib/inventory/custody'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

type Row = {
  project_id: string; code: string; name: string
  items_on_site: number
  last_week_start: string | null
  last_created_at: string | null
  last_variances: number
}

export default async function SiteStockPage() {
  await requirePermission('inventory', 'view')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('inv_rpc_custody_projects')
  const rows = (data ?? []) as Row[]
  const thisWeek = weekStartIST()

  const done = rows.filter(r => r.last_week_start === thisWeek).length
  const pending = rows.length - done

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader title="Site stock check" back="/inventory"
        subtitle="Count what's on each site against what was sent — weekly." />

      {error ? (
        <QueryError what="your sites" message={error.message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-8 w-8" />} title="No sites to check yet"
          description="Once material is issued to a site, it shows up here for a weekly count." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <p className="text-2xl font-bold tabular-nums text-emerald-700">{nf(done)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Checked this week</p>
            </Card>
            <Card className="p-3">
              <p className="text-2xl font-bold tabular-nums text-amber-700">{nf(pending)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Still to check this week</p>
            </Card>
          </div>

          <div className="space-y-2">
            {rows.map(r => {
              const checkedThisWeek = r.last_week_start === thisWeek
              const hasVariance = checkedThisWeek && r.last_variances > 0
              return (
                <Link key={r.project_id} href={`/inventory/site-stock/${r.project_id}`}
                  className="block rounded-xl border border-gray-100 bg-white p-4 hover:border-gray-200 hover:bg-gray-50/50 transition">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{r.code}</span>
                        <span className="text-sm text-gray-500 truncate">{r.name}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {nf(r.items_on_site)} item{r.items_on_site === 1 ? '' : 's'} on site
                        {r.last_created_at && <span> · last checked {formatDate(r.last_created_at)}</span>}
                        {!r.last_created_at && <span> · never checked</span>}
                      </p>
                    </div>
                    {hasVariance ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1 whitespace-nowrap">
                        <AlertTriangle className="h-3.5 w-3.5" /> {nf(r.last_variances)} to review
                      </span>
                    ) : checkedThisWeek ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 whitespace-nowrap">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Checked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 whitespace-nowrap">
                        <Clock className="h-3.5 w-3.5" /> Due
                      </span>
                    )}
                    <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
