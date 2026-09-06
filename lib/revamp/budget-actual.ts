// Budget vs Actual — the figures behind the workspace's first tab.
//
// Build order §2. The rule here is NOT new arithmetic: it reproduces what CT
// Hub's Internal Estimate page already shows, so the two screens can never
// quote different money for the same project. Pure (rows in, figures out) so
// every number is asserted in a test against real IN4/CT Hub data rather than
// eyeballed in a browser — see budget-actual.test.ts, which pins NGH B.
//
// §10 holds throughout: nothing here is back-calculated. A figure is what the
// database holds, or it is null and the screen shows n/a.

/** A `cc_budget_lines` row, as much of it as the money needs. */
export interface BudgetLineRow {
  discipline_id: string | null
  /** null = the CATEGORY-level (root) line, not a sub-skill line. */
  sub_skill_id: string | null
  internal_estimate_amt: number | null
  current_budget_amt: number | null
  current_wo_committed_amt: number | null
  current_paid_amt: number | null
}

/** A live `cc_working_sheets` row, already collapsed to one per version chain. */
export interface SheetRow {
  id: string
  discipline_id: string | null
  sub_skill_id: string | null
  status: string
  total_amount: number | null
  /** Chain identity from `cc_ws_with_versions`; falls back to the row's own id. */
  chain_anchor_id?: string | null
  version_no?: number | null
}

export interface CategoryRef { id: string; code: string | null; name: string }
export interface SubSkillRef { id: string; discipline_id: string; code: string | null; name: string }

/** The seven figures a row carries, at either level. Nulls mean "IN4/CT Hub
 *  holds nothing here", and render as an em-dash — never as a zero. */
export interface MoneyRow {
  internalEstimate: number | null
  awaitingApproval: number | null
  budgetCtHub: number | null
  budgetErp: number | null
  woPo: number | null
  paid: number | null
  /** paid ÷ budget (ERP). Null when there is no ERP budget to divide by. */
  pctUsed: number | null
}

export interface SubSkillLine extends MoneyRow {
  subSkillId: string
  code: string | null
  name: string
  sheetCount: number
  /** True when this line's estimate came from a working sheet rather than a
   *  maintained `internal_estimate_amt`. Worth showing — it is the softer of
   *  the two sources. */
  estimateFromSheet: boolean
}

export interface CategoryLine extends MoneyRow {
  disciplineId: string
  code: string | null
  name: string
  sheetCount: number
  subSkills: SubSkillLine[]
  /** No money at all on this category — hidden behind the "N empty hidden"
   *  toggle rather than padding the table with rows of em-dashes. */
  isEmpty: boolean
}

export interface BudgetActual {
  categories: CategoryLine[]
  totals: MoneyRow
  /** Categories with nothing in any column — the count the toolbar shows. */
  emptyCount: number
}

const n = (v: number | null | undefined): number => (v == null ? 0 : Number(v))
const key = (d: string | null, s: string | null) => `${d ?? '_'}::${s ?? '_root'}`

/** Sum that stays null when nothing contributed, so "no data" survives all the
 *  way to the screen instead of turning into a zero on the first addition. */
function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null
  return n(a) + n(b)
}

/** paid ÷ budget, as a whole percent. Null when there is no budget — a
 *  percentage of nothing is not 0%, it is nothing. */
export function usedPct(paid: number | null, budgetErp: number | null): number | null {
  if (budgetErp == null || budgetErp === 0) return null
  return Math.round((n(paid) / budgetErp) * 100)
}

/**
 * Collapse working sheets to the LATEST live version of each revision chain.
 *
 * Every sheet keeps its old versions in the table, so summing the raw rows
 * counts the same sub-skill two or three times over. Cancelled sheets drop out
 * entirely. Mirrors lib/cost-control/project-rollup.ts, which the Internal
 * Estimate page uses — the two must agree or the same project shows two
 * different estimates depending on which screen you opened.
 */
export function latestPerChain(sheets: SheetRow[]): SheetRow[] {
  const best = new Map<string, { row: SheetRow; ver: number }>()
  for (const w of sheets) {
    if (w.status === 'cancelled') continue
    const anchor = w.chain_anchor_id ?? w.id
    const ver = Number(w.version_no ?? 1)
    const prev = best.get(anchor)
    if (!prev || ver > prev.ver) best.set(anchor, { row: w, ver })
  }
  return [...best.values()].map(b => b.row)
}

