import Link from 'next/link'
import { requirePermission, getMyProfile, getMyUser, can } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Plus } from 'lucide-react'
import { SmartChecklist, type ChecklistRow } from './SmartChecklist'
import type { DsrTracking, Project, Vendor } from '@/lib/types'

export const dynamic = 'force-dynamic'

type RelObj<T> = T | T[] | null | undefined
function unwrap<T>(v: RelObj<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

type Raw = {
  id: string
  project_id: string
  supplier_name_text: string | null
  material_description: string
  amount: number | string | null
  bill_number: string
  received_on: string
  checked_against_bill: boolean
  checked_against_bill_on: string | null
  bill_submitted_to_ct: boolean
  bill_submitted_to_ct_on: string | null
  payment_started: boolean
  payment_started_on: string | null
  grn_done: boolean
  grn_done_on: string | null
  paid: boolean
  paid_on: string | null
  projects: RelObj<Project>
  vendors: RelObj<Vendor>
  dsr_tracking: RelObj<DsrTracking>
}

export default async function DailySiteReportPage() {
  const perms = await requirePermission('daily-site-report', 'view')
  const [profile, user] = await Promise.all([getMyProfile(), getMyUser()])
  const role = profile?.role ?? null
  const isManagement = role === 'admin' || role === 'project_head' || role === 'head' || role === 'founder'
  const canTrack = isManagement && can(perms, 'daily-site-report', 'edit')
  const canAdd = role === 'admin' || role === 'engineer'
  const isHead = role === 'head'

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('dsr_reports')
    .select(
      'id, project_id, supplier_name_text, material_description, amount, bill_number, received_on,' +
      ' checked_against_bill, checked_against_bill_on, bill_submitted_to_ct, bill_submitted_to_ct_on,' +
      ' payment_started, payment_started_on, grn_done, grn_done_on, paid, paid_on,' +
      ' projects ( code, name ), vendors ( name ), dsr_tracking ( head_note, flagged, follow_up_on )',
    )
    .order('received_on', { ascending: false })
    .limit(2000)

  // Atm Head → their projects, read from the same roster the Internal Estimate
  // uses (cc_project_approvers, role 'head'). Used as the default UI scope.
  let myProjectIds: string[] = []
  if (isHead && user) {
    const { data: appr } = await supabase
      .from('cc_project_approvers')
      .select('project_id')
      .eq('user_id', user.id)
      .eq('role', 'head')
    myProjectIds = [...new Set((appr ?? []).map(r => r.project_id as string))]
  }

  const rawRows = (data ?? []) as unknown as Raw[]
  const rows: ChecklistRow[] = rawRows.map(r => {
    const proj = unwrap(r.projects)
    const vend = unwrap(r.vendors)
    const trk = unwrap(r.dsr_tracking)
    return {
      id: r.id,
      projectId: r.project_id,
      project: proj?.code || proj?.name || '—',
      supplier: vend?.name || r.supplier_name_text || '—',
      material: r.material_description,
      amount: r.amount != null ? Number(r.amount) : null,
      billNo: r.bill_number || '',
      received_on: r.received_on,
      checked_against_bill: !!r.checked_against_bill,
      checked_against_bill_on: r.checked_against_bill_on ?? null,
      bill_submitted_to_ct: !!r.bill_submitted_to_ct,
      bill_submitted_to_ct_on: r.bill_submitted_to_ct_on ?? null,
      payment_started: !!r.payment_started,
      payment_started_on: r.payment_started_on ?? null,
      grn_done: !!r.grn_done,
      grn_done_on: r.grn_done_on ?? null,
      paid: !!r.paid,
      paid_on: r.paid_on ?? null,
      headNote: trk?.head_note ?? '',
      flagged: !!trk?.flagged,
      followUpOn: trk?.follow_up_on ?? null,
    }
  })

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Daily Site Report"
        subtitle="Material & supplier deliveries — tracked from received to paid"
      >
        {canAdd && (
          <Link href="/daily-site-report/new">
            <Button><Plus className="mr-1.5 h-4 w-4" /> Add report</Button>
          </Link>
        )}
      </PageHeader>

      {error ? (
        <QueryError message={error.message} what="site reports" />
      ) : (
        <SmartChecklist
          rows={rows}
          today={new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)}
          canTrack={canTrack}
          isHead={isHead}
          myProjectIds={myProjectIds}
        />
      )}
    </div>
  )
}
