import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { GitCompareArrows, Plus, Building2 } from 'lucide-react'
import NewComparisonButton from './new-comparison-button'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  title: string
  status: string
  scope: string | null
  project_id: string | null
  created_at: string
  project: { code: string; name: string } | null
  vendor_count: number
  item_count: number
}

const STATUS_TONES: Record<string, string> = {
  draft:   'bg-slate-100 text-slate-700',
  active:  'bg-blue-100 text-blue-700',
  awarded: 'bg-emerald-100 text-emerald-700',
  closed:  'bg-gray-100 text-gray-500',
}

export default async function ComparisonsListPage() {
  const perms = await requirePermission('comparison', 'view')
  const canWrite = can(perms, 'comparison', 'edit')
  const supabase = await createClient()

  const [{ data: comparisons }, { data: projects }] = await Promise.all([
    supabase
      .from('cmp_comparisons')
      .select(`
        id, title, status, scope, project_id, created_at,
        project:projects(code, name),
        cmp_vendors(count),
        cmp_items(count)
      `)
      .order('created_at', { ascending: false }),
    supabase.from('projects').select('id, code, name').order('code'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Row[] = (comparisons ?? []).map((c: any) => ({
    id: c.id, title: c.title, status: c.status, scope: c.scope,
    project_id: c.project_id,
    created_at: c.created_at,
    project: Array.isArray(c.project) ? c.project[0] ?? null : c.project,
    vendor_count: c.cmp_vendors?.[0]?.count ?? 0,
    item_count: c.cmp_items?.[0]?.count ?? 0,
  }))

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Comparison Maker"
        subtitle="Side-by-side vendor quotation comparisons — auto-ranks L1, L2 & flags missing line items."
      >
        {canWrite && (
          <NewComparisonButton projects={projects ?? []} />
        )}
      </PageHeader>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GitCompareArrows className="h-10 w-10" />}
            title="No comparisons yet"
            description="Create a comparison: add the scope of work, drop in vendor quotes, and the L1 ranks itself."
            action={canWrite ? <NewComparisonButton projects={projects ?? []} compact /> : null}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(r => (
            <Link key={r.id} href={`/comparisons/${r.id}`}>
              <Card className="p-4 h-full hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 leading-tight flex-1 min-w-0">{r.title}</h3>
                  <Badge className={`${STATUS_TONES[r.status] ?? STATUS_TONES.draft} text-[10px]`}>{r.status}</Badge>
                </div>
                {r.project && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 truncate mb-2">
                    <Building2 className="h-3 w-3 flex-shrink-0" />
                    <span className="font-mono">{r.project.code}</span> · {r.project.name}
                  </p>
                )}
                {r.scope && <p className="text-xs text-gray-500 line-clamp-2 mb-2">{r.scope}</p>}
                <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500">
                  <span>{r.vendor_count} vendor{r.vendor_count === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{r.item_count} item{r.item_count === 1 ? '' : 's'}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
