import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { getCcSettings } from '@/lib/cost-control/settings'
import { getEffectiveCcRole } from './billing-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { MarkEnteredButton } from './MarkEnteredButton'
import { ErpReductionQueue } from './ErpReductionQueue'
import { TransferQueue } from './TransferQueue'
import { formatINR, formatDate } from '@/lib/utils'
import { Landmark, Info } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface QueueRow {
  id: string
  ws_code: string
  status: string
  total_amount: number | null
  approved_for_erp_amt: number | null
  approved_for_erp_at: string | null
  projects: { code: string; name: string } | Array<{ code: string; name: string }> | null
  cc_disciplines: { code: string; name: string } | Array<{ code: string; name: string }> | null
  cc_sub_skills: { code: string; name: string } | Array<{ code: string; name: string }> | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

export default async function BillingQueuePage() {
  await requirePermission('cost-control', 'view')
  const settings = await getCcSettings()
  if (!settings.billing_step) redirect('/cost-control')

  const [profile, effRole] = await Promise.all([getMyProfile(), getEffectiveCcRole()])
  const isAdmin = profile?.role === 'admin'
  // IN4 entry is done by the Billing role OR the Coordinator (SRASSK's IN4
  // person). Both are pure tracking — no money moves here. Everyone else is
  // sent back to the Cost Control home.
  if (!isAdmin && effRole !== 'billing' && effRole !== 'coordinator') redirect('/cost-control')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cc_working_sheets')
    .select('id, ws_code, status, total_amount, approved_for_erp_amt, approved_for_erp_at, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .in('status', ['approved', 'partially_approved'])
    .is('archived_at', null)
    .gt('approved_for_erp_amt', 0)
    .is('in4_entered_at', null)
    .order('approved_for_erp_at', { ascending: true })

  const rows = (data ?? []) as QueueRow[]
  const totalToEnter = rows.reduce((s, r) => s + Number(r.approved_for_erp_amt ?? 0), 0)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Billing — IN4 entry queue"
        subtitle={`${rows.length} released sheet${rows.length === 1 ? '' : 's'} waiting to be keyed into IN4 · ${formatINR(totalToEnter)}`}
        back="/cost-control"
      />

      <div className="rounded-md border-l-4 border-teal-500 bg-teal-50 px-4 py-3 text-sm text-teal-900 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <p>
          These sheets were approved by the Trustee. Enter each amount in the IN4 ERP, then click
          <b> Entered in IN4</b>. This is tracking only — no money moves here; Budget (ERP) still comes
          only from your Budget vs Actual (BPH) pull.
        </p>
      </div>

      {error ? (
        <QueryError message={error.message} what="the billing queue" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Landmark className="h-8 w-8" />}
          title="Nothing waiting"
          description="Every released sheet has been marked as entered in IN4."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">WS Code</th>
                  <th className="px-4 py-2 font-semibold">Project</th>
                  <th className="px-4 py-2 font-semibold">Discipline · Sub-skill</th>
                  <th className="px-4 py-2 font-semibold text-right">{settings.label_approved}</th>
                  <th className="px-4 py-2 font-semibold">Released on</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const proj = one(r.projects)
                  const dis = one(r.cc_disciplines)
                  const sub = one(r.cc_sub_skills)
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/cost-control/working-sheets/${r.id}`} className="font-semibold text-blue-700 hover:underline">
                          {r.ws_code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{proj?.code ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-700 truncate max-w-[240px]">
                        {dis?.code} · {sub?.name}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-800">
                        {formatINR(Number(r.approved_for_erp_amt ?? 0))}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {r.approved_for_erp_at ? formatDate(r.approved_for_erp_at) : '—'}
                      </td>
                      <td className="px-4 py-2.5"><WSStatusPill status={r.status as WSStatus} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <MarkEnteredButton wsId={r.id} wsCode={r.ws_code} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Second job for the same person: when management closes a finished
          sub-category, whatever budget was left over is still sitting in IN4
          and has to be taken out by hand. */}
      <ErpReductionQueue />

      {/* Third job for the same person: budget approved to move between two work
          categories, which only IN4 can actually do. */}
      <TransferQueue />
    </div>
  )
}
