import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { Card } from '@/components/ui/card'
import { getLocationTree, getItems, getSettings } from '@/lib/warehouse/data'
import { isOn } from '@/lib/warehouse/settings'
import { getApprovalRules } from '@/lib/warehouse/request-data'
import { getRoleLabels } from '@/lib/role-labels'
import { todayIST } from '@/lib/warehouse/ledger'
import { createClient } from '@/lib/supabase/server'
import { NewRequestForm } from './new-request-form'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function NewRequestPage() {
  await requirePermission('warehouse', 'edit')
  const values = await getSettings()
  if (!isOn(values, 'wh_requests_on')) redirect('/warehouse/requests')

  const sb = await createClient()
  const [sites, items, projectsRes, { rules }, roleLabels] = await Promise.all([
    getLocationTree(),
    getItems(),
    sb.from('projects').select('id, name').order('name'),
    getApprovalRules(),
    getRoleLabels(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/warehouse/requests" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Requests
      </Link>
      <PageHeader
        title="Ask a store for material"
        subtitle="Say what you need and why. Which store it comes from is the keeper’s call, not yours — and you are told up front whether it will wait for approval."
      />

      {/* A project list that failed to load leaves the picker empty, and an empty
          picker is indistinguishable from "no projects exist". Say which it is. */}
      {projectsRes.error && (
        <QueryError message={projectsRes.error.message} what="the project list" />
      )}
      {sites.length === 0 && (
        <Card className="p-4 shadow-sm text-[13px] text-amber-900 bg-amber-50 border-amber-200">
          <b>There are no stores set up yet.</b> You can still raise this, but nothing can be issued
          against it until an admin adds a store in Warehouse ▸ Settings ▸ Stores.
        </Card>
      )}

      <NewRequestForm
        sites={sites}
        items={items}
        projects={projectsRes.data ?? []}
        rules={rules}
        roleLabels={Object.fromEntries(
          Object.entries(roleLabels).map(([k, v]) => [k, v.label]))}
        today={todayIST()}
      />
    </div>
  )
}
