import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Calculator, Plus, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

type CCProject = {
  id: string
  code: string
  name: string
  cc_status: string | null
  setup_progress_pct: number | null
  built_up_sft: number | null
  parent_project_id: string | null
}

export default async function CostControlLandingPage() {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const supabase = await createClient()

  // Only Cost Control projects — the hub has ~18 unrelated indent/PO projects in the same table.
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, code, name, cc_status, setup_progress_pct, built_up_sft, parent_project_id')
    .not('cc_status', 'is', null)
    .order('code')

  const ccProjects = (projects ?? []) as CCProject[]
  const incompleteCount = ccProjects.filter(p => (p.setup_progress_pct ?? 0) < 100).length

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Cost Control"
        subtitle={`SRASSK — ${ccProjects.length} project${ccProjects.length === 1 ? '' : 's'}${incompleteCount ? ` · ${incompleteCount} need setup` : ''}`}
      >
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/cost-control/projects/new"><Plus className="h-4 w-4" /> New Project</Link>
          </Button>
        )}
      </PageHeader>

      {error && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Cost Control tables not yet applied to the database.</p>
              <p className="mt-1">Run the migration at <code>supabase/migrations/20260523_cost_control_foundation.sql</code> followed by the seed. Until then, this page shows what exists in <code>public.projects</code> without the new columns.</p>
            </div>
          </div>
        </Card>
      )}

      {ccProjects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ccProjects.map(p => {
            const pct = p.setup_progress_pct ?? 0
            const isIncomplete = pct < 100
            return (
              <Link key={p.id} href={`/cost-control/projects/${p.id}`}>
                <Card className="hover:shadow-md transition-shadow h-full">
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-indigo-700">{p.code}</span>
                      {p.cc_status && (
                        <Badge variant={p.cc_status === 'active' ? 'success' : 'secondary'}>
                          {p.cc_status.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900">{p.name}</h3>
                    {p.built_up_sft != null && (
                      <p className="text-xs text-gray-500 mt-1">
                        {p.built_up_sft.toLocaleString('en-IN')} Sft built-up
                      </p>
                    )}
                    {isIncomplete && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-amber-700 mb-1">
                          <span>Setup {pct}% complete</span>
                          <span>{100 - pct}% remaining</span>
                        </div>
                        <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Calculator className="h-10 w-10" />}
            title="No Cost Control projects yet"
            description="Start a new project to track Working Sheets, budgets, and approvals."
            action={canWrite ? <Button asChild size="sm"><Link href="/cost-control/projects/new">Create first project</Link></Button> : null}
          />
        </Card>
      )}
    </div>
  )
}
