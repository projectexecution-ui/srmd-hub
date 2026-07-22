// Single source of truth for the per-sub-skill / per-category MONEY rollup on a
// Cost Control project. Used by BOTH the project home page
// (app/(app)/cost-control/projects/[id]/page.tsx) and the Master Excel export
// (app/api/cost-control/master-export/route.ts) so the spreadsheet always shows
// the SAME numbers as the screen. Pure (rows in, maps out) → unit-testable.
//
// The two things that live in a sub-skill and must NEVER be added together:
//   • the imported Internal Estimate baseline — sheets tagged "[IB…]" (the
//     amounts management uploaded from Excel); and
//   • engineers' own sheets — their "ask", which runs through approval.
// They can share a version chain, and every sheet keeps its OLD versions live,
// so we (1) classify each live sheet as baseline vs engineer, then (2) within
// each class keep only the LATEST version of each chain.

export interface RollupWSRow {
  id: string
  discipline_id: string | null
  sub_skill_id: string | null
  status: string
  total_amount: number | null
  approved_for_erp_amt: number | null
  summary_notes: string | null
  entry_mode?: string | null
}
export interface RollupVersionRow { id: string; chain_anchor_id: string | null; version_no: number | null }
export interface RollupBudgetLine {
  discipline_id: string | null
  sub_skill_id: string | null
  current_budget_amt: number | null
  current_wo_committed_amt: number | null
  current_paid_amt: number | null
}
export interface RollupSubSkill { id: string; discipline_id: string }
export interface RollupDiscipline { id: string }

export interface SubAgg { approvedTotal: number; pendingAmount: number; planTotal: number; chains: Set<string> }
export interface BlAgg { budget: number; wo: number; paid: number }
export interface DiscAgg { budget: number; wo: number; paid: number; approvedTotal: number; estimate: number; pending: number }

export interface MoneyRollup {
  blMap: Map<string, BlAgg>                                  // `${disc}::${sub ?? '_root'}`
  wsAgg: Map<string, SubAgg>                                 // `${disc}::${sub}`
  discAgg: Map<string, DiscAgg>                              // disciplineId
  latestEng: Map<string, { w: RollupWSRow; ver: number }>    // chain anchor → latest engineer sheet
}

// Anywhere in the 3-stage sign-off chain = still pending release.
const PENDING_STATUS = new Set(['submitted', 'ph_approved', 'atm_approved'])

/** Per-sub-skill helper for the summary tables — flattens the maps into the
 *  seven figures the screen shows for one (discipline, sub-skill). */
export function subFigures(r: MoneyRollup, disciplineId: string, subSkillId: string): {
  internalEstimate: number; awaitingApproval: number; approvedViaWs: number
  budget: number; wo: number; paid: number; wsCount: number
} {
  const a = r.wsAgg.get(`${disciplineId}::${subSkillId}`)
  const bl = r.blMap.get(`${disciplineId}::${subSkillId}`)
  return {
    internalEstimate: a?.planTotal ?? 0,
    awaitingApproval: a?.pendingAmount ?? 0,
    approvedViaWs: a?.approvedTotal ?? 0,
    budget: bl?.budget ?? 0,
    wo: bl?.wo ?? 0,
    paid: bl?.paid ?? 0,
    wsCount: a?.chains.size ?? 0,
  }
}

