// Real NGH B rows, pulled from the live database on 6 September 2026 — the
// case the Budget vs Actual figures are pinned against (build order §10: every
// figure-producing function gets a test with a real IN4 case and its expected
// rupee value).
//
// Project: NGH B (551a8314-84f7-426a-a0d5-20590830c62e), 65,400 sft.
// 34 `cc_budget_lines` rows and 54 live `cc_working_sheets` rows.
//
// Ids are the real UUIDs shortened to their first 8 characters — they are
// opaque keys here, every prefix is distinct within this fixture, and the full
// ones made the file unreadable. Every sheet in this snapshot is version 1 of
// its own chain, so the anchor is the row's own id.

import type { BudgetLineRow, SheetRow, CategoryRef, SubSkillRef } from './budget-actual'

/** [category, sub-skill (null = the category-level row), internal estimate, ERP budget, WO/PO, paid] */
const LINES: Array<[string, string | null, number, number, number, number]> = [
  ['28363b46', 'f2fe9dba', 25037, 25037, 22562.29, 0],
  ['c9d78f64', 'ca22546d', 821600, 821600, 821581.75, 0],
  ['c9d78f64', 'ea4f5325', 1346110, 1346110, 1346022.61, 0],
  ['b092a653', null, 1726503, 1726503, 1726502.84, 1639477.84],
  ['a3162919', null, 566463, 566463, 566429.5, 566429.5],
  ['c9d78f64', 'c9f08d43', 240889, 240889, 240888.04, 240888.04],
  ['760110b0', '74f8ca72', 100000, 100000, 72455.26, 0],
  ['760110b0', '133f363d', 3825035.01, 3825035.01, 2252136.47, 2252136],
  ['42676d6e', '285037e1', 86780, 86780, 83780, 83780],
  ['bec27f41', 'dff2a8f7', 55000, 55000, 0, 0],
  ['42676d6e', '12ed8447', 2610545.01, 2610545.01, 1201285.22, 764774],
  ['42676d6e', '0f474345', 5170, 5170, 2986.87, 2986.87],
  ['42676d6e', 'c3e93a23', 118114151, 118114151, 73311552.92, 69796324.68],
  ['c9d78f64', '52871d97', 3903800, 3903800, 3901835.28, 0],
  ['28363b46', '8b5fb814', 175000, 175000, 41000, 41000],
  ['760110b0', 'e4d4ecaf', 323400, 323400, 117678.21, 76673],
  ['7fd30bb9', 'aa946fc0', 159300, 159300, 159300, 159300],
  ['42676d6e', 'f156012e', 5165813, 5165813, 3433061.68, 3433061.66],
  ['760110b0', '7a6867e5', 63565, 63565, 63555.96, 63556],
  ['bec27f41', 'dfd96a69', 562500, 562500, 553207.22, 0],
  ['760110b0', '4d1a16f9', 2781005, 2781005, 2781001.08, 0],
  ['5fcc65e9', 'e3944c22', 6620695, 6620695, 2821500, 0],
  ['465625cd', '048f5db9', 925000.01, 925000.01, 775560, 774288.4],
  ['5fcc65e9', '7adc5842', 4079840, 4079840, 1696861.45, 692162],
  ['465625cd', 'e50dd99d', 545000, 545000, 415805.7, 415806],
  ['5fcc65e9', '975e58bc', 1850000, 1850000, 0, 0],
  ['465625cd', '0e84d50e', 5100000, 5100000.01, 534668.29, 527943.8],
  ['5fcc65e9', '461672f8', 5800000, 5800000, 5787000, 0],
  ['465625cd', 'e9db497d', 1800000, 1800000, 1792000, 0],
  ['5fcc65e9', '7e1d6491', 6800000, 6800000, 3960010, 0],
  ['bec27f41', '723a10b0', 550000.01, 550000.01, 34856.21, 35034],
  ['54fa98e7', '7d393e6c', 244400, 244400, 168471.2, 85524.8],
  ['bec27f41', '9b122d1e', 1250000, 1250000, 104322.63, 102664],
  ['7fd30bb9', '48f39cc5', 50000, 50000, 2065, 2065],
]

