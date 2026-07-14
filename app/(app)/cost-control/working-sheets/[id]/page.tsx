import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser, getMyProfile } from '@/lib/auth'
import { getWSApprovalContext, checkIsCcReviewer, checkCanSetDeadline, checkCanArchiveWs } from '@/components/cost-control/ws-actions'
import { ArchiveControls } from './ArchiveControls'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { AiBifurcationPanel } from '@/components/cost-control/AiBifurcationPanel'
import { WSAskAiPanel } from '@/components/cost-control/WSAskAiPanel'
import { VersionChainBar } from './VersionChainBar'
import { ThumbruleSummaryPanel } from './ThumbruleSummaryPanel'
import { ApprovalTimeline } from '@/components/cost-control/ApprovalTimeline'
import { CommentsPanel } from '@/components/cost-control/CommentsPanel'
import { WSEditor } from './WSEditor'
import { ExcelSummaryPanel } from './ExcelSummaryPanel'
import { SourceExcelViewer } from './SourceExcelViewer'
import { EditDeadlineButton } from './EditDeadlineButton'
import { QueryError } from '@/components/ui/query-error'
import { formatINR } from '@/lib/utils'
import { getCcSettings } from '@/lib/cost-control/settings'

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

  // Ask the DB what THIS viewer may do on THIS sheet (3-stage chain:
  // submit / sign-off / release / return), whether they're Cost Control
  // management (AI tools + big numbers), and deadline rights.
  const [rawCtx, reviewer, canSetDeadlineRaw, ccSettings, canArchive] = await Promise.all([
    getWSApprovalContext(id),
    checkIsCcReviewer(),
    checkCanSetDeadline(),
    getCcSettings(),
    checkCanArchiveWs(),
  ])
  const canEditDeadline = canSetDeadlineRaw && ccSettings.show_deadlines
  const showAi = reviewer && ccSettings.ai_tools

  const { data: ws, error: wsErr } = await supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, status, total_amount, approved_for_erp_amt, past_approved_in_subskill, return_reason, engineer_id, project_id, discipline_id, sub_skill_id, line_type, entry_mode, source_excel_url, source_excel_name, summary_total, summary_notes, flag_summary, ai_parse_meta, last_checked_at, deadline_date, deadline_notes, break_chain, chain_anchor_id, version_no, chain_size, created_at, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .eq('id', id)
    .single()

  // PGRST116 = .single() found no row → a genuine 404. Anything else is a
  // transient query failure and must NOT render the not-found page.
  if (wsErr && wsErr.code !== 'PGRST116') {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <QueryError message={wsErr.message} what="this Working Sheet" />
      </div>
    )
  }
  if (!ws) notFound()

  // Sibling versions in the same chain — drives the prev/next nav.
  const { data: chainSiblings } = await supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, status, version_no, created_at, archived_at, archived_by')
    .eq('chain_anchor_id', ws.chain_anchor_id)
    .order('version_no', { ascending: true })
  type Sibling = { id: string; ws_code: string; status: WSStatus; version_no: number; created_at: string; archived_at: string | null; archived_by: string | null }
  const siblings = (chainSiblings ?? []) as Sibling[]
  const myIdx = siblings.findIndex(s => s.id === ws.id)
  const prevSibling = myIdx > 0 ? siblings[myIdx - 1] : null
  const nextSibling = myIdx >= 0 && myIdx < siblings.length - 1 ? siblings[myIdx + 1] : null

  // Per-stage checked amounts + IN4 tracking + archive state live on the
  // base table (the versions view has a frozen column list on old rows) —
  // one supplementary select.
  const { data: extraCols } = await supabase
    .from('cc_working_sheets')
    .select('ph_checked_amt, atm_checked_amt, in4_entered_at, in4_ref, archived_at, archived_by')
    .eq('id', id)
    .single()

  // Archived sheets are frozen: no submit/sign-off/release/return actions.
  const isArchived = !!extraCols?.archived_at
  const ctx = isArchived
    ? { ...rawCtx, canSubmit: false, nextSignOff: null, canRelease: false, canReturn: false }
    : rawCtx

  // Names for "archived by X" — this sheet + any archived version-mates.
  const archiverIds = Array.from(new Set(
    [extraCols?.archived_by, ...siblings.map(s => s.archived_by)].filter((x): x is string => !!x),
  ))
  const archiverName = new Map<string, string>()
  if (archiverIds.length) {
    const { data: archProfiles } = await supabase
      .from('profiles').select('id, full_name, name').in('id', archiverIds)
    for (const p of archProfiles ?? []) archiverName.set(p.id as string, (p.full_name ?? p.name ?? 'unknown') as string)
  }
  // e.g. "v1 archived by Aksha" — shown on the version bar so the missing
  // serial numbers are accounted for.
  const chainArchivedNotes = siblings
    .filter(s => s.archived_at && s.id !== ws.id)
    .map(s => `v${s.version_no} (${s.ws_code}) archived by ${archiverName.get(s.archived_by ?? '') ?? 'unknown'}`)
  const signOffCfg = {
    phLabel: ccSettings.label_ph_checked,
    atmLabel: ccSettings.label_atm_checked,
    approvedLabel: ccSettings.label_approved,
    phChecked: extraCols?.ph_checked_amt != null ? { amt: Number(extraCols.ph_checked_amt) } : null,
    atmChecked: extraCols?.atm_checked_amt != null ? { amt: Number(extraCols.atm_checked_amt) } : null,
  }

  // Back link is scoped to this WS's project + discipline + sub-skill so the
  // user returns to the same chronological timeline they came from, not the
  // unfiltered cross-project WS list.
  const backHref = (() => {
    const qs = new URLSearchParams()
    if (ws.project_id) qs.set('project', ws.project_id)
    if (ws.discipline_id) qs.set('discipline', ws.discipline_id)
    if (ws.sub_skill_id) qs.set('sub_skill', ws.sub_skill_id)
    const s = qs.toString()
    return s ? `/cost-control/working-sheets?${s}` : '/cost-control/working-sheets'
  })()

  // Thumbrule mode: a single rate × area figure — no line items. Render
  // a read-only summary + the same submit/approve/return actions, NOT the
  // line-item editor (which would wrongly invite "Add row").
  if (ws.entry_mode === 'thumbrule') {
    const proj = (Array.isArray(ws.projects) ? ws.projects[0] : ws.projects) as PRow | null
    const dis  = (Array.isArray(ws.cc_disciplines) ? ws.cc_disciplines[0] : ws.cc_disciplines) as DRow | null
    const sub  = (Array.isArray(ws.cc_sub_skills) ? ws.cc_sub_skills[0] : ws.cc_sub_skills) as SRow | null

    // When a source Excel is attached (e.g. the Internal Budget import),
    // reviewers get the same preview + download as quick-mode sheets — the
    // working behind the figure stays one click away.
    let thumbDownloadUrl: string | null = null
    if (ws.source_excel_url) {
      const { data: signed } = await supabase.storage
        .from('cc-sheets')
        .createSignedUrl(ws.source_excel_url, 60 * 60)
      thumbDownloadUrl = signed?.signedUrl ?? null
    }
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <PageHeader
          title={ws.ws_code}
          subtitle={`${proj?.code ?? '—'} · ${dis?.code} ${dis?.name} → ${sub?.code} ${sub?.name} · Thumbrule estimate`}
          back={backHref}
        >
          <WSStatusPill status={ws.status as WSStatus} />
          {ccSettings.billing_step && extraCols?.in4_entered_at && (
            <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold px-2 py-1 whitespace-nowrap">
              Entered in IN4{extraCols.in4_ref ? ` · ${extraCols.in4_ref}` : ""}
            </span>
          )}
        </PageHeader>

        <VersionChainBar
          wsId={ws.id}
          versionNo={ws.version_no}
          chainSize={ws.chain_size}
          breakChain={ws.break_chain}
          prev={prevSibling ? { id: prevSibling.id, ws_code: prevSibling.ws_code, version_no: prevSibling.version_no } : null}
          next={nextSibling ? { id: nextSibling.id, ws_code: nextSibling.ws_code, version_no: nextSibling.version_no } : null}
          canEdit={canEdit && (user?.id === ws.engineer_id || isAdmin) && !isArchived}
          archivedNotes={chainArchivedNotes}
        />

        <ArchiveControls
          wsId={ws.id}
          wsCode={ws.ws_code}
          archivedAt={extraCols?.archived_at ?? null}
          archivedByName={archiverName.get(extraCols?.archived_by ?? '') ?? null}
          canArchive={canArchive}
          isAdmin={isAdmin}
        />

        {ccSettings.show_deadlines && (ws.deadline_date || canEditDeadline) && (
          <div className="flex items-center gap-2 flex-wrap">
            {ws.deadline_date && (
              <DeadlineBadge
                deadlineDate={ws.deadline_date}
                notes={ws.deadline_notes}
                approved={ws.status === 'approved' || ws.status === 'wo_issued' || ws.status === 'paid'}
              />
            )}
            {canEditDeadline && (
              <EditDeadlineButton wsId={ws.id} initialDate={ws.deadline_date} initialNotes={ws.deadline_notes} />
            )}
          </div>
        )}

        <ThumbruleSummaryPanel
          signOffCfg={signOffCfg}
          wsId={ws.id}
          status={ws.status as WSStatus}
          ctx={ctx}
          totalAmount={Number(ws.total_amount ?? 0)}
          approvedSoFar={Number(ws.approved_for_erp_amt ?? 0)}
          summaryNotes={ws.summary_notes}
          pastApproved={Number(ws.past_approved_in_subskill ?? 0)}
          showPastApproved={reviewer}
        />

        {ws.source_excel_url && (
          <SourceExcelViewer url={thumbDownloadUrl} name={ws.source_excel_name} microsoft={ccSettings.excel_microsoft} />
        )}

        {ccSettings.comments && <CommentsPanel wsId={ws.id} />}

      <ApprovalTimeline wsId={ws.id} />
      </div>
    )
  }

  // Quick mode: short-circuit the line-item editor and render the Excel
  // summary + flag panel instead.
  if (ws.entry_mode === 'excel_summary') {
    const { data: excelRows } = await supabase
      .from('cc_excel_rows')
      .select('id, row_no, description, unit, qty, rate, amount, formula_in_amount, rate_breakdown, amount_breakdown, ai_meta, flag, flag_reason, flag_severity')
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
          back={backHref}
        >
          <WSStatusPill status={ws.status as WSStatus} />
          {ccSettings.billing_step && extraCols?.in4_entered_at && (
            <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold px-2 py-1 whitespace-nowrap">
              Entered in IN4{extraCols.in4_ref ? ` · ${extraCols.in4_ref}` : ""}
            </span>
          )}
        </PageHeader>

        <VersionChainBar
          wsId={ws.id}
          versionNo={ws.version_no}
          chainSize={ws.chain_size}
          breakChain={ws.break_chain}
          prev={prevSibling ? { id: prevSibling.id, ws_code: prevSibling.ws_code, version_no: prevSibling.version_no } : null}
          next={nextSibling ? { id: nextSibling.id, ws_code: nextSibling.ws_code, version_no: nextSibling.version_no } : null}
          canEdit={canEdit && (user?.id === ws.engineer_id || isAdmin) && !isArchived}
          archivedNotes={chainArchivedNotes}
        />

        <ArchiveControls
          wsId={ws.id}
          wsCode={ws.ws_code}
          archivedAt={extraCols?.archived_at ?? null}
          archivedByName={archiverName.get(extraCols?.archived_by ?? '') ?? null}
          canArchive={canArchive}
          isAdmin={isAdmin}
        />

        {ccSettings.show_deadlines && (ws.deadline_date || canEditDeadline) && (
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

        <SourceExcelViewer url={downloadUrl} name={ws.source_excel_name} microsoft={ccSettings.excel_microsoft} />

        {/* AI review tools — for the approval chain (PH / Atm Head /
            Trustee / admin), not engineers. */}
        {showAi && <WSAskAiPanel wsId={ws.id} />}

        {showAi && <AiBifurcationPanel
          wsId={ws.id}
          canEdit={canEdit && (user?.id === ws.engineer_id || isAdmin)}
          aiParseMeta={ws.ai_parse_meta as {
            text?: string | null
            model?: string
            rows_in?: number
            rows_out?: number
            suggestions_count?: number
            rate_concerns_count?: number
            totals_by_category?: Partial<Record<'material' | 'labour' | 'material_and_labour' | 'equipment', number>>
            split_totals?: Partial<Record<'material' | 'labour' | 'equipment', number>>
            run_at?: string
          } | null}
          rows={(excelRows ?? []).map(r => ({
            row_no: r.row_no,
            amount: r.amount != null ? Number(r.amount) : null,
            ai_meta: r.ai_meta as {
              category?: 'material' | 'labour' | 'material_and_labour' | 'equipment' | null
              material_value?: number | null
              labour_value?: number | null
              suggested_sub_skill_id?: string | null
              rate_concern?: string | null
            } | null,
          }))}
        />}

        <ExcelSummaryPanel
          signOffCfg={signOffCfg}
          wsId={ws.id}
          status={ws.status as WSStatus}
          ctx={ctx}
          reviewer={reviewer}
          aiEnabled={ccSettings.ai_tools}
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
            ai_meta: r.ai_meta as { category?: 'material' | 'labour' | 'material_and_labour' | 'equipment' | 'tax' | 'addon' | 'discount' | null } | null,
            flag: r.flag,
            flag_reason: r.flag_reason,
            flag_severity: r.flag_severity,
          }))}
        />

        {ccSettings.comments && <CommentsPanel wsId={ws.id} />}

      <ApprovalTimeline wsId={ws.id} />
      </div>
    )
  }

  const [itemsRes, vendorsRes, blRes, pastItemsRes] = await Promise.all([
    supabase
      .from('cc_working_sheet_items')
      .select('id, sr_no, description, uom, qty, rate, gst_pct, total_amount, vendor_id, location_tag, remark')
      .eq('working_sheet_id', id)
      .order('sr_no'),
    supabase.from('vendors').select('id, name').order('name'),
    // Best-effort budget headroom lookup — MANAGEMENT ONLY. For engineers
    // the query never runs, so the big numbers never reach the payload.
    reviewer
      ? supabase
          .from('cc_budget_lines')
          .select('current_budget_amt, current_wo_committed_amt, current_paid_amt')
          .eq('project_id', ws.project_id)
          .eq('discipline_id', ws.discipline_id)
          .eq('sub_skill_id', ws.sub_skill_id)
          .eq('line_type', ws.line_type)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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
  // (except cancelled). Management reads this to size ERP releases —
  // nobody types it. MANAGEMENT ONLY: skipped entirely for engineers.
  let estimate = 0
  if (reviewer) {
    const { data: planRows } = await supabase
      .from('cc_working_sheets')
      .select('total_amount, status')
      .eq('project_id', ws.project_id)
      .eq('discipline_id', ws.discipline_id)
      .eq('sub_skill_id', ws.sub_skill_id)
      .eq('line_type', ws.line_type)
      .is('archived_at', null)
    estimate = (planRows ?? [])
      .filter(r => r.status !== 'cancelled')
      .reduce((s, r) => s + Number(r.total_amount ?? 0), 0)
  }

  const isOwner = user?.id === ws.engineer_id
  const status = ws.status as WSStatus

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title={ws.ws_code}
        subtitle={`${proj?.code ?? '—'} · ${dis?.code} ${dis?.name} → ${sub?.code} ${sub?.name} · ${ws.line_type === 'material' ? 'Material' : ws.line_type === 'combined' ? 'Material + Labour' : 'Work'}${ws.entry_mode === 'thumbrule' ? ' · Thumbrule estimate' : ''}`}
        back={backHref}
      >
        <WSStatusPill status={status} />
        {ccSettings.billing_step && extraCols?.in4_entered_at && (
          <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold px-2 py-1 whitespace-nowrap">
            Entered in IN4{extraCols.in4_ref ? ` · ${extraCols.in4_ref}` : ''}
          </span>
        )}
      </PageHeader>

      <VersionChainBar
        wsId={ws.id}
        versionNo={ws.version_no}
        chainSize={ws.chain_size}
        breakChain={ws.break_chain}
        prev={prevSibling ? { id: prevSibling.id, ws_code: prevSibling.ws_code, version_no: prevSibling.version_no } : null}
        next={nextSibling ? { id: nextSibling.id, ws_code: nextSibling.ws_code, version_no: nextSibling.version_no } : null}
        canEdit={canEdit && (isOwner || isAdmin)}
      />

      {/* AI review tools — approval chain only, not engineers. */}
      {showAi && <WSAskAiPanel wsId={ws.id} />}

      {ccSettings.show_deadlines && (ws.deadline_date || canEditDeadline) && (
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

      {/* Returned-reason — the engineer MUST see this even without the
          management strip below. */}
      {!reviewer && status === 'returned' && ws.return_reason && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold mb-1">Returned for revision</p>
          <p>{ws.return_reason}</p>
        </div>
      )}

      {/* Past-spend strip — MANAGEMENT ONLY (Internal Estimate, ERP budget,
          committed, paid are big numbers engineers don't see). */}
      {reviewer && (
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
          {ccSettings.show_erp_columns && (
            <>
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
            </>
          )}
          <div className="ml-auto">
            <span className="text-xs uppercase tracking-wide text-blue-700/70">This WS</span>
            <p className="font-bold text-blue-900">{formatINR(ws.total_amount ?? 0)}</p>
          </div>
          {ccSettings.show_erp_columns && bl && (
            <div>
              <span className="text-xs uppercase tracking-wide text-blue-700/70">Remaining after</span>
              <p className={`font-bold ${remainingAfter < 0 ? 'text-red-700' : 'text-green-800'}`}>
                {formatINR(remainingAfter)}
              </p>
            </div>
          )}
        </div>
        {ccSettings.show_erp_columns && !bl && (
          <p className="text-xs text-blue-700 mt-2">
            No budget line set for this sub-skill yet. Import the ENGG_CONSOLIDATED_BUDGET_REPORT or add a budget line to see headroom checks.
          </p>
        )}
        {ccSettings.show_erp_columns && estimate > 0 && budgeted > 0 && budgeted < estimate && (
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
      )}

      {/* A failed items query must not render the editor's "No items yet"
          empty state — someone would re-type rows that already exist. */}
      {itemsRes.error ? (
        <QueryError message={itemsRes.error.message} what="the items on this sheet" />
      ) : (
      <WSEditor
          signOffCfg={signOffCfg}
        wsId={ws.id}
        status={status}
        canEdit={canEdit && (isOwner || isAdmin)}
        ctx={ctx}
        approvedSoFar={Number(ws.approved_for_erp_amt ?? 0)}
        vendors={vendorsRes.data ?? []}
        initialItems={itemsRes.data ?? []}
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
      )}

      {ccSettings.comments && <CommentsPanel wsId={ws.id} />}

      <ApprovalTimeline wsId={ws.id} />
    </div>
  )
}