/**
 * THE INTERNAL ESTIMATE RULE (build order §2), stated once.
 *
 * The maintained estimate is `cc_budget_lines.internal_estimate_amt` where it
 * is set; where it is not, the latest working sheet total for that sub-skill
 * stands in. Sub-skills that have a sheet but no budget line still count —
 * dropping them would lose real estimate.
 *
 * The trap: where a budget line sits on a NULL sub-skill (the category-level
 * row), the sheets underneath that category must NOT be added on top. The
 * category line already covers them, and adding both double-counts. On NGH B
 * that is ₹22,93,000 across two categories — Equipment Cost and Delay in
 * Drawings — so it is not a rounding-sized mistake.
 */
export function estimateForSubSkill(
  line: BudgetLineRow | undefined,
  sheetTotal: number | null,
  categoryHasRootLine: boolean,
): { amount: number | null; fromSheet: boolean } {
  if (line && line.internal_estimate_amt != null) {
    return { amount: Number(line.internal_estimate_amt), fromSheet: false }
  }
  if (categoryHasRootLine) return { amount: null, fromSheet: false }
  if (sheetTotal == null) return { amount: null, fromSheet: false }
  return { amount: sheetTotal, fromSheet: true }
}

/**
 * Build the whole Category / sub-category table.
 *
 * ERP budget, WO/PO and Paid come straight from `cc_budget_lines`. Where a
 * category carries BOTH sub-skill lines and a root line, only the sub-skill
 * lines count: a BPH import often lands a category summary row alongside its
 * detail rows, and adding both doubles that category's budget. Same rule the
 * Internal Estimate page applies.
 */
export function buildBudgetActual(input: {
  categories: CategoryRef[]
  subSkills: SubSkillRef[]
  budgetLines: BudgetLineRow[]
  sheets: SheetRow[]
}): BudgetActual {
  const { categories, subSkills, budgetLines, sheets } = input

  // Budget lines can repeat for one (category, sub-skill) — one row per
  // line_type — so they are summed, never overwritten.
  const lineAt = new Map<string, BudgetLineRow>()
  for (const b of budgetLines) {
    const k = key(b.discipline_id, b.sub_skill_id)
    const prev = lineAt.get(k)
    if (!prev) { lineAt.set(k, { ...b }); continue }
    prev.internal_estimate_amt = addNullable(prev.internal_estimate_amt, b.internal_estimate_amt)
    prev.current_budget_amt = addNullable(prev.current_budget_amt, b.current_budget_amt)
    prev.current_wo_committed_amt = addNullable(prev.current_wo_committed_amt, b.current_wo_committed_amt)
    prev.current_paid_amt = addNullable(prev.current_paid_amt, b.current_paid_amt)
  }

  const rootLineFor = new Map<string, BudgetLineRow>()
  const hasSubSkillMoney = new Set<string>()
  for (const b of budgetLines) {
    if (!b.discipline_id) continue
    if (b.sub_skill_id == null) { rootLineFor.set(b.discipline_id, lineAt.get(key(b.discipline_id, null))!); continue }
    if (n(b.current_budget_amt) !== 0 || n(b.current_wo_committed_amt) !== 0 || n(b.current_paid_amt) !== 0) {
      hasSubSkillMoney.add(b.discipline_id)
    }
  }

  // Latest sheet total per (category, sub-skill), and how many chains fed it.
  const sheetTotal = new Map<string, number>()
  const sheetCount = new Map<string, number>()
  for (const w of latestPerChain(sheets)) {
    const k = key(w.discipline_id, w.sub_skill_id)
    sheetTotal.set(k, n(sheetTotal.get(k)) + n(w.total_amount))
    sheetCount.set(k, (sheetCount.get(k) ?? 0) + 1)
  }

  const subsOf = new Map<string, SubSkillRef[]>()
  for (const s of subSkills) {
    const arr = subsOf.get(s.discipline_id) ?? []
    arr.push(s)
    subsOf.set(s.discipline_id, arr)
  }

  const catLines: CategoryLine[] = categories.map(cat => {
    const hasRoot = rootLineFor.has(cat.id)
    const useRoot = hasRoot && !hasSubSkillMoney.has(cat.id)

    const subs: SubSkillLine[] = (subsOf.get(cat.id) ?? []).map(s => {
      const k = key(cat.id, s.id)
      const line = lineAt.get(k)
      const sheets = sheetTotal.get(k) ?? null
      const est = estimateForSubSkill(line, sheets, hasRoot)
      const budgetErp = line?.current_budget_amt ?? null
      const paid = line?.current_paid_amt ?? null
      return {
        subSkillId: s.id,
        code: s.code,
        name: s.name,
        sheetCount: sheetCount.get(k) ?? 0,
        estimateFromSheet: est.fromSheet,
        internalEstimate: est.amount,
        // Awaiting approval is a working-sheet state, not a budget-line one;
        // the loader fills it. Null here rather than 0 so an un-loaded value
        // is visibly absent instead of quietly reading as "nothing pending".
        awaitingApproval: null,
        budgetCtHub: null,
        budgetErp,
        woPo: line?.current_wo_committed_amt ?? null,
        paid,
        pctUsed: usedPct(paid, budgetErp),
      }
    })

    // Category totals roll up from the sub-skills, EXCEPT where the category's
    // own root line is the only money it has.
    const root = useRoot ? rootLineFor.get(cat.id) : undefined
    const sum = (pick: (l: SubSkillLine) => number | null) =>
      subs.reduce<number | null>((acc, l) => addNullable(acc, pick(l)), null)

    const internalEstimate = useRoot
      ? addNullable(sum(l => l.internalEstimate), root?.internal_estimate_amt ?? null)
      : hasRoot
        // A root line exists but the category also carries sub-skill money, so
        // the root is the summary row — its estimate still counts once, and the
        // sheets under it were already skipped by estimateForSubSkill.
        ? addNullable(sum(l => l.internalEstimate), rootLineFor.get(cat.id)?.internal_estimate_amt ?? null)
        : sum(l => l.internalEstimate)
    const budgetErp = useRoot ? (root?.current_budget_amt ?? null) : sum(l => l.budgetErp)
    const woPo = useRoot ? (root?.current_wo_committed_amt ?? null) : sum(l => l.woPo)
    const paid = useRoot ? (root?.current_paid_amt ?? null) : sum(l => l.paid)

    const line: CategoryLine = {
      disciplineId: cat.id,
      code: cat.code,
      name: cat.name,
      sheetCount: subs.reduce((t, s) => t + s.sheetCount, 0),
      subSkills: subs,
      internalEstimate,
      awaitingApproval: null,
      budgetCtHub: null,
      budgetErp,
      woPo,
      paid,
      pctUsed: usedPct(paid, budgetErp),
      isEmpty: internalEstimate == null && budgetErp == null && woPo == null && paid == null,
    }
    return line
  })

  const total = (pick: (c: CategoryLine) => number | null) =>
    catLines.reduce<number | null>((acc, c) => addNullable(acc, pick(c)), null)
  const totalErp = total(c => c.budgetErp)
  const totalPaid = total(c => c.paid)

  return {
    categories: catLines,
    emptyCount: catLines.filter(c => c.isEmpty).length,
    totals: {
      internalEstimate: total(c => c.internalEstimate),
      awaitingApproval: total(c => c.awaitingApproval),
      budgetCtHub: total(c => c.budgetCtHub),
      budgetErp: totalErp,
      woPo: total(c => c.woPo),
      paid: totalPaid,
      pctUsed: usedPct(totalPaid, totalErp),
    },
  }
}

