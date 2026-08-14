// "Budget position" — shown to a reviewer on a pending budget sheet, right by
// the sign-off. For this sheet's sub-skill, its discipline, and the whole
// project, it shows the budget ALREADY APPROVED so far → what it BECOMES once
// this sheet is signed off. Reuses the same money rollup as the project /
// approvals pages so the figures always match. No Internal Estimate here —
// only approved amounts. One component → renders the same on web and mobile.

import { createClient } from '@/lib/supabase/server'
import { computeMoneyRollup, type RollupWSRow, type RollupVersionRow } from '@/lib/cost-control/project-rollup'
import { formatINR } from '@/lib/utils'

interface SheetRow extends RollupWSRow, RollupVersionRow {}

export async function BudgetPositionPanel({
  projectId, disciplineId, subSkillId, totalAmount, approvedForErp,
  subName, discName, projName,
}: {
  projectId: string
  disciplineId: string | null
  subSkillId: string | null
  totalAmount: number
  approvedForErp: number | null
  subName: string | null
  discName: string | null
  projName: string | null
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

  const rows = [
    { key: 'line', label: subName ?? discName ?? 'This line', tag: 'this line', before: subApproved, lead: true },
    { key: 'disc', label: discName ?? '—', tag: 'discipline', before: discApproved, lead: false },
    { key: 'proj', label: projName ?? '—', tag: 'project total', before: projApproved, lead: false },
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
          <div key={r.key} className={`flex items-center justify-between gap-4 px-4 py-3 ${r.lead ? 'bg-emerald-50/30' : ''}`}>
            <div className="min-w-0 flex-1">
              <p className={`truncate ${r.lead ? 'text-sm font-semibold text-gray-900' : 'text-[13px] font-medium text-gray-700'}`}>{r.label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{r.tag}</p>
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
    </div>
  )
}
