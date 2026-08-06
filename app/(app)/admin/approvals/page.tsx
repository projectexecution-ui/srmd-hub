import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { ALL_ROLES } from '@/lib/types'
import { getRoleLabels } from '@/lib/role-labels'
import { getModuleLabels, DEFAULT_MODULE_LABELS } from '@/lib/module-labels'
import ApprovalsMatrix from './approvals-matrix'

export const dynamic = 'force-dynamic'

// Friendly headings per module. Anything not listed falls back to the slug.
// A rename from /admin/dashboard-modules overrides these (see below).
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
  const [{ data: rules }, roleLabels, moduleLabels] = await Promise.all([
    supabase
      .from('approval_rules')
      .select('id, module_slug, doc_type, from_stage, to_stage, approver_role, override_role, amount_cap_max, requires_remarks, requires_attachment, is_active')
      .order('module_slug')
      .order('from_stage')
      .order('to_stage'),
    getRoleLabels(),
    getModuleLabels(),
  ])

  // A rename done in /admin/dashboard-modules wins; otherwise use the curated
  // heading above, otherwise the registry default. One source of truth.
  const effectiveModuleLabels: Record<string, string> = {}
  for (const slug of Object.keys(DEFAULT_MODULE_LABELS)) {
    const custom = moduleLabels[slug]?.label
    const renamed = custom && custom !== DEFAULT_MODULE_LABELS[slug]?.label
    effectiveModuleLabels[slug] = renamed
      ? custom
      : (MODULE_LABELS[slug] ?? DEFAULT_MODULE_LABELS[slug]?.label ?? slug)
  }
  // Keep any curated sub-slug labels not in the registry (e.g. jmr-bills).
  for (const [slug, lbl] of Object.entries(MODULE_LABELS)) {
    if (!(slug in effectiveModuleLabels)) effectiveModuleLabels[slug] = lbl
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Approvals"
        back="/admin"
        subtitle="Who can move a document to the next stage, per module."
      />
      <Card className="p-4 bg-blue-50 border-blue-200 text-sm text-blue-900 space-y-1">
        <p>
          Each module below shows its <b>approval chain</b> — <b>who signs off, in order</b>, before a document is finally approved.
        </p>
        <p className="text-blue-800">
          <b>You (Admin) can approve anything</b>, so nothing ever gets stuck. To change who signs where — add a signer, set a ₹ limit,
          or turn a step off — open <b>“Edit / see all steps”</b> on any module.
        </p>
      </Card>
      <ApprovalsMatrix
        initial={rules ?? []}
        roles={ALL_ROLES as unknown as string[]}
        roleLabels={roleLabels}
        moduleLabels={effectiveModuleLabels}
      />
    </div>
  )
}