/** The five header figures, in the order the preview shows them. */
export interface Kpi {
  label: string
  amount: number | null
  /** Null when the project has no area — ₹/sft is then genuinely unknowable. */
  perSft: number | null
  context: string
  tone: 'ie' | 'awaiting' | 'budget' | 'wo' | 'paid'
}

export function buildKpis(totals: MoneyRow, areaSft: number | null): Kpi[] {
  const per = (v: number | null): number | null =>
    v == null || !areaSft || areaSft <= 0 ? null : Math.round(v / areaSft)
  const share = (a: number | null, b: number | null): string | null => {
    if (a == null || b == null || b === 0) return null
    return `${Math.round((a / b) * 100)}%`
  }
  const releasedPct = share(totals.budgetErp, totals.internalEstimate)
  const committedPct = share(totals.woPo, totals.budgetErp)
  const paidPct = share(totals.paid, totals.budgetErp)

  return [
    { label: 'INTERNAL ESTIMATE', amount: totals.internalEstimate, perSft: per(totals.internalEstimate),
      context: 'Maintained estimate (latest per item)', tone: 'ie' },
    { label: 'AWAITING APPROVAL', amount: totals.awaitingApproval, perSft: per(totals.awaitingApproval),
      context: totals.awaitingApproval ? 'In the sign-off chain' : 'Nothing pending', tone: 'awaiting' },
    { label: 'APPROVED BUDGET (ERP)', amount: totals.budgetErp, perSft: per(totals.budgetErp),
      context: releasedPct ? `${releasedPct} of estimate released` : 'No estimate to compare', tone: 'budget' },
    { label: 'COMMITTED (WO/PO)', amount: totals.woPo, perSft: per(totals.woPo),
      context: committedPct ? `${committedPct} of budget` : 'No budget to compare', tone: 'wo' },
    { label: 'PAID TO DATE', amount: totals.paid, perSft: per(totals.paid),
      context: paidPct ? `${paidPct} of ERP budget` : 'No budget to compare', tone: 'paid' },
  ]
}
