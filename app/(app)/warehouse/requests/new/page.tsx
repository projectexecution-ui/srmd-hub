import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
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
        subtitle="Pick the store, say what you need and why. It goes to that store’s keeper — and you are told up front whether it will wait for approval."
      />
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
