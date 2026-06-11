import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { formatINR } from '@/lib/utils'
import { Inbox, ArrowRight, ClipboardList, Ruler } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PRow { code: string; name: string }
interface DRow { code: string; name: string }
interface SRow { code: string; name: string }

interface WSRow {
  id: string
  ws_code: string
  status: string
  total_amount: number
  approved_for_erp_amt: number | null
  submitted_at: string | null
  engineer_id: string
  discipline_id: string
  project_id: string
  projects: PRow | PRow[] | null
  cc_disciplines: DRow | DRow[] | null
  cc_sub_skills: SRow | SRow[] | null
}

function pickFirst<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export default async function ApprovalsInboxPage() {
  await requirePermission('cost-control', 'view')
  const user = await getMyUser()
  const supabase = await createClient()

  // Disciplines the current user heads
  const { data: myDisciplines, error: discErr } = await supabase
    .from('cc_discipline_approvers')
    .select('discipline_id')
    .eq('approver_user_id', user?.id ?? '')
    .eq('is_active', true)
  const myDisciplineIds = (myDisciplines ?? []).map(d => d.discipline_id)

  // partially_approved sheets stay in the inbox — they still need the
  // remaining releases approved before they're done.
  const { data: pendingWS, error: wsErr } = await supabase
    .from('cc_working_sheets')
    .select(
      `id, ws_code, status, total_amount, approved_for_erp_amt, submitted_at, engineer_id, discipline_id, project_id,
       projects(code, name),
       cc_disciplines(code, name),
       cc_sub_skills(code, name)`,
    )
    .in('status', ['submitted', 'partially_approved'])
    .order('submitted_at', { ascending: true })

  const queryErr = wsErr ?? discErr
  if (queryErr) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        <PageHeader
          title="Approvals"
          subtitle="Working sheets waiting for a decision"
          back="/cost-control"
        />
        <QueryError message={queryErr.message} what="the approvals inbox" />
      </div>
    )
  }

  const rows = (pendingWS ?? []) as unknown as WSRow[]

  const mine = rows.filter(r => myDisciplineIds.includes(r.discipline_id))
  const others = rows.filter(r => !myDisciplineIds.includes(r.discipline_id))

  // Total pending value (across all) — for partially approved sheets only
  // the unreleased remainder is still pending.
  const totalPendingValue = rows.reduce(
    (a, r) => a + Math.max(Number(r.total_amount ?? 0) - Number(r.approved_for_erp_amt ?? 0), 0),
    0,
  )

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Approvals"
        subtitle={`${rows.length} working sheet${rows.length === 1 ? '' : 's'} pending · ${formatINR(totalPendingValue)} pending value`}
        back="/cost-control"
      />

      {/* Quick-link to bulk approval for thumbrule rows — saves PMs the
          one-at-a-time click when a project has many quick estimates. */}
      <Link
        href="/cost-control/approvals/thumbrule"
        className="block rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 hover:bg-amber-50/80 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2">
            <Ruler className="h-4 w-4 text-amber-700" />
            <span className="text-sm font-semibold text-amber-900">Bulk approve Thumbrule sheets</span>
            <span className="text-xs text-amber-700">— review rate × area on one page, approve in one click</span>
          </div>
          <ArrowRight className="h-4 w-4 text-amber-700" />
        </div>
      </Link>

      {mine.length > 0 && (
        <ApprovalSection
          title="For your review"
          subtitle="WS in disciplines you head"
          rows={mine}
          highlight
        />
      )}

      <ApprovalSection
        title={mine.length > 0 ? 'Other pending' : 'All pending'}
        subtitle={
          mine.length > 0
            ? "Other heads' queues — you can still open and view"
            : 'Click into any WS to approve or return'
        }
        rows={others}
      />

      {rows.length === 0 && (
        <Card className="p-10 text-center text-gray-500 text-sm">
          <Inbox className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <div>Nothing pending. Engineers submit working sheets to land them here.</div>
          <Link
            href="/cost-control/working-sheets"
            className="inline-block mt-2 text-blue-700 hover:underline text-sm"
          >
            Browse all working sheets →
          </Link>
        </Card>
      )}
    </div>
  )
}

function ApprovalSection({
  title,
  subtitle,
  rows,
  highlight = false,
}: {
  title: string
  subtitle: string
  rows: WSRow[]
  highlight?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <Card className={`p-0 overflow-hidden ${highlight ? 'border-amber-200' : ''}`}>
      <div className={`px-4 py-3 border-b ${highlight ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Code</th>
              <th className="text-left px-3 py-2 font-medium">Project</th>
              <th className="text-left px-3 py-2 font-medium">Discipline · Sub-skill</th>
              <th className="text-right px-3 py-2 font-medium">Amount</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(ws => {
              const proj = pickFirst(ws.projects)
              const disc = pickFirst(ws.cc_disciplines)
              const sub = pickFirst(ws.cc_sub_skills)
              const est = Number(ws.total_amount ?? 0)
              const released = Number(ws.approved_for_erp_amt ?? 0)
              const partial = ws.status === 'partially_approved' && released > 0
              return (
                <tr key={ws.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
                    <Link
                      href={`/cost-control/working-sheets/${ws.id}`}
                      className="hover:text-blue-700"
                    >
                      {ws.ws_code}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">
                    {proj?.name ?? '—'}{' '}
                    <span className="text-xs font-mono text-gray-500">{proj?.code}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">
                    <span className="text-xs text-gray-500 font-mono">{disc?.code}</span> {disc?.name} ·{' '}
                    {sub?.name}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                    {formatINR(ws.total_amount)}
                    {partial && (
                      <div className="text-[11px] font-normal text-amber-700 whitespace-nowrap mt-0.5">
                        {formatINR(released)} of {formatINR(est)} released — {formatINR(Math.max(est - released, 0))} remaining
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <WSStatusPill status={ws.status as WSStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href={`/cost-control/working-sheets/${ws.id}`}
                      className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 text-sm font-medium"
                    >
                      Review <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="px-5 py-8 text-center text-gray-500 text-sm">
          <ClipboardList className="h-6 w-6 mx-auto text-gray-300 mb-1" />
          Nothing in this queue.
        </div>
      )}
    </Card>
  )
}
