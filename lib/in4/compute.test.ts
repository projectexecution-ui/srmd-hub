import { describe, it, expect } from 'vitest'
import { buildReports, splitCode, cleanLabel } from './compute'
import type { In4Extract } from './extract'

// Fixture: NGH A (sub-project 43) reduced to the lines that exercise every rule,
// with the figures IN4 held on 4 Sept 2026. The expected values are the ones the
// hub had stored from Aksha's own upload of the Excel.
const SP = 43
const base = (): In4Extract => ({
  projects: [], subprojects: [], materialTypes: [
    { id: 203, kind: 'type', parent_id: null, name: '03 (M) Civil', is_active: true },
    { id: 796, kind: 'subtype', parent_id: 203, name: '310 (M) Door & Window Sills', is_active: true },
    { id: 791, kind: 'subtype', parent_id: 203, name: '305 (M) Masonry Works', is_active: true },
    { id: 235, kind: 'type', parent_id: null, name: '01 (A) Site Pre-lims', is_active: true },
    // same id as type 203 — must never be confused with it
    { id: 203, kind: 'subtype', parent_id: 999, name: 'Some unrelated sub-type', is_active: true },
  ],
  skills: [
    { id: 1,   name: '03 Civil',                 parent_id: 0,   short_name: null, is_active: true },
    { id: 243, name: '317 Civil Contractor Cost', parent_id: 1,   short_name: null, is_active: true },
    { id: 422, name: '310 Door & Window Sills',   parent_id: 1,   short_name: null, is_active: true },
    { id: 416, name: '305 Masonry Works',         parent_id: 1,   short_name: null, is_active: true },
    { id: 307, name: '05 Waterproofing Works',    parent_id: 0,   short_name: null, is_active: true },
    { id: 311, name: '501 Building & Terrace Waterproofing Works', parent_id: 307, short_name: null, is_active: true },
    { id: 313, name: '502 Balcony Water-proofing - Chemical',      parent_id: 307, short_name: null, is_active: true },
    { id: 316, name: '503 Toilets & Other Areas Waterproofing',    parent_id: 307, short_name: null, is_active: true },
    { id: 338, name: '12 Finishes',               parent_id: 0,   short_name: null, is_active: true },
    { id: 351, name: '1207 False Ceiling Works',  parent_id: 338, short_name: null, is_active: true },
    { id: 354, name: '1209 Painting',             parent_id: 338, short_name: null, is_active: true },
  ],
  budgetWc: [
    // category rows carry the category total; sub-skill rows their share
    { subproject_id: SP, budget_period_id: 1701, skill_id: 1,   parent_id: 0,   budget_allocated: 77_400_310 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 243, parent_id: 1,   budget_allocated: 76_700_000 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 422, parent_id: 1,   budget_allocated: 700_310 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 307, parent_id: 0,   budget_allocated: 6_400_000 },   // 34,000 more than its sub-skills
    { subproject_id: SP, budget_period_id: 1701, skill_id: 311, parent_id: 307, budget_allocated: 3_021_400 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 313, parent_id: 307, budget_allocated: 1_507_500 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 316, parent_id: 307, budget_allocated: 1_837_100 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 338, parent_id: 0,   budget_allocated: 8_100_000 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 351, parent_id: 338, budget_allocated: 5_200_000 },
    { subproject_id: SP, budget_period_id: 1701, skill_id: 354, parent_id: 338, budget_allocated: 2_900_000 },
  ],
  budgetMat: [
    { subproject_id: SP, budget_period_id: 1701, material_type_id: 203, material_subtype_id: 0,   budget_allocated: 1_146_638.01 }, // type total — must be ignored
    { subproject_id: SP, budget_period_id: 1701, material_type_id: 203, material_subtype_id: 791, budget_allocated: 70_000 },
    { subproject_id: SP, budget_period_id: 1701, material_type_id: 203, material_subtype_id: 796, budget_allocated: 1_076_638.01 },
    { subproject_id: SP, budget_period_id: 1701, material_type_id: 235, material_subtype_id: 0,   budget_allocated: 52_000.12 },     // type with no sub-type rows → category line
  ],
  workOrders: [
    { wo_id: 624,  subproject_id: SP, category_id: 1,   subcategory_id: 243, status: 2, display_no: null, contractor_id: null, wo_value: 56_487_314.29, wo_gross_value: 66_655_030.87, wo_paid_amt: 0, wo_advance_balance_amt: 531_394.15 },
    { wo_id: 1710, subproject_id: SP, category_id: 307, subcategory_id: 0,   status: 2, display_no: null, contractor_id: null, wo_value: 5_229_106.65,  wo_gross_value: 6_170_345.85,  wo_paid_amt: 0, wo_advance_balance_amt: 0 },
    { wo_id: 1831, subproject_id: SP, category_id: 338, subcategory_id: 351, status: 2, display_no: null, contractor_id: null, wo_value: 5_118_500, wo_gross_value: 5_118_500, wo_paid_amt: 0, wo_advance_balance_amt: 1_791_475 },
    { wo_id: 1925, subproject_id: SP, category_id: 338, subcategory_id: 354, status: 2, display_no: null, contractor_id: null, wo_value: 1_975_000, wo_gross_value: 1_975_000, wo_paid_amt: 0, wo_advance_balance_amt: 987_500 },
    { wo_id: 1926, subproject_id: SP, category_id: 338, subcategory_id: 354, status: 2, display_no: null, contractor_id: null, wo_value: 899_250,   wo_gross_value: 899_250,   wo_paid_amt: 0, wo_advance_balance_amt: 750_000 },
    { wo_id: 9999, subproject_id: SP, category_id: 1,   subcategory_id: 243, status: 66, display_no: null, contractor_id: null, wo_value: 1e9, wo_gross_value: 1e9, wo_paid_amt: 0, wo_advance_balance_amt: 0 }, // terminated — ignored
  ],
  // The waterproofing WO's BOQ, summed per sub-skill (what the report splits by).
  boqShares: [
    { wo_id: 1710, subcategory_id: 311, amt: 2_439_668.55 },
    { wo_id: 1710, subcategory_id: 313, amt: 1_232_608.80 },
    { wo_id: 1710, subcategory_id: 316, amt: 1_556_829.30 },
  ],
  certificates: [
    { certificate_id: 1, wo_id: 624, subproject_id: SP, category_id: 1, subcategory_id: 243, status: 75, gross_bill_amt: 66_655_030.85, certified_amt: 0, paid_amt: 53_728_162.46, advance_recovery_amt: 0 },
    { certificate_id: 2, wo_id: 624, subproject_id: SP, category_id: 1, subcategory_id: 243, status: 3,  gross_bill_amt: 5e6, certified_amt: 0, paid_amt: 0, advance_recovery_amt: 0 }, // rejected — ignored
  ],
  supplier: [
    { subproject_id: SP, skill_id: 1, subskill_id: 416, grn_amount: 69_502, certified_amt: 0, tax_amount: 0, landed_cost: 69_502, paid_amt: 69_502 },
    { subproject_id: SP, skill_id: 1, subskill_id: 422, grn_amount: 17_936, certified_amt: 0, tax_amount: 0, landed_cost: 0,      paid_amt: 0 },
  ],
})

