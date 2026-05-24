import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { MODULES } from '@/lib/modules'
import DashboardModulesEditor from './DashboardModulesEditor'

export const dynamic = 'force-dynamic'

export default async function DashboardModulesPage() {
  if (!(await isPortalOwner())) redirect('/admin')
  const supabase = await createClient()
  const { data } = await supabase
    .from('module_visibility')
    .select('slug, enabled')

  const overrides = new Map<string, boolean>(
    (data ?? []).map(r => [r.slug as string, r.enabled as boolean]),
  )
  const initial = MODULES.map(m => ({
    slug: m.slug,
    label: m.label,
    description: m.description,
    enabled: overrides.has(m.slug) ? !!overrides.get(m.slug) : true,
  }))

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Dashboard Modules"
        back="/admin"
        subtitle="Turn modules on / off for everyone. You always see them."
      />
      <DashboardModulesEditor initial={initial} />
    </div>
  )
}
