import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { ProjectStoresEditor, type ProjSetup } from './ProjectStoresEditor'

export const dynamic = 'force-dynamic'

export default async function ProjectStoresPage() {
  await requirePermission('inventory', 'admin')
  const supabase = await createClient()

  const [projRes, whRes, headRes, setupRes] = await Promise.all([
    supabase.from('projects').select('id, code, name').is('archived_at', null).order('code'),
    supabase.from('inv_warehouses').select('id, code, name, store_manager_id').eq('is_active', true).order('code'),
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true).eq('role', 'head').order('full_name'),
    supabase.from('inv_project_setup').select('project_id, primary_warehouse_id, hop_id'),
  ])

  const err = projRes.error ?? whRes.error ?? headRes.error ?? setupRes.error
  if (err) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <PageHeader title="Project stores" back="/inventory" />
        <Card className="p-5">
          <QueryError what="project stores" message={err.message} />
        </Card>
      </div>
    )
  }

  const projects = (projRes.data ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string }))
  const warehouses = (whRes.data ?? []).map(w => ({
    id: w.id as string, code: w.code as string, name: w.name as string,
    hasKeeper: !!(w as { store_manager_id?: string | null }).store_manager_id,
  }))
  const heads = (headRes.data ?? []).map(h => ({
    id: h.id as string,
    name: (h.full_name ?? h.name ?? '(unnamed)') as string,
  }))

  const initial: Record<string, ProjSetup> = {}
  for (const s of setupRes.data ?? []) {
    initial[s.project_id as string] = {
      warehouse_id: s.primary_warehouse_id as string,
      head_id: s.hop_id as string,
    }
  }

  const noHeads = heads.length === 0
  const noWarehouses = warehouses.length === 0

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Project stores"
        back="/inventory"
        subtitle="Set each project's site store and its Atm Head — once. Then an engineer's request goes straight to that store, and its approval to that Atm Head. No dropdown hunting for anyone."
      />

      {(noHeads || noWarehouses) && (
        <Card className="p-4 border-amber-300 bg-amber-50 text-sm text-amber-900 space-y-1">
          {noWarehouses && <p>Add at least one <Link href="/inventory/admin/warehouses" className="font-semibold underline">warehouse</Link> first.</p>}
          {noHeads && <p>No <b>Atm Heads</b> yet — set some users to the <b>Atm Head</b> role in <Link href="/admin/users" className="font-semibold underline">Users &amp; Roles</Link>, then come back.</p>}
        </Card>
      )}

      <Card className="p-3 text-xs text-gray-600 bg-gray-50/60">
        Tip: each store&apos;s <b>keeper</b> (who receives &amp; issues) is set per warehouse on the{' '}
        <Link href="/inventory/admin/warehouses" className="text-blue-600 hover:underline font-medium">Warehouses</Link> page.
        A project with no store set here still works — the engineer just picks the warehouse manually.
      </Card>

      <Card className="p-0 overflow-hidden">
        <ProjectStoresEditor
          projects={projects}
          warehouses={warehouses}
          heads={heads}
          initial={initial}
        />
      </Card>
    </div>
  )
}