const sub = (r: ReturnType<typeof buildReports>, code: string) => r.get(SP)!.subRows.find(s => s.subNum === code)!
const cat = (r: ReturnType<typeof buildReports>, code: string) => r.get(SP)!.rows.find(s => s.catNum === code)!

describe('splitCode / cleanLabel', () => {
  it('reads the numeric prefix the hub keys on', () => {
    expect(splitCode('03 Civil')).toEqual({ code: '03', label: 'Civil' })
    expect(splitCode('23  Equipment Cost')).toEqual({ code: '23', label: 'Equipment Cost' })
    expect(splitCode('Consultants Cost')).toEqual({ code: '', label: 'Consultants Cost' })
  })
  it('drops only the (M) marker, like public/budget-hub.html', () => {
    expect(cleanLabel('310 (M) Door & Window Sills')).toBe('310 Door & Window Sills')
    expect(cleanLabel('01 (A) Site Pre-lims')).toBe('01 (A) Site Pre-lims')
  })
})

describe('buildReports — NGH A rules, checked against the stored upload', () => {
  const r = buildReports(base())

  it('merges the material budget into the contractor sub-skill (310 = 7,00,310 + 10,76,638)', () => {
    expect(sub(r, '310').budget).toBeCloseTo(1_776_948.01, 2)
    expect(sub(r, '305').budget).toBe(70_000)
    expect(sub(r, '317').budget).toBe(76_700_000)
  })
  it('ignores the material type total row when sub-type rows exist, keeps it when they do not', () => {
    expect(cat(r, '03').budget).toBeCloseTo(78_546_948.01, 2)   // 76,700,000 + 700,310 + 70,000 + 1,076,638.01
    expect(cat(r, '01').budget).toBeCloseTo(52_000.12, 2)       // type 235 has no sub-types
  })
  it('splits a category-level WO across sub-skills by BOQ share — to the paisa', () => {
    expect(sub(r, '501').woApproved).toBeCloseTo(2_878_808.89, 1)
    expect(sub(r, '502').woApproved).toBeCloseTo(1_454_478.38, 1)
    expect(sub(r, '503').woApproved).toBeCloseTo(1_837_058.57, 1)
    expect(cat(r, '05').woApproved).toBeCloseTo(6_170_345.85, 1)
    expect(cat(r, '05').budget).toBe(6_400_000)                  // 34,000 category line + three sub-skills
  })
  it('WO/PO Approved on the material side is the GRN value', () => {
    expect(sub(r, '305').woApproved).toBe(69_502)
    expect(sub(r, '310').woApproved).toBe(17_936)
    expect(cat(r, '03').woApproved).toBeCloseTo(66_742_468.87, 1)
  })
  it('actual per sub-skill is max(paid, gross); a GRN not yet certified shows 0', () => {
    expect(sub(r, '317').actual).toBeCloseTo(66_655_030.85, 2)
    expect(sub(r, '305').actual).toBe(69_502)
    expect(sub(r, '310').actual).toBe(0)
  })
  it('actual per category adds the WO advance balance (12 Finishes = advances only)', () => {
    expect(cat(r, '12').actual).toBe(3_528_975)
    expect(cat(r, '12').woApproved).toBe(7_992_750)
    expect(cat(r, '03').actual).toBeCloseTo(66_655_030.85 + 69_502 + 531_394.15, 1)
  })
  it('leaves terminated work orders and rejected certificates out', () => {
    expect(sub(r, '317').woApproved).toBeCloseTo(66_655_030.87, 2)
    expect(sub(r, '317').actual).toBeCloseTo(66_655_030.85, 2)
  })
  it('orders rows and sub-rows numerically and names them like the Excel', () => {
    expect(r.get(SP)!.rows.map(x => x.catNum)).toEqual(['01', '03', '05', '12'])
    expect(sub(r, '317').head).toBe('317 Civil Contractor Cost')
    expect(cat(r, '03').head).toBe('03 Civil')
  })
  it('can be limited to a set of sub-projects', () => {
    expect(buildReports(base(), new Set([1])).size).toBe(0)
    expect(buildReports(base(), new Set([SP])).size).toBe(1)
  })
})
