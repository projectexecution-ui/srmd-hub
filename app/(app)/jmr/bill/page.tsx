import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { getJmrSettings } from '@/lib/jmr/settings'
import { BillForm } from './bill-form'

export const dynamic = 'force-dynamic'

export default async function NewBillPage() {
  await requirePermission('jmr-bills', 'edit')
  const settings = await getJmrSettings()
  const supabase = await createClient()
  const [projectsRes, contractorsRes, itemsRes] = await Promise.all([
    supabase.from('projects').select('id, name, code').is('parent_project_id', null).order('name'),
    supabase.from('jmr_contractors').select('id, name').eq('status', 'active').order('name'),
    supabase.from('jmr_items').select('id, name, category, unit').eq('is_active', true).order('name'),
  ])
  return (
    <div className="p-3 md:p-6 max-w-md mx-auto">
      <PageHeader title="Log contractor bill" subtitle="Snap photo + enter billed qty" back="/jmr" />
      <BillForm
        projects={projectsRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        items={itemsRes.data ?? []}
        gstRate={settings.gst_rate_pct}
        varTolPct={settings.variance_tolerance_pct}
        varTolMinHours={settings.variance_tolerance_min_hours}
      />
    </div>
  )
}
