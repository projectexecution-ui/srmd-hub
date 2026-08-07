import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { PackageCheck } from 'lucide-react'
import { CheckForm } from './CheckForm'
import { weekStartIST, weekLabel, type CustodyPrefillItem } from '@/lib/inventory/custody'

export const dynamic = 'force-dynamic'

type RpcItem = {
  item_id: string; code: string; name: string; category: string | null
  unit: string; expected: number; is_returnable: boolean; last_actual: number | null
}

export default async function ProjectCheckPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requirePermission('inventory', 'view')
  const { projectId } = await params
  const supabase = await createClient()

  const [{ data: proj }, { data: prefill, error }] = await Promise.all([
    supabase.from('projects').select('code, name').eq('id', projectId).maybeSingle(),
    supabase.rpc('inv_rpc_custody_prefill', { p_project: projectId }),
  ])

  const items: CustodyPrefillItem[] = ((prefill ?? []) as RpcItem[]).map(r => ({
    itemId: r.item_id, code: r.code, name: r.name, category: r.category, unit: r.unit,
    isReturnable: r.is_returnable, expected: Number(r.expected || 0),
    lastActual: r.last_actual == null ? null : Number(r.last_actual),
  }))

  const weekStart = weekStartIST()
  const projectLabel = proj ? `${proj.code} — ${proj.name}` : 'This site'

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <PageHeader title="Site stock check" back="/inventory/site-stock" subtitle={projectLabel} />
      <p className="text-sm text-gray-500 -mt-2">Week of <span className="font-medium text-gray-700">{weekLabel(weekStart)}</span> · count what&apos;s physically on site right now.</p>

      {error ? (
        <QueryError what="this site's stock" message={error.message} />
      ) : items.length === 0 ? (
        <EmptyState icon={<PackageCheck className="h-8 w-8" />} title="Nothing on site to count"
          description="No material is currently issued to this site. Once items are issued, they appear here for counting." />
      ) : (
        <CheckForm projectId={projectId} weekStart={weekStart} items={items} />
      )}
    </div>
  )
}
