// "Budget position" — shown to a reviewer on a pending budget sheet, right by
// the sign-off. For this sheet's sub-skill, its discipline, and the whole
// project, it shows the budget ALREADY APPROVED so far → what it BECOMES once
// this sheet is signed off. Reuses the same money rollup as the project /
// approvals pages so the figures always match. No Internal Estimate here —
// only approved amounts — EXCEPT the Internal Estimate check the HOD asked
// for: an approver has to be told, at the moment he signs, when the ask takes
// this line past what management estimated. Safe to show here because this
// panel is reviewer-gated (page.tsx: `reviewer && isPendingApproval`); the
// Internal Estimate must never reach an engineer.
// One component → renders the same on web and mobile.

import { createClient } from '@/lib/supabase/server'
import { computeMoneyRollup, type RollupWSRow, type RollupVersionRow } from '@/lib/cost-control/project-rollup'
import { formatINR } from '@/lib/utils'

interface SheetRow extends RollupWSRow, RollupVersionRow {}

export async function BudgetPositionPanel({
  projectId, disciplineId, subSkillId, totalAmount, approvedForErp,
  subLabel, discLabel, projLabel, projIsSub,
}: {
  projectId: string
  disciplineId: string | null
  subSkillId: string | null
  totalAmount: number
  approvedForErp: number | null
  /** Exactly what the identity block shows — code and name, e.g.
   *  "1203 Internal Partitions". Same strings, so the two agree. */
  subLabel: string | null
  discLabel: string | null
  projLabel: string | null
  /** True when this sheet sits on a sub-project, so the bottom row is
   *  labelled Sub-project rather than Project — the total is that
   *  sub-project's, not the parent's. */
  projIsSub: boolean
}) {
  const supabase = await createClient()
  const { data: sheets } = await supabase
    .from('cc_ws_with_versions')
    .select('id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, summary_notes, entry_mode, chain_anchor_id, version_no')
    .eq('project_id', projectId)

  const roll = computeMoneyRollup({
    wsRows: (sheets ?? []) as SheetRow[],
    versionRows: (sheets ?? []) as SheetRow[],
    budgetLines: [], subSkills: [], disciplines: [],
  })

  // Internal Estimate for THIS sub-category: the imported [IB…] baseline, or a
  // Trustee-accepted figure where one has been set (that always wins).
  const ieRoll = computeMoneyRollup({
    wsRows: (sheets ?? []) as SheetRow[],
    versionRows: (sheets ?? []) as SheetRow[],
    budgetLines: [], subSkills: [], disciplines: [],
  })
  const ieFromImport = ieRoll.wsAgg.get(`${disciplineId}::${subSkillId}`)?.planTotal ?? 0
  const { data: blRows } = await supabase
    .from('cc_budget_lines')
    .select('internal_estimate_amt')
    .eq('project_id', projectId)
    .eq('discipline_id', disciplineId ?? '')
    .eq('sub_skill_id', subSkillId ?? '')
  const ieAccepted = (blRows ?? []).reduce(
    (a, b) => a + (b.internal_estimate_amt == null ? 0 : Number(b.internal_estimate_amt)), 0)
  const internalEstimate = ieAccepted > 0 ? ieAccepted : ieFromImport

  // Already-approved so far, at each level. wsAgg is keyed `${disc}::${sub}`.
  let projApproved = 0, discApproved = 0, subApproved = 0
  const subKey = `${disciplineId}::${subSkillId}`
  for (const [key, agg] of roll.wsAgg) {
    projApproved += agg.approvedTotal
    if (key.slice(0, key.indexOf('::')) === disciplineId) discApproved += agg.approvedTotal
    if (key === subKey) subApproved += agg.approvedTotal
  }

  // What this sign-off adds = the ask minus whatever's already released on it.
  const inc = Math.max(0, Number(totalAmount ?? 0) - Number(approvedForErp ?? 0))

  // Same three levels, same names, as the identity block on this sheet.
  const rows = [
    { key: 'line', tag: 'Sub-category', label: subLabel ?? discLabel ?? '—', before: subApproved, lead: true },
    { key: 'disc', tag: 'Category', label: discLabel ?? '—', before: discApproved, lead: false },
    { key: 'proj', tag: projIsSub ? 'Sub-project' : 'Project', label: projLabel ?? '—', before: projApproved, lead: false },
  ]

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Budget position</span>
          <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">new</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">Approved so far → after you approve</p>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.key} className={`flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap px-4 py-3 ${r.lead ? 'bg-emerald-50/30' : ''}`}>
            <div className="min-w-0 flex-1">
              {/* Grey label, bold value, on one line — exactly how the
                  identity block at the top of this sheet reads. */}
              <p className="text-[13px] break-words">
                <span className="text-gray-400">{r.tag}</span>{' '}
                <span className={r.lead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}>{r.label}</span>
              </p>
            </div>
            <div className="flex-shrink-0 text-right leading-tight">
              <div className="tabular-nums whitespace-nowrap">
                <span className="text-xs text-gray-500">{formatINR(r.before)}</span>
                <span className="mx-1 text-gray-300">→</span>
                <span className="text-sm font-bold text-emerald-700">{formatINR(r.before + inc)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The Internal Estimate check (HOD). Only for THIS line — a discipline or
          project total tells an approver nothing about the decision in front of
          him. Silent when the ask sits inside the estimate; loud when it does
          not; and explicit when no estimate was ever set, because "no estimate"
          reads identically to "zero" if nobody says which it is. */}
      {(() => {
        const after = subApproved + inc
        if (internalEstimate <= 0) {
          return (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5">
              <p className="text-[12.5px] font-semibold text-amber-900">No Internal Estimate set for this sub-category</p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                There is nothing to check {formatINR(after)} against. Approving is fine — just know you are
                not approving against an estimate.
              </p>
            </div>
          )
        }
        const over = Math.round(after) - Math.round(internalEstimate)
        if (over <= 0) {
          return (
            <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-2.5">
              <p className="text-[12px] text-gray-600">
                Internal Estimate for this sub-category <b className="text-gray-900 tabular-nums">{formatINR(internalEstimate)}</b>
                <span className="text-gray-400"> · within estimate</span>
              </p>
            </div>
          )
        }
        return (
          <div className="border-t border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-[13px] font-bold text-rose-900">
              This takes the sub-category {formatINR(over)} ABOVE the Internal Estimate
            </p>
            <p className="text-[11.5px] text-rose-800 mt-0.5 tabular-nums">
              Internal Estimate {formatINR(internalEstimate)} · approved after this {formatINR(after)}
            </p>
          </div>
        )
      })()}
    </div>
  )
}