/** [sheet id, category, sub-skill, status, total amount] */
const SHEETS: Array<[string, string, string, string, number]> = [
  ['f74e9389', '15af1275', '499c2e63', 'draft', 65400],
  ['c6867833', '19bf1630', 'dd7d114d', 'draft', 654000],
  ['23994fca', '22ec0071', '727b05f5', 'draft', 3270000],
  ['1e1b28ec', '28363b46', '5347481d', 'draft', 100000],
  ['6e2244a1', '28363b46', '55afa1bf', 'draft', 100000],
  ['c382d6db', '28363b46', '8b5fb814', 'draft', 300000],
  ['b1f2104e', '28363b46', 'f2fe9dba', 'draft', 100000],
  ['418de37e', '28363b46', 'f2fe9dba', 'approved', 25037],
  ['7c58defb', '3c2117d9', '567a2075', 'draft', 9000000],
  ['1a9b2672', '3c2117d9', '916d79b8', 'draft', 3132000],
  ['c2d9fe6d', '42676d6e', '12ed8447', 'draft', 2677951.9],
  ['208daaa3', '42676d6e', '285037e1', 'draft', 87000],
  ['5f9c93b5', '42676d6e', '8ca86e87', 'draft', 500000],
  ['34414d8a', '42676d6e', 'c3e93a23', 'draft', 77654035.19],
  ['55437a20', '465625cd', '61e1695f', 'draft', 8549100],
  ['979e7a67', '4e975047', 'fe7c665b', 'draft', 1200000],
  ['401f8856', '5260b795', '1a25a05d', 'draft', 5000000],
  ['e239c322', '54fa98e7', '7d393e6c', 'draft', 654000],
  ['360021ff', '5fcc65e9', '0dfd3fb2', 'draft', 2200000],
  ['7071cce9', '5fcc65e9', '37e3a093', 'draft', 1200000],
  ['a7b6c78b', '5fcc65e9', '461672f8', 'draft', 5201166.94],
  ['32ec0a08', '5fcc65e9', '5a350147', 'draft', 7700371.13],
  ['933065a8', '5fcc65e9', '7adc5842', 'draft', 4783955.91],
  ['25d57dc9', '5fcc65e9', '7b05b752', 'draft', 966632.4],
  ['30111b57', '5fcc65e9', '7e1d6491', 'draft', 2845554.93],
  ['9f08a8b3', '5fcc65e9', '975e58bc', 'draft', 1183434.33],
  ['170e7ed0', '5fcc65e9', 'e3944c22', 'draft', 6335606.12],
  ['f91d273c', '5fcc65e9', 'e478e257', 'draft', 5532919.7],
  ['f2417b92', '68ab7a07', '92c0521d', 'draft', 2500493],
  ['78da1177', '68ab7a07', 'cab9990c', 'draft', 500000],
  ['546e01f0', '760110b0', '74f8ca72', 'draft', 19620000],
  ['eacb2668', '7fd30bb9', '30d899b9', 'draft', 2000000],
  ['89ec031c', '7fd30bb9', '48f39cc5', 'draft', 60000],
  ['29162910', '7fd30bb9', 'aa946fc0', 'draft', 500000],
  ['11bd5ba3', '7fd30bb9', 'b403b564', 'draft', 1200000],
  ['548782d5', '7fd30bb9', 'baeb21ff', 'draft', 5000000],
  ['4b6858c7', '7fd30bb9', 'f497b775', 'draft', 400000],
  // The two sheets that sit under a category-level budget line. Counting these
  // on top of their category line is the ₹22,93,000 double-count §2 warns about.
  ['4c64e3bf', 'a3162919', '1a9c00dc', 'draft', 566463],
  ['f3141c8f', 'b092a653', '5a176cce', 'draft', 1726503],
  ['b2fbef49', 'bb007db3', '139f147d', 'draft', 651920.5],
  ['034b3673', 'bb007db3', 'e34e6844', 'draft', 3060684],
  ['a82aa4f0', 'bec27f41', '723a10b0', 'draft', 560278.16],
  ['5fe8be61', 'bec27f41', '7ae516f0', 'draft', 1085623.6],
  ['8c2fe08f', 'bec27f41', '9b122d1e', 'draft', 1553723.19],
  ['8b6ddf4e', 'bec27f41', 'dfd96a69', 'approved', 137500],
  ['747960e2', 'bec27f41', 'dff2a8f7', 'draft', 1635.48],
  ['96dbbb93', 'c9d78f64', '52871d97', 'draft', 3537112.54],
  ['8faf5348', 'c9d78f64', 'c71c8c46', 'draft', 250000],
  ['5f446c85', 'c9d78f64', 'ca22546d', 'draft', 1238998.58],
  ['701f700f', 'c9d78f64', 'ea4f5325', 'draft', 2715444.08],
  ['42a8beb3', 'e8c99a6d', '03e7ab64', 'draft', 3692220],
  ['2e3959a4', 'e8c99a6d', '0d2046dc', 'draft', 4306558],
  ['48eadcb3', 'f4f70082', '7ef28fbe', 'draft', 1000000],
  ['fd408186', 'f5a4f8eb', 'e94b12b6', 'draft', 654000],
]

export const nghbBudgetLines: BudgetLineRow[] = LINES.map(([d, s, ie, erp, wo, paid]) => ({
  discipline_id: d,
  sub_skill_id: s,
  internal_estimate_amt: ie,
  current_budget_amt: erp,
  current_wo_committed_amt: wo,
  current_paid_amt: paid,
}))

export const nghbSheets: SheetRow[] = SHEETS.map(([id, d, s, status, total]) => ({
  id,
  discipline_id: d,
  sub_skill_id: s,
  status,
  total_amount: total,
  chain_anchor_id: id,
  version_no: 1,
}))

/** NGH B's built-up area, from `projects.built_up_sft`. */
export const NGHB_AREA_SFT = 65400

/**
 * Category and sub-skill lists, derived from the ids that appear above.
 *
 * The real master carries display names; the money does not depend on them, so
 * the fixture stays about the figures. Every (category, sub-skill) pair that
 * either a budget line or a sheet mentions is present, which is what decides
 * whether a row is counted.
 */
export function nghbRefs(): { categories: CategoryRef[]; subSkills: SubSkillRef[] } {
  const cats = new Set<string>()
  const subs = new Map<string, string>() // sub-skill → category
  for (const [d, s] of LINES) { cats.add(d); if (s) subs.set(s, d) }
  for (const [, d, s] of SHEETS) { cats.add(d); subs.set(s, d) }
  return {
    categories: [...cats].sort().map(id => ({ id, code: id.slice(0, 2), name: id })),
    subSkills: [...subs.entries()].sort().map(([id, discipline_id]) => ({
      id, discipline_id, code: id.slice(0, 2), name: id,
    })),
  }
}
