import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { RequestForm } from './request-form'

export const dynamic = 'force-dynamic'

export default async function NewRequestPage() {
  await requirePermission('inventory', 'edit', '/inventory')
  await requireInventorySection('inv-request-new')
  const user = await getMyUser()
  const supabase = await createClient()

  // Engineer's projects (from inv_engineer_projects). Fall back to all
  // projects if no assignment exists yet — keeps the form usable before
  // the engineer-project mapping is set up.
  const [assignedRes, projectsRes, whRes, itemsRes] = await Promise.all([
    supabase.from('inv_engineer_projects').select('project_id, projects(id, code, name)').eq('engineer_id', user?.id ?? ''),
    supabase.from('projects').select('id, code, name').order('code'),
    supabase.from('inv_warehouses').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('inv_items').select('id, code, name, unit, category, image_url').eq('is_active', true).order('code'),
  ])

  const assigned = (assignedRes.data ?? [])
    .map(r => Array.isArray(r.projects) ? r.projects[0] : r.projects)
    .filter(Boolean) as Array<{ id: string; code: string; name: string }>
  const projects = assigned.length > 0 ? assigned : (projectsRes.data ?? [])

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader title="Raise request" back="/inventory" subtitle="Engineer raises a material request for site work" />
      <Card className="p-5">
        <RequestForm
          projects={projects}
          warehouses={whRes.data ?? []}
          items={itemsRes.data ?? []}
        />
      </Card>
    </div>
  )
}
