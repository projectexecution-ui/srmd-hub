import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { ALL_ROLES } from '@/lib/types'
import { getRoleLabels } from '@/lib/role-labels'
import ApprovalsMatrix from './approvals-matrix'

export const dynamic = 'force-dynamic'

// Friendly headings per module. Anything not listed falls back to the slug.
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
  if (!profile.is_portal_owner && profile.role !== 'admin') redirect('/admin')

  const supabase = await createClient()
  const [{ data: rules }, roleLabels] = await Promise.all([
    supabase
      .from('approval_rules')
      .select('id, module_slug, doc_type, from_stage, to_stage, approver_role, override_role, amount_cap_max, requires_remarks, requires_attachment, is_active')
      .order('module_slug')
      .order('from_stage')
      .order('to_stage'),
    getRoleLabels(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Approvals"
        back="/admin"
        subtitle="Who can move a document to the next stage, per module."
      />
      <Card className="p-4 bg-blue-50 border-blue-200 text-sm text-blue-900">
        Read each row as a sentence: <b>at this stage</b>, a user with <b>this role</b> can move the document to <b>this next stage</b>. Admin is always allowed. Override role is optional.
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
