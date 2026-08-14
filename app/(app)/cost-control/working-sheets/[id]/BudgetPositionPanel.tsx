// "Budget position" — shown to a reviewer on a pending budget sheet, right by
// the sign-off. For this sheet's sub-skill, its discipline, and the whole
// project, it shows the budget ALREADY APPROVED so far → what it BECOMES once
// this sheet is signed off. Reuses the same money rollup as the project /
// approvals pages, so the figures always match. No Internal Estimate here —
// only approved amounts.

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
    { key: 'line', label: subName ?? discName ?? 'This line', tag: 'this line', before: subApproved },
    { key: 'disc', label: discName ?? '—', tag: 'discipline', before: discApproved },
    { key: 'proj', label: projName ?? '—', tag: 'project total', before: projApproved },
  ]

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-teal-100 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-gray-800">Budget position</span>
        <span className="text-xs text-gray-500">approved so far → after you approve</span>
      </div>
      <div className="divide-y divide-teal-100/70">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate text-sm text-gray-800">
              {r.label} <span className="text-[10px] uppercase tracking-wide text-gray-400">{r.tag}</span>
            </span>
            <span className="flex-shrink-0 whitespace-nowrap text-sm tabular-nums">
              <span className="text-gray-500">{formatINR(r.before)}</span>
              <span className="mx-1 text-gray-400">→</span>
              <span className="font-bold text-emerald-700">{formatINR(r.before + inc)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
