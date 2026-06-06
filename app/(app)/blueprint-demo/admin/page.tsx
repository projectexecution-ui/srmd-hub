// Demo-scoped admin preview — Smart Blueprint rule editor.
// Demonstrates the auto-derived SLA suggestion + one-click "Adopt P90"
// + cross-rule propagation, all SCOPED to module_slug='blueprint-demo'
// so it can't affect production rules.

import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { AdminMatrixClient } from './admin-client'

export const dynamic = 'force-dynamic'

export default async function BlueprintDemoAdminPage() {
  await requirePermission('blueprint-demo', 'view')
  const profile = await getMyProfile()
  if (!profile || profile.role !== 'admin') {
    redirect('/blueprint-demo')
  }

  const supabase = await createClient()

  // 1. The configured rules for this module
  const { data: rules } = await supabase
    .from('approval_rules')
    .select('id, module_slug, doc_type, from_stage, to_stage, approver_role, override_role, sla_hours, escalate_to_role, requires_remarks, is_active, notes')
    .eq('module_slug', 'blueprint-demo')
    .order('from_stage')
    .order('to_stage')

  // 2. Observed stats per rule (median, P90, sample count) — joined client-side
  const { data: stats } = await supabase
    .from('approval_rule_stats')
    .select('module_slug, doc_type, from_stage, to_stage, approver_role, sample_count, median_hours, p90_hours')
    .eq('module_slug', 'blueprint-demo')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Blueprint Demo — Smart Admin"
        back="/blueprint-demo"
        subtitle="Where the system suggests SLAs and escalations from observed behaviour. Admin clicks Apply, no manual typing across modules."
      />

      <Card className="p-3 bg-purple-50 border-purple-200 text-sm text-purple-900">
        <b>Scope:</b> only rules where <code className="text-[11px] bg-purple-100 px-1 rounded">module_slug = &apos;blueprint-demo&apos;</code> are editable here.
        Production module rules at <code className="text-[11px] bg-purple-100 px-1 rounded">/admin/approvals</code> are untouched.
      </Card>

      <AdminMatrixClient
        rules={rules ?? []}
        stats={stats ?? []}
      />
    </div>
  )
}
