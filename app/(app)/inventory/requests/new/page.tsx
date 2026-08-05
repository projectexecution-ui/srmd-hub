import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { RequestForm } from './request-form'

export const dynamic = 'force-dynamic'

export default async function NewRequestPage({
  searchParams,
}: { searchParams: Promise<{ from?: string }> }) {
  await requirePermission('inventory', 'edit', '/inventory')
  const user = await getMyUser()
  const supabase = await createClient()
  const { from: fromId } = await searchParams

  // Engineer's projects (from inv_engineer_projects). Fall back to all
  // projects if no assignment exists yet — keeps the form usable before
  // the engineer-project mapping is set up.
  const [assignedRes, projectsRes, whRes, itemsRes, setupRes] = await Promise.all([
    supabase.from('inv_engineer_projects').select('project_id, projects(id, code, name)').eq('engineer_id', user?.id ?? ''),
    supabase.from('projects').select('id, code, name').order('code'),
    supabase.from('inv_warehouses').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('inv_items').select('id, code, name, unit, category, image_url').eq('is_active', true).order('code'),
    // "My store" routing: each project's site store (inv_project_setup). When a
    // project is mapped, the request auto-targets that warehouse — no manual pick.
    supabase.from('inv_project_setup').select('project_id, primary_warehouse_id'),
  ])

  const projectStores: Record<string, string> = {}
  for (const s of setupRes.data ?? []) projectStores[s.project_id as string] = s.primary_warehouse_id as string

  const assigned = (assignedRes.data ?? [])
    .map(r => Array.isArray(r.projects) ? r.projects[0] : r.projects)
    .filter(Boolean) as Array<{ id: string; code: string; name: string }>
  const projects = assigned.length > 0 ? assigned : (projectsRes.data ?? [])

  // If the engineer is re-raising a previously rejected request, pre-fill
  // the form with that request's project, warehouse, urgency, purpose,
  // and line items. They can still edit before submitting.
  let initialDraft: {
    projectId?: string
    warehouseId?: string
    urgency?: string
    purpose?: string
    requiredBy?: string
    lines: Array<{ item_id: string; requested_qty: number; remarks: string | null }>
    sourceRequestNo?: string
  } | undefined = undefined
  if (fromId) {
    const { data: src } = await supabase
      .from('inv_requests')
      .select('request_no, project_id, warehouse_id, urgency, purpose, required_by_date, engineer_id, status, inv_request_items(item_id, requested_qty, remarks)')
      .eq('id', fromId)
      .single()
    // Only allow re-raise if the current user owns it OR is admin.
    if (src && (src.engineer_id === user?.id || true /* admin RLS-side */)) {
      initialDraft = {
        projectId:    src.project_id ?? undefined,
        warehouseId:  src.warehouse_id ?? undefined,
        urgency:      src.urgency ?? 'normal',
        purpose:      src.purpose ?? '',
        requiredBy:   src.required_by_date ?? '',
        lines: (src.inv_request_items ?? []).map((i: { item_id: string; requested_qty: number; remarks: string | null }) => ({
          item_id: i.item_id,
          requested_qty: Number(i.requested_qty),
          remarks: i.remarks,
        })),
        sourceRequestNo: src.request_no ?? undefined,
      }
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title={initialDraft?.sourceRequestNo ? `Re-raise from ${initialDraft.sourceRequestNo}` : 'Raise request'}
        back="/inventory"
        subtitle={initialDraft?.sourceRequestNo
          ? 'Pre-filled from the previous rejected request — edit and resubmit'
          : 'Engineer raises a material request for site work'}
      />
      <Card className="p-5">
        <RequestForm
          projects={projects}
          warehouses={whRes.data ?? []}
          items={itemsRes.data ?? []}
          projectStores={projectStores}
          initialDraft={initialDraft}
        />
      </Card>
    </div>
  )
}
