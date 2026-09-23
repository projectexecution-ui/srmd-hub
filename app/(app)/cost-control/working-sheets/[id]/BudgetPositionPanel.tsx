// "Budget position" — shown to a reviewer on a pending budget sheet, beside
// the requested figure. For the whole project, this sheet's category and its
// sub-category, it shows the budget ALREADY APPROVED so far → what it BECOMES
// once this sheet is signed off. Reuses the same money rollup as the project /
// approvals pages so the figures always match.
//
// Aksha, 23 Sep 2026: "this data is really imp — need it but smartly in same
// format". So: the same three rows and the same "approved so far → after you
// approve" reading, in the hub's nesting order Project → Category →
// Sub-category (matching the header chips). The Internal Estimate check sits
// ON the sub-category row when an estimate exists — the figure, and how much
// is left after this, red when the ask goes past it. When no estimate is set
// there is no yellow box any more: one quiet sentence says so.
//
// Reviewer-gated by the caller (page.tsx: `reviewer && isPendingApproval`);
// the Internal Estimate must never reach an engineer.

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
  /** Exactly what the header chips show — code and name, e.g.
   *  "2701 Excavation, Backfilling & Compaction". Same strings, so they agree. */
  subLabel: string | null
  discLabel: string | null
  projLabel: string | null
  /** True when this sheet sits on a sub-project, so the top row is labelled
   *  Sub-project rather than Project — the total is that sub-project's. */
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
  const ieFromImport = roll.wsAgg.get(`${disciplineId}::${subSkillId}`)?.planTotal ?? 0
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
  const subAfter = subApproved + inc
  const hasIE = internalEstimate > 0
  const left = hasIE ? Math.round(internalEstimate) - Math.round(subAfter) : null
  const firstOnProject = projApproved === 0

  // Same three levels, same names as the header chips, top-down.
  const rows = [
    { key: 'proj', tag: projIsSub ? 'Sub-project' : 'Project', label: projLabel ?? '—', before: projApproved, lead: false },
    { key: 'disc', tag: 'Category', label: discLabel ?? '—', before: discApproved, lead: false },
    { key: 'line', tag: 'Sub-category', label: subLabel ?? discLabel ?? '—', before: subApproved, lead: true },
  ]

  const why = hasIE
    ? `Internal Estimate for this sub-category ${formatINR(internalEstimate)}; the figure on its row is what is left after this request.`
    : `No Internal Estimate is set for this sub-category, so there is nothing to hold ${formatINR(subAfter)} against.${firstOnProject ? ' Nothing else is approved on this project yet, so the three lines match.' : ''}`

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500">Budget position · approved so far → after you approve</p>
        <span
          className="inline-grid h-[15px] w-[15px] place-items-center rounded-full border border-gray-300 text-[9.5px] font-bold text-gray-500 cursor-help"
          title={why} aria-label={why}
        >i</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.key} className="flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap py-2">
            <p className="text-[13px] break-words min-w-0 flex-1">
              <span className="text-gray-400">{r.tag}</span>{' '}
              <span className={r.lead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}>{r.label}</span>
            </p>
            <div className="flex-shrink-0 text-right leading-tight tabular-nums whitespace-nowrap">
              <span className="text-xs text-gray-400">{formatINR(r.before)}</span>
              <span className="mx-1 text-gray-300">→</span>
              <span className="text-sm font-bold text-gray-900">{formatINR(r.before + inc)}</span>
              {/* The Internal Estimate check rides the sub-category row only —
                  a category or project total says nothing about the decision in
                  front of the approver. Red when this request goes past it. */}
              {r.lead && hasIE && left != null && (
                <span className={`block text-[11px] mt-0.5 ${left < 0 ? 'font-bold text-rose-700' : 'text-gray-500'}`}>
                  {left < 0
                    ? `${formatINR(-left)} above the Internal Estimate of ${formatINR(internalEstimate)}`
                    : `Internal Estimate ${formatINR(internalEstimate)} · ${formatINR(left)} left after this`}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {!hasIE && (
        <p className="mt-1.5 text-[11.5px] text-gray-400">No Internal Estimate for this sub-category yet.</p>
      )}
    </div>
  )
}
