import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import StuckBills, { type StuckBillRow, type ChecklistState } from '@/app/(app)/bills-pipeline/stuck-bills'

export const dynamic = 'force-dynamic'

// Staff-facing view of just the pending-with-CT bills + pre-approval checklist.
// Deliberately does NOT render the confidential management cards.
export default async function StuckBillsPage() {
  const perms   = await requirePermission('stuck-bills', 'view')
  const canEdit = can(perms, 'stuck-bills', 'edit')

  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  let stuckBills: StuckBillRow[] = []
  const checklist: Record<string, ChecklistState> = {}

  if (serviceKey) {
    const sb = createServiceClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const { data: row } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'bills_pipeline_stuck')
      .maybeSingle()
    if (row?.value) {
      try { stuckBills = JSON.parse(row.value as string) as StuckBillRow[] } catch { /* ignore */ }
    }

    const { data: checks } = await sb
      .from('bp_bill_checklist')
      .select('bill_id, ms_sheet, abstract_sheet, po_wo, drawing, note')
    for (const c of (checks ?? []) as Array<{ bill_id: string; note: string | null } & ChecklistState>) {
      checklist[c.bill_id] = {
        ms_sheet: !!c.ms_sheet, abstract_sheet: !!c.abstract_sheet,
        po_wo: !!c.po_wo, drawing: !!c.drawing, note: c.note ?? '',
      }
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Bills Checklist"
        subtitle="Contractor bills pending with CT — verify documents before approval"
      />
      <StuckBills bills={stuckBills} initialChecklist={checklist} canEdit={canEdit} />
    </div>
  )
}