export function computeMoneyRollup(input: {
  wsRows: RollupWSRow[]
  versionRows: RollupVersionRow[]
  budgetLines: RollupBudgetLine[]
  subSkills: RollupSubSkill[]
  disciplines: RollupDiscipline[]
}): MoneyRollup {
  const { wsRows, versionRows, budgetLines, subSkills, disciplines } = input

  // Budget lines by (discipline, sub_skill) — sub_skill null = the category
  // (root) row. The same pair can carry several rows (one per line_type), so
  // SUM across them; keeping only the last would silently drop the others.
  const blMap = new Map<string, BlAgg>()
  for (const b of budgetLines) {
    const k = `${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0, paid: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo += Number(b.current_wo_committed_amt ?? 0)
    cur.paid += Number(b.current_paid_amt ?? 0)
    blMap.set(k, cur)
  }

  const chainOf = new Map<string, { anchor: string; ver: number }>()
  for (const r of versionRows) {
    if (r.chain_anchor_id) chainOf.set(r.id, { anchor: r.chain_anchor_id, ver: Number(r.version_no ?? 1) })
  }
  const liveRows = wsRows.filter(w => w.status !== 'cancelled')
  // Latest [IB] and latest engineer sheet per chain. Sheets with no chain info
  // fall back to their own id as a singleton chain.
  const latestIB = new Map<string, { w: RollupWSRow; ver: number }>()
  const latestEng = new Map<string, { w: RollupWSRow; ver: number }>()
  for (const w of liveRows) {
    const ch = chainOf.get(w.id) ?? { anchor: w.id, ver: 1 }
    const bag = (w.summary_notes ?? '').startsWith('[IB') ? latestIB : latestEng
    const prev = bag.get(ch.anchor)
    if (!prev || ch.ver > prev.ver) bag.set(ch.anchor, { w, ver: ch.ver })
  }

  const wsAgg = new Map<string, SubAgg>()
  const ensureAgg = (k: string) => {
    let cur = wsAgg.get(k)
    if (!cur) { cur = { approvedTotal: 0, pendingAmount: 0, planTotal: 0, chains: new Set<string>() }; wsAgg.set(k, cur) }
    return cur
  }
  // Internal Estimate baseline = latest [IB] sheet per chain.
  for (const { w } of latestIB.values()) {
    const cur = ensureAgg(`${w.discipline_id}::${w.sub_skill_id}`)
    cur.planTotal += Number(w.total_amount ?? 0)
    cur.chains.add(chainOf.get(w.id)?.anchor ?? w.id)
  }
  // Engineers' latest sheets → pending / approved (never their old versions).
  for (const { w } of latestEng.values()) {
    const cur = ensureAgg(`${w.discipline_id}::${w.sub_skill_id}`)
    cur.chains.add(chainOf.get(w.id)?.anchor ?? w.id)
    const amt = Number(w.total_amount ?? 0)
    const appr = Number(w.approved_for_erp_amt ?? 0)
    if (w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid') {
      cur.approvedTotal += appr > 0 ? appr : amt
    } else if (w.status === 'partially_approved') {
      // Some releases approved, more to come: released portion counts as
      // approved, remainder stays pending.
      cur.approvedTotal += appr
      cur.pendingAmount += Math.max(amt - appr, 0)
    } else if (PENDING_STATUS.has(w.status)) {
      cur.approvedTotal += appr
      cur.pendingAmount += Math.max(amt - appr, 0)
    }
    // draft / returned / draft_blocked add nothing but the chain count.
  }

  // Discipline rollups. Budget can live at two granularities: per-sub-skill
  // lines, or a discipline-root line (sub_skill_id NULL). NEVER add both for
  // the same discipline — a BPH report often carries a category SUMMARY row
  // AND its detail rows; the summary is the parent total, so counting both
  // doubles the budget. Rule: if a discipline has ANY sub-skill budget line,
  // use those and ignore its root; only fall back to root when there are none.
  const discAgg = new Map<string, DiscAgg>()
  for (const d of disciplines) discAgg.set(d.id, { budget: 0, wo: 0, paid: 0, approvedTotal: 0, estimate: 0, pending: 0 })
  const discHasSubSkillBudget = new Set<string>()
  for (const s of subSkills) {
    const bl = blMap.get(`${s.discipline_id}::${s.id}`)
    const a = wsAgg.get(`${s.discipline_id}::${s.id}`)
    const cur = discAgg.get(s.discipline_id)
    if (cur) {
      const subBudget = bl?.budget ?? 0
      if (bl && (subBudget !== 0 || bl.wo !== 0 || bl.paid !== 0)) discHasSubSkillBudget.add(s.discipline_id)
      cur.budget += subBudget
      cur.wo += bl?.wo ?? 0
      cur.paid += bl?.paid ?? 0
      cur.approvedTotal += a?.approvedTotal ?? 0
      cur.estimate += a?.planTotal ?? 0
      cur.pending += a?.pendingAmount ?? 0
    }
  }
  for (const d of disciplines) {
    if (discHasSubSkillBudget.has(d.id)) continue
    const blRoot = blMap.get(`${d.id}::_root`)
    if (!blRoot) continue
    const cur = discAgg.get(d.id)
    if (cur) { cur.budget += blRoot.budget; cur.wo += blRoot.wo; cur.paid += blRoot.paid }
  }

  return { blMap, wsAgg, discAgg, latestEng }
}
