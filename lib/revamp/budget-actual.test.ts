import { describe, it, expect } from 'vitest'
import {
  buildBudgetActual, buildKpis, estimateForSubSkill, latestPerChain, usedPct,
  type BudgetLineRow, type SheetRow,
} from './budget-actual'
import { nghbBudgetLines, nghbSheets, nghbRefs, NGHB_AREA_SFT } from './budget-actual.fixtures'

const build = () => buildBudgetActual({ ...nghbRefs(), budgetLines: nghbBudgetLines, sheets: nghbSheets })
const rupees = (v: number | null) => (v == null ? null : Math.round(v))

/**
 * The check case from the build order §2: NGH B, reproduced to the rupee.
 *
 * Two of the four published check figures do not reconcile with the stated
 * rule, and both are traced below. The assertions pin what CT Hub itself
 * shows, because §2's requirement is "reproduces CT HUB to the rupee" — the
 * preview is the layout reference, not the arithmetic authority.
 */
describe('NGH B — Budget vs Actual against CT Hub', () => {
  it('internal estimate is ₹25,37,44,523', () => {
    // The build order prints ₹25,37,44,524. The preview's own footnote says it
    // is ₹1 above "its ₹25,37,44,523", which is CT Hub's figure: the preview
    // rounds each category and then adds, this rounds the sum. Rounding once
    // at the end is what CT Hub does.
    expect(rupees(build().totals.internalEstimate)).toBe(253744523)
  })

  it('approved ERP budget is ₹17,82,72,601', () => {
    expect(rupees(build().totals.budgetErp)).toBe(178272601)
  })

  it('paid is ₹8,17,55,876', () => {
    expect(rupees(build().totals.paid)).toBe(81755876)
  })

  it('WO/PO is ₹11,07,91,944 — not the ₹11,07,69,381 in the build order', () => {
    // The gap is ₹22,562.29: the one Site Pre-lims budget line whose committed
    // amount the preview leaves out of that category, showing its paid figure
    // (₹41,000) in the WO/PO column instead. Both budget lines carry committed
    // money — 22,562.29 + 41,000 — so the category is ₹63,562 and the project
    // ₹11,07,91,944. Raised, not coded around (§9).
    expect(rupees(build().totals.woPo)).toBe(110791944)
  })

  it('Site Pre-lims: the category behind that gap', () => {
    const cat = build().categories.find(c => c.disciplineId === '28363b46')!
    expect(rupees(cat.internalEstimate)).toBe(400037)  // matches the preview
    expect(rupees(cat.budgetErp)).toBe(200037)         // matches the preview
    expect(rupees(cat.paid)).toBe(41000)               // matches the preview
    expect(rupees(cat.woPo)).toBe(63562)               // the preview shows 41,000
  })

  it('% used is paid ÷ ERP budget, never a re-derived figure', () => {
    expect(build().totals.pctUsed).toBe(46)
  })
})

describe('the double-count §2 warns about', () => {
  it('a sheet under a category-level budget line is not added on top', () => {
    // Equipment Cost (b092a653) and Delay in Drawings (a3162919) each hold a
    // category-level line AND a sheet for the same money. Counting both adds
    // ₹22,93,000 that does not exist.
    const cats = build().categories
    const equipment = cats.find(c => c.disciplineId === 'b092a653')!
    const delay = cats.find(c => c.disciplineId === 'a3162919')!
    expect(rupees(equipment.internalEstimate)).toBe(1726503)
    expect(rupees(delay.internalEstimate)).toBe(566463)
    expect(rupees(equipment.internalEstimate! + delay.internalEstimate!)).toBe(2292966)
  })

  it('adding the sheets on top would overstate the project by ₹22,92,966', () => {
    const withRule = build().totals.internalEstimate!
    // Same inputs, with the guard removed: the sheets under those two
    // categories now land on top of their category lines.
    const naive = buildBudgetActual({
      ...nghbRefs(),
      budgetLines: nghbBudgetLines.filter(l => l.sub_skill_id !== null),
      sheets: nghbSheets,
    })
    const rootMoney = 1726503 + 566463
    expect(rupees(naive.totals.internalEstimate! + rootMoney - withRule)).toBe(2292966)
  })
})

