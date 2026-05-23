import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SetupProgressBanner } from '@/components/ProjectSetupWizard/SetupProgressBanner'

export const dynamic = 'force-dynamic'

export default async function CostControlProjectDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requirePermission('cost-control', 'view')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, code, name, description, cc_status, setup_progress_pct, built_up_sft, parent_project_id, pm_user_id, start_date, target_completion')
    .eq('id', id)
    .single()

  if (!project) notFound()

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title={project.name}
        subtitle={`${project.code}${project.built_up_sft ? ` · ${project.built_up_sft.toLocaleString('en-IN')} Sft` : ''}`}
        back="/cost-control"
      >
        {project.cc_status && (
          <Badge variant={project.cc_status === 'active' ? 'success' : 'secondary'}>
            {project.cc_status.replace('_', ' ')}
          </Badge>
        )}
      </PageHeader>

      {project.cc_status && (
        <SetupProgressBanner
          projectId={project.id}
          progressPct={project.setup_progress_pct ?? 0}
        />
      )}

      <Card className="p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Disciplines</h2>
        <p className="text-sm text-gray-500">
          Working Sheets, budget tracking, and approvals UI come in the next phase. See{' '}
          <code>docs/cost-control-roadmap.md</code>.
        </p>
      </Card>
    </div>
  )
}
