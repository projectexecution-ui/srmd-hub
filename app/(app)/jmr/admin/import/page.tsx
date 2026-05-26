import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { JmrImportClient } from './JmrImportClient'

export const dynamic = 'force-dynamic'

export default async function JmrImportPage() {
  await requirePermission('jmr-admin', 'admin', '/jmr')
  const supabase = await createClient()

  const [projectsRes, contractorsRes, itemsRes, ratesRes] = await Promise.all([
    supabase.from('projects').select('id, code, name, parent_project_id').order('code'),
    supabase.from('jmr_contractors').select('id, name').eq('status', 'active').order('name'),
    supabase.from('jmr_items').select('id, name, category, unit').eq('is_active', true).order('name'),
    supabase.from('jmr_rate_cards').select('id, contractor_id, item_id, project_id, rate_per_unit, valid_from, valid_till'),
  ])

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-blue-50/40 border-blue-200 text-sm text-blue-900">
        <p className="font-semibold mb-1">How it works</p>
        <ol className="text-xs list-decimal pl-5 space-y-0.5">
          <li>Drop your Excel file. We read the first sheet and the header row decides the columns.</li>
          <li>Required headers: <code>date</code>, <code>project</code>, <code>contractor</code>, <code>item</code>, <code>quantity</code>.</li>
          <li>Optional: <code>sub_project</code>, <code>start_time</code>, <code>end_time</code>, <code>rate</code>, <code>work_description</code>.</li>
          <li>For hour items, give either <code>quantity</code> in hours OR <code>start_time</code> + <code>end_time</code> (HH:MM). We&apos;ll work out the hours.</li>
          <li>If <code>rate</code> is blank, we look up the rate card for that contractor + item active on that date.</li>
          <li>Preview shows OK / error per row. Only OK rows are inserted on confirm.</li>
        </ol>
      </Card>
      <JmrImportClient
        projects={projectsRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        items={itemsRes.data ?? []}
        rateCards={ratesRes.data ?? []}
      />
    </div>
  )
}
