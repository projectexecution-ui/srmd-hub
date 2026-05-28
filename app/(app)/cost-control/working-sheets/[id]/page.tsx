import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser, getMyProfile } from '@/lib/auth'
import { checkCanApproveWS, checkCanSetDeadline } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { WSEditor } from './WSEditor'
import { ExcelSummaryPanel } from './ExcelSummaryPanel'
import { SourceExcelViewer } from './SourceExcelViewer'
import { EditDeadlineButton } from './EditDeadlineButton'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface DRow { code: string; name: string }
interface SRow { code: string; name: string }
interface PRow { code: string; name: string }

export default async function WorkingSheetEditorPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const perms = await requirePermission('cost-control', 'view')
  const canEdit = can(perms, 'cost-control', 'edit')
  const { id } = await params
  const supabase = await createClient()
  const [user, profile] = await Promise.all([getMyUser(), getMyProfile()])
  const isAdmin = profile?.role === 'admin'

  // Ask the DB whether THIS specific viewer is allowed to approve / return
  // THIS specific sheet at THIS amount. Encapsulates the approval_rules
  // matrix + admin override + self-approval block.
  const [mayApprove, mayReturn, canEditDeadline] = await Promise.all([
    checkCanApproveWS(id, 'approved'),
    checkCanApproveWS(id, 'returned'),
    checkCanSetDeadline(),
  ])
  const canApprove = mayApprove || mayReturn

  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('id, ws_code, status, total_amount, approved_for_erp_amt, past_approved_in_subskill, return_reason, engineer_id, project_id, discipline_id, sub_skill_id, line_type, entry_mode, source_excel_url, source_excel_name, summary_total, summary_notes, flag_summary, last_checked_at, deadline_date, deadline_notes, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .eq('id', id)
    .single()

  if (!ws) notFound()

  // Quick mode: short-circuit the line-item editor and render the Excel
  // summary + flag panel instead.
  if (ws.entry_mode === 'excel_summary') {
    const { data: excelRows } = await supabase
      .from('cc_excel_rows')
      .select('id, row_no, description, unit, qty, rate, amount, formula_in_amount, rate_breakdown, amount_breakdown, flag, flag_reason, flag_severity')
      .eq('working_sheet_id', id)
      .order('row_no')

    // Signed URL for downloading the original Excel
    let downloadUrl: string | null = null
    if (ws.source_excel_url) {
      const { data: signed } = await supabase.storage
        .from('cc-sheets')
        .createSignedUrl(ws.source_excel_url, 60 * 60)
      downloadUrl = signed?.signedUrl ?? null
    }

    const proj = (Array.isArray(ws.projects) ? ws.projects[0] : ws.projects) as PRow | null
    const dis  = (Array.isArray(ws.cc_disciplines) ? ws.cc_disciplines[0] : ws.cc_disciplines) as DRow | null
    const sub  = (Array.isArray(ws.cc_sub_skills) ? ws.cc_sub_skills[0] : ws.cc_sub_skills) as SRow | null

    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        <PageHeader
          title={ws.ws_code}
          subtitle={`${proj?.code ?? '—'} · ${dis?.code} ${dis?.name} → ${sub?.code} ${sub?.name} · Quick mode (Excel)`}
          back="/cost-control/working-sheets"
        >
          <WSStatusPill status={ws.status as WSStatus} />
        </PageHeader>

        {(ws.deadline_date || canEditDeadline) && (
          <div className="flex items-center gap-2 flex-wrap">
            {ws.deadline_date && (
              <DeadlineBadge
                deadlineDate={ws.deadline_date}
                notes={ws.deadline_notes}
                approved={ws.status === 'approved' || ws.status === 'wo_issued' || ws.status === 'paid'}
              />
            )}
            {canEditDeadline && (
              <EditDeadlineButton
                wsId={ws.id}
                initialDate={ws.deadline_date}
                initialNotes={ws.deadline_notes}
              />
            )}
          </div>
        )}

        <SourceExcelViewer url={downloadUrl} name={ws.source_excel_name} />

        <ExcelSummaryPanel
          wsId={ws.id}
          status={ws.status as WSStatus}
          canEdit={canEdit && (user?.id === ws.engineer_id || isAdmin)}
          canApprove={mayApprove}
          canReturn={mayReturn}
          totalAmount={Number(ws.total_amount ?? 0)}
          approvedSoFar={Number(ws.approved_for_erp_amt ?? 0)}
          fileName={ws.source_excel_name}
          downloadUrl={downloadUrl}
          summaryTotal={ws.summary_total != null ? Number(ws.summary_total) : null}
          summaryNotes={ws.summary_notes}
          flagSummary={ws.flag_summary as { generated_at: string; total_rows: number; flagged_rows: number; by_flag: Record<string, number>; narrative: string | null; ai_used: boolean; ai_error: string | null } | null}
          lastCheckedAt={ws.last_checked_at}
          rows={(excelRows ?? []).map(r => ({
            id: r.id,
            row_no: r.row_no,
            description: r.description,
            unit: r.unit,
            qty: r.qty != null ? Number(r.qty) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            amount: r.amount != null ? Number(r.amount) : null,
            formula_in_amount: r.formula_in_amount,
            rate_breakdown:   r.rate_breakdown   as Array<{ label: string; value: number }> | null,
            amount_breakdown: r.amount_breakdown as Array<{ label: string; value: number }> | null,
            flag: r.flag,
            flag_reason: r.flag_reason,
            flag_severity: r.flag_severity,
          }))}
        />
      </div>
    )
  }

  const [itemsRes, vendorsRes, blRes, pastItemsRes] = await Promise.all([
    supabase
      .from('cc_working_sheet_items')
      .select('id, sr_no, description, uom, qty, qty_is_auto, rate, gst_pct, total_amount, vendor_id, location_tag, remark, sections:cc_ws_item_qty_sections(id)')
      .eq('working_sheet_id', id)
      .order('sr_no'),
    supabase.from('vendors').select('id, name').order('name'),
    // Best-effort budget headroom lookup
    supabase
      .from('cc_budget_lines')
      .select('current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', ws.project_id)
      .eq('discipline_id', ws.discipline_id)
      .eq('sub_skill_id', ws.sub_skill_id)
      .eq('line_type', ws.line_type)
      .maybeSingle(),
    // Past items in same sub-skill (cross-project) for duplicate detection
    supabase
      .from('cc_working_sheet_items')
      .select(
        'id, description, qty, uom, rate, vendor_id, cc_working_sheets!inner(id, ws_code, status, sub_skill_id, project_id)',
      )
      .eq('cc_working_sheets.sub_skill_id', ws.sub_skill_id)
      .in('cc_working_sheets.status', ['approved', 'wo_issued', 'paid', 'submitted'])
      .neq('working_sheet_id', id)
      .limit(200),
  ])

  const proj = (Array.isArray(ws.projects) ? ws.projects[0] : ws.projects) as PRow | null
  const dis = (Array.isArray(ws.cc_disciplines) ? ws.cc_disciplines[0] : ws.cc_disciplines) as DRow | null
  const sub = (Array.isArray(ws.cc_sub_skills) ? ws.cc_sub_skills[0] : ws.cc_sub_skills) as SRow | null

  const bl = blRes.data ?? null
  const budgeted = Number(bl?.current_budget_amt ?? 0)
  const committed = Number(bl?.current_wo_committed_amt ?? 0)
  const paid = Number(bl?.current_paid_amt ?? 0)
  const remainingBeforeThisWS = budgeted - committed
  const remainingAfter = remainingBeforeThisWS - Number(ws.total_amount ?? 0)

  // Internal Estimate for this sub-skill = LIVE sum of every WS total
  // (except cancelled). HOD reads this to size ERP releases — nobody
  // types it. Live so a new draft instantly shows up.
  const { data: planRows } = await supabase
    .from('cc_working_sheets')
    .select('total_amount, status')
    .eq('project_id', ws.project_id)
    .eq('discipline_id', ws.discipline_id)
    .eq('sub_skill_id', ws.sub_skill_id)
    .eq('line_type', ws.line_type)
  const estimate = (planRows ?? [])
    .filter(r => r.status !== 'cancelled')
    .reduce((s, r) => s + Number(r.total_amount ?? 0), 0)

  const isOwner = user?.id === ws.engineer_id
  const status = ws.status as WSStatus

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title={ws.ws_code}
        subtitle={`${proj?.code ?? '—'} · ${dis?.code} ${dis?.name} → ${sub?.code} ${sub?.name} · ${ws.line_type === 'material' ? 'Material' : 'Work'}`}
        back="/cost-control/working-sheets"
      >
        <WSStatusPill status={status} />
      </PageHeader>

      {(ws.deadline_date || canEditDeadline) && (
        <div className="flex items-center gap-2 flex-wrap">
          {ws.deadline_date && (
            <DeadlineBadge
              deadlineDate={ws.deadline_date}
              notes={ws.deadline_notes}
              approved={status === 'approved' || status === 'wo_issued' || status === 'paid'}
            />
          )}
          {canEditDeadline && (
            <EditDeadlineButton
              wsId={ws.id}
              initialDate={ws.deadline_date}
              initialNotes={ws.deadline_notes}
            />
          )}
        </div>
      )}

      {/* Past-spend strip */}
      <Card className="p-4 bg-blue-50/50 border-blue-100">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-blue-700/70">Internal Estimate</span>
            <p className="font-bold text-indigo-900">{estimate > 0 ? formatINR(estimate) : '—'}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-blue-700/70">Past approved in this sub-skill</span>
            <p className="font-bold text-blue-900">{formatINR(ws.past_approved_in_subskill ?? 0)}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-blue-700/70">Approved Budget (ERP)</span>
            <p className="font-bold text-blue-900">{bl ? formatINR(budgeted) : '—'}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-blue-700/70">Already committed</span>
            <p className="font-bold text-blue-900">{bl ? formatINR(committed) : '—'}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-blue-700/70">Paid</span>
            <p className="font-bold text-blue-900">{bl ? formatINR(paid) : '—'}</p>
          </div>
          <div className="ml-auto">
            <span className="text-xs uppercase tracking-wide text-blue-700/70">This WS</span>
            <p className="font-bold text-blue-900">{formatINR(ws.total_amount ?? 0)}</p>
          </div>
          {bl && (
            <div>
              <span className="text-xs uppercase tracking-wide text-blue-700/70">Remaining after</span>
              <p className={`font-bold ${remainingAfter < 0 ? 'text-red-700' : 'text-green-800'}`}>
                {formatINR(remainingAfter)}
              </p>
            </div>
          )}
        </div>
        {!bl && (
          <p className="text-xs text-blue-700 mt-2">
            No budget line set for this sub-skill yet. Import the ENGG_CONSOLIDATED_BUDGET_REPORT or add a budget line to see headroom checks.
          </p>
        )}
        {estimate > 0 && budgeted > 0 && budgeted < estimate && (
          <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
            <p className="font-semibold mb-0.5">ERP has released {Math.round((budgeted / estimate) * 100)}% of the team plan</p>
            <p className="text-xs">
              Internal Estimate (sum of all WS in this sub-skill) is {formatINR(estimate)}; ERP Budget so far is {formatINR(budgeted)}.
              HOD reads this gap to decide on the next release.
            </p>
          </div>
        )}
        {status === 'returned' && ws.return_reason && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">Returned for revision</p>
            <p>{ws.return_reason}</p>
          </div>
        )}
      </Card>

      <WSEditor
        wsId={ws.id}
        status={status}
        canEdit={canEdit && (isOwner || isAdmin)}
        canApprove={mayApprove}
        approvedSoFar={Number(ws.approved_for_erp_amt ?? 0)}
        vendors={vendorsRes.data ?? []}
        initialItems={(itemsRes.data ?? []).map(i => ({
          ...i,
          qty_is_auto: !!(i as { qty_is_auto?: boolean }).qty_is_auto,
          section_count: ((i as { sections?: { id: string }[] }).sections ?? []).length,
        }))}
        pastItems={(pastItemsRes.data ?? []).map(p => {
          const pws = (p as unknown as { cc_working_sheets: { id: string; ws_code: string } | { id: string; ws_code: string }[] }).cc_working_sheets
          const wsRef = Array.isArray(pws) ? pws[0] : pws
          return {
            id: p.id,
            description: p.description,
            qty: Number(p.qty),
            uom: p.uom,
            rate: Number(p.rate),
            vendor_id: p.vendor_id,
            ws_id: wsRef?.id ?? '',
            ws_code: wsRef?.ws_code ?? '',
          }
        })}
        wsTotal={ws.total_amount ?? 0}
      />
    </div>
  )
}