describe('estimateForSubSkill — the rule, stated once', () => {
  const line = (ie: number | null): BudgetLineRow => ({
    discipline_id: 'd', sub_skill_id: 's', internal_estimate_amt: ie,
    current_budget_amt: null, current_wo_committed_amt: null, current_paid_amt: null,
  })

  it('prefers the maintained estimate over the sheet', () => {
    expect(estimateForSubSkill(line(175000), 300000, false)).toEqual({ amount: 175000, fromSheet: false })
  })

  it('falls back to the latest sheet where no estimate is maintained', () => {
    expect(estimateForSubSkill(undefined, 100000, false)).toEqual({ amount: 100000, fromSheet: true })
  })

  it('counts a sub-skill that has a sheet but no budget line at all', () => {
    // Dropping these would lose real estimate — on NGH B they are ₹7.55 Cr.
    expect(estimateForSubSkill(undefined, 8549100, false).amount).toBe(8549100)
  })

  it('skips the sheet where the category carries a root line', () => {
    expect(estimateForSubSkill(undefined, 1726503, true)).toEqual({ amount: null, fromSheet: false })
  })

  it('a maintained estimate of zero is a figure, not a missing value', () => {
    expect(estimateForSubSkill(line(0), 500000, false)).toEqual({ amount: 0, fromSheet: false })
  })

  it('returns null, never 0, when nothing is known', () => {
    expect(estimateForSubSkill(undefined, null, false).amount).toBeNull()
  })
})

describe('latestPerChain', () => {
  const s = (id: string, anchor: string, ver: number, total: number, status = 'draft'): SheetRow =>
    ({ id, discipline_id: 'd', sub_skill_id: 'x', status, total_amount: total, chain_anchor_id: anchor, version_no: ver })

  it('keeps only the latest version of a revision chain', () => {
    const rows = latestPerChain([s('v1', 'v1', 1, 100), s('v2', 'v1', 2, 250)])
    expect(rows.map(r => r.total_amount)).toEqual([250])
  })

  it('drops cancelled sheets entirely', () => {
    expect(latestPerChain([s('a', 'a', 1, 100, 'cancelled')])).toEqual([])
  })

  it('treats a sheet with no chain as its own singleton', () => {
    const rows = latestPerChain([
      { id: 'lone', discipline_id: 'd', sub_skill_id: 'x', status: 'draft', total_amount: 42 },
    ])
    expect(rows).toHaveLength(1)
  })

  it('two sheets on one sub-skill in different chains both count', () => {
    // NGH B's Site Pre-lims f2fe9dba is exactly this: a ₹1,00,000 draft and a
    // ₹25,037 approved sheet, separate chains, both live.
    expect(latestPerChain([s('a', 'a', 1, 100000), s('b', 'b', 1, 25037)])).toHaveLength(2)
  })
})

describe('no derived figures (§10)', () => {
  it('% used is null, not 0, when there is no ERP budget', () => {
    expect(usedPct(500, null)).toBeNull()
    expect(usedPct(500, 0)).toBeNull()
  })

  it('₹/sft is null when the project has no area', () => {
    const kpis = buildKpis(build().totals, null)
    expect(kpis.every(k => k.perSft === null)).toBe(true)
  })

  it('a category with nothing anywhere reports null, never zero', () => {
    const empty = buildBudgetActual({
      categories: [{ id: 'c', code: '01', name: 'Empty' }],
      subSkills: [{ id: 's', discipline_id: 'c', code: '01', name: 'Nothing' }],
      budgetLines: [], sheets: [],
    })
    expect(empty.categories[0].internalEstimate).toBeNull()
    expect(empty.categories[0].isEmpty).toBe(true)
    expect(empty.emptyCount).toBe(1)
  })
})

describe('the five KPIs', () => {
  it('carry ₹/sft against NGH B’s 65,400 sft', () => {
    const kpis = buildKpis(build().totals, NGHB_AREA_SFT)
    const by = (l: string) => kpis.find(k => k.label.startsWith(l))!
    expect(by('INTERNAL').perSft).toBe(3880)
    expect(by('APPROVED').perSft).toBe(2726)
    expect(by('PAID').perSft).toBe(1250)
  })

  it('state each share against the right denominator', () => {
    const kpis = buildKpis(build().totals, NGHB_AREA_SFT)
    expect(kpis.find(k => k.label.startsWith('APPROVED'))!.context).toBe('70% of estimate released')
    expect(kpis.find(k => k.label.startsWith('PAID'))!.context).toBe('46% of ERP budget')
  })
})
