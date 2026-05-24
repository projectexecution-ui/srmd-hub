import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { ALL_ROLES } from '@/lib/types'
import { getRoleLabels } from '@/lib/role-labels'
import ApprovalsMatrix from './approvals-matrix'

export const dynamic = 'force-dynamic'

// Module → friendly label (just for grouping in the UI). Modules not in
// this map still appear under their slug.
const MODULE_LABELS: Record<string, string> = {
  'indents':      'Indents',
  'jmr':          'JMR — Daily entries',
  'jmr-bills':    'JMR — Contractor bills',
  'inventory':    'Inventory — Material requests',
  'cost-control': 'Cost Control — Working sheets',
}

export default async function AdminApprovalsPage() {
  const profile = await getMyProfile()
  if (!profile) redirect('/login')
  // Portal Owner OR Admin
  if (!profile.is_portal_owner && profile.role !== 'admin') redirect('/admin')

  const supabase = await createClient()
  const [{ data: rules }, roleLabels] = await Promise.all([
    supabase
      .from('approval_rules')
      .select('*')
      .order('module_slug')
      .order('doc_type')
      .order('from_stage')
      .order('to_stage'),
    getRoleLabels(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Approvals"
        back="/admin"
        subtitle="Who can move a document from one stage to the next, per module. Admin can always act."
      />
      <Card className="p-4 bg-blue-50 border-blue-200 text-sm text-blue-900">
        <p>
          Each row says: <b>at this stage</b>, a user with <b>this role</b> can move the document to <b>this next stage</b>.
          The <b>override role</b> (optional) can also act — useful for emergency bypass.
          The <b>amount cap</b> (optional, for money docs) limits the rule to docs at or below that ₹ amount.
        </p>
      </Card>
      <ApprovalsMatrix
        initial={rules ?? []}
        roles={ALL_ROLES as unknown as string[]}
        roleLabels={roleLabels}
        moduleLabels={MODULE_LABELS}
      />
    </div>
  )
}
