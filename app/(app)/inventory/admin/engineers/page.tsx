import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { EngineerProjectsEditor } from './EngineerProjectsEditor'

export const dynamic = 'force-dynamic'

export default async function EngineerProjectsPage() {
  await requirePermission('inventory', 'admin')
  const supabase = await createClient()

  const [engRes, projRes, mapRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true).eq('role', 'engineer').order('full_name'),
    supabase.from('projects').select('id, code, name').is('archived_at', null).order('code'),
    supabase.from('inv_engineer_projects').select('engineer_id, project_id, is_primary'),
  ])

  const err = engRes.error ?? projRes.error ?? mapRes.error

  const engineers = (engRes.data ?? []).map(e => ({ id: e.id as string, name: (e.full_name ?? e.name ?? '(unnamed)') as string }))
  const projects = (projRes.data ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string }))
  const initial: Record<string, string[]> = {}
  const owners: Record<string, string> = {} // project_id → owner engineer_id (is_primary)
  for (const r of mapRes.data ?? []) {
    (initial[r.engineer_id as string] ??= []).push(r.project_id as string)
    if (r.is_primary) owners[r.project_id as string] = r.engineer_id as string
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Engineer projects"
        back="/inventory"
        subtitle="Assign each engineer to their site(s) so they only pick from their own projects when raising a request."
      />
      <Card className="p-4">
        {err
          ? <QueryError what="engineer assignments" message={err.message} />
          : <EngineerProjectsEditor engineers={engineers} projects={projects} initial={initial} owners={owners} />}
      </Card>
    </div>
  )
}
