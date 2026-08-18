// Assemble the ApprovalCardInput for one working sheet, server-side, from the
// SAME queries the My Approvals page uses (app/(app)/cost-control/approvals) so
// the Telegram card shows numbers identical to the screen: the ask, ₹/sft, the
// ERP Budget·WO·Paid strip, and the vs-last-revision delta. Confidentiality is
// applied here (the CALLER must still refuse [IB] sheets — see isIB): the ERP
// strip + ₹/sft obey the CC settings toggles, exactly like the page.
//
// Takes a service-role client (the Telegram path has no user session). Pure data
// — no rendering — so it is unit-testable and reused by the sender + dispatcher.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApprovalCardInput, ApprovalStage } from './approval-card'
import type { CcSettings } from './settings'

export interface ApprovalCardData {
  input: ApprovalCardInput
  wsId: string
  status: ApprovalStage
  projectId: string
  engineerId: string
  /** [IB…] Internal-Estimate baseline — must NEVER go to Telegram. */
  isIB: boolean
  wsCode: string
  amount: number
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function daysWaiting(submittedAt: string | null, nowMs: number): number {
  if (!submittedAt) return 0
  return Math.max(0, Math.floor((nowMs - new Date(submittedAt).getTime()) / 86_400_000))
}

const NEXT_LABEL: Record<ApprovalStage, string> = {
  submitted: 'Project Head sign-off',
  ph_approved: 'Atm Head sign-off',
  atm_approved: 'Trustee release',
  partially_approved: 'Trustee release (balance)',
}

interface WsJoinRow {
  id: string
  ws_code: string
  status: string
  total_amount: number | null
  approved_for_erp_amt: number | null
  submitted_at: string | null
  engineer_id: string
  discipline_id: string | null
  sub_skill_id: string | null
  project_id: string
  chain_anchor_id: string | null
  version_no: number | null
  summary_notes: string | null
  projects: { code: string; name: string; built_up_sft: number | null } | Array<{ code: string; name: string; built_up_sft: number | null }> | null
  cc_disciplines: { name: string } | Array<{ name: string }> | null
  cc_sub_skills: { name: string } | Array<{ name: string }> | null
}

/**
 * Load everything the approval card needs for one sheet. Returns null if the
 * sheet is gone or not in a pending stage. `nowMs` is injected for testability.
 */
export async function loadApprovalCardInput(
  svc: SupabaseClient,
  wsId: string,
  ccSettings: CcSettings,
  nowMs: number = Date.now(),
): Promise<ApprovalCardData | null> {
  const { data: wsRaw } = await svc
    .from('cc_ws_with_versions')
    .select(
      `id, ws_code, status, total_amount, approved_for_erp_amt, submitted_at, engineer_id,
       discipline_id, sub_skill_id, project_id, chain_anchor_id, version_no, summary_notes,
       projects(code, name, built_up_sft),
       cc_disciplines(name),
       cc_sub_skills(name)`,
    )
    .eq('id', wsId)
    .maybeSingle()
  const ws = wsRaw as WsJoinRow | null
  if (!ws) return null

  const PENDING = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']
  if (!PENDING.includes(ws.status)) return null
  const stage = ws.status as ApprovalStage

  const proj = pickFirst(ws.projects)
  const sub = pickFirst(ws.cc_sub_skills)
  const disc = pickFirst(ws.cc_disciplines)
  const sft = Number(proj?.built_up_sft ?? 0)
  const amount = Number(ws.total_amount ?? 0)
  const isIB = (ws.summary_notes ?? '').startsWith('[IB')

  // Engineer (raiser) name.
  const { data: eng } = await svc.from('profiles').select('full_name').eq('id', ws.engineer_id).maybeSingle()

  // ERP strip — sum the (project, discipline, sub-skill) budget line(s), same as
  // the page. Hidden when the toggle is off or no line carries any figure.
  let erp: ApprovalCardInput['erp'] = null
  if (ccSettings.show_erp_columns && ws.sub_skill_id) {
    const { data: bls } = await svc
      .from('cc_budget_lines')
      .select('current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', ws.project_id)
      .eq('discipline_id', ws.discipline_id)
      .eq('sub_skill_id', ws.sub_skill_id)
    const agg = (bls ?? []).reduce(
      (a, b) => ({
        budget: a.budget + Number(b.current_budget_amt ?? 0),
        wo: a.wo + Number(b.current_wo_committed_amt ?? 0),
        paid: a.paid + Number(b.current_paid_amt ?? 0),
      }),
      { budget: 0, wo: 0, paid: 0 },
    )
    if (agg.budget !== 0 || agg.wo !== 0 || agg.paid !== 0) erp = agg
  }
  const erpNew = ccSettings.show_erp_columns && !erp

  // vs-last-revision — only for v2+ sheets, comparing to the highest earlier
  // version on the chain (same logic as the page).
  let revision: ApprovalCardInput['revision'] = null
  const ver = Number(ws.version_no ?? 1)
  if (ws.chain_anchor_id && ver > 1) {
    const { data: earlier } = await svc
      .from('cc_ws_with_versions')
      .select('version_no, total_amount')
      .eq('chain_anchor_id', ws.chain_anchor_id)
      .lt('version_no', ver)
      .order('version_no', { ascending: false })
      .limit(1)
    const prev = (earlier ?? [])[0]
    if (prev) {
      const pt = Number(prev.total_amount ?? 0)
      revision = { n: ver, deltaPct: pt > 0 ? Math.round(((amount - pt) / pt) * 100) : null }
    }
  }

  const dWait = daysWaiting(ws.submitted_at, nowMs)

  const input: ApprovalCardInput = {
    wsCode: ws.ws_code,
    project: { code: proj?.code ?? '', name: proj?.name ?? '' },
    work: sub?.name || disc?.name || 'Budget',
    stage,
    amount,
    area: sft > 0 ? sft : null,
    raisedBy: (eng?.full_name as string | null) ?? null,
    daysWaiting: dWait,
    overdue: dWait > 2,
    erp,
    erpNew,
    revision,
    approvedSoFar: null,
    afterThis: null,
    showPerSft: ccSettings.show_per_sft,
    showErp: ccSettings.show_erp_columns,
    nextActionLabel: NEXT_LABEL[stage],
  }

  return {
    input,
    wsId: ws.id,
    status: stage,
    projectId: ws.project_id,
    engineerId: ws.engineer_id,
    isIB,
    wsCode: ws.ws_code,
    amount,
  }
}
