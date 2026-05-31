import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Building2 } from 'lucide-react'
import ComparisonGrid from './comparison-grid'

export const dynamic = 'force-dynamic'

const STATUS_TONES: Record<string, string> = {
  draft:   'bg-slate-100 text-slate-700',
  active:  'bg-blue-100 text-blue-700',
  awarded: 'bg-emerald-100 text-emerald-700',
  closed:  'bg-gray-100 text-gray-500',
}

export default async function ComparisonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const perms = await requirePermission('comparison', 'view')
  const canWrite = can(perms, 'comparison', 'edit')
  const supabase = await createClient()

  const { data: cmp } = await supabase
    .from('cmp_comparisons')
    .select(`*, project:projects(code, name)`)
    .eq('id', id)
    .single()
  if (!cmp) notFound()

  const [vendorsRes, itemsRes, quotesRes] = await Promise.all([
    supabase.from('cmp_vendors').select('*').eq('comparison_id', id).order('sequence'),
    supabase.from('cmp_items').select('*').eq('comparison_id', id).order('sequence'),
    supabase.from('cmp_quotes').select('*').eq('comparison_id', id),
  ])

  const project = Array.isArray(cmp.project) ? cmp.project[0] : cmp.project

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader title={cmp.title} back="/comparisons">
        <Badge className={`${STATUS_TONES[cmp.status] ?? STATUS_TONES.draft} text-xs`}>{cmp.status}</Badge>
      </PageHeader>

      {(project || cmp.scope) && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-1.5">
            {project && (
              <p className="text-sm text-gray-700 flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-gray-400" />
                <span className="font-mono text-xs">{project.code}</span> · {project.name}
              </p>
            )}
            {cmp.scope && (
              <p className="text-sm text-gray-700 whitespace-pre-line">{cmp.scope}</p>
            )}
          </CardContent>
        </Card>
      )}

      <ComparisonGrid
        comparisonId={id}
        canWrite={canWrite}
        initialVendors={vendorsRes.data ?? []}
        initialItems={itemsRes.data ?? []}
        initialQuotes={quotesRes.data ?? []}
      />
    </div>
  )
}
