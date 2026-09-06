// Rebuilding IN4's "SRMD Budget vs Expenses Report" from its tables.
//
// The report (ENGG_CONSOLIDATED_SRMDBUDGET_VS_EXPENSECUSTOM_REPORT, one Excel
// per sub-project) is what Aksha uploads every week. Its procedure is hidden
// from our login, so this file reproduces the five figures the hub reads from
// it — Budget, WO/PO/Misc Approved, Gross Bill, Paid, Advance Balance — from
// the BI facts, then shapes them exactly like public/budget-hub.html does when
// it parses the Excel: one `rows` entry per work category and one `subRows`
// entry per sub-skill, material (M) and contractor sides merged by code.
//
// Every rule below was checked against the stored upload of NGH A (sub-project
// 43) on 4 Sept 2026 — see docs/IN4_DB_MAPPING.md for the figures:
//
//   budget      = contractor budget line (current approved version)
//               + material budget lines (sub-type rows; type row only when a
//                 type has no sub-type rows)
//   woApproved  = WO gross value (incl. tax) split across sub-skills by the
//                 WO's BOQ item amounts, + material GRN value
//   gross       = contractor certificate gross bill + material landed cost
//   paid        = contractor certificate paid + material paid
//   actual      = max(paid, gross)            per sub-skill
//               = max(paid, gross + advance)  per category (advance balance is
//                 carried at category level in the report, never per sub-skill)
//
// Pure: no I/O, so it is unit-tested with fixtures rather than eyeballed.

import type { In4Extract, In4Skill, In4MaterialType } from './extract'

export interface ReportRow { head: string; budget: number; woApproved: number; actual: number; catNum: string }
export interface ReportSubRow extends ReportRow { subNum: string }
export interface SubprojectReport { subprojectId: number; rows: ReportRow[]; subRows: ReportSubRow[] }

/** Work-order statuses the report leaves out. */
const WO_EXCLUDED = new Set([6 /* Cancelled */, 66 /* Terminated */])
/** Certificate statuses the report leaves out. */
const CERT_EXCLUDED = new Set([3 /* Rejected */, 6 /* Cancelled */])

/** "03 Civil" → { code: "03", label: "Civil" }; "23  Equipment Cost" → "23". */
export function splitCode(name: string): { code: string; label: string } {
  const m = name.trim().match(/^(\d+)\s*(.*)$/)
  return m ? { code: m[1], label: m[2].trim() } : { code: '', label: name.trim() }
}
/** The hub drops "(M)" from a material name and keeps everything else. */
export function cleanLabel(name: string): string {
  return name.replace(/\s*\(M\)\s*/i, ' ').replace(/\s+/g, ' ').trim()
}

interface Acc { budget: number; wo: number; gross: number; paid: number; adv: number; label: string }
const acc = (label: string): Acc => ({ budget: 0, wo: 0, gross: 0, paid: 0, adv: 0, label })
const r2 = (v: number) => Math.round(v * 100) / 100

export function buildReports(x: In4Extract, only?: Set<number>): Map<number, SubprojectReport> {
  const skillById = new Map<number, In4Skill>(x.skills.map(s => [s.id, s]))
  // Types and sub-types are separate lookups with overlapping ids — one map
  // for both put "07 (M) Electrical Works" under a sub-type's name and sent
  // NGH B's material budget to a category called "3".
  const matTypeById = new Map<number, In4MaterialType>(x.materialTypes.filter(m => m.kind === 'type').map(m => [m.id, m]))
  const matSubById = new Map<number, In4MaterialType>(x.materialTypes.filter(m => m.kind === 'subtype').map(m => [m.id, m]))
  const want = (sp: number) => !only || only.has(sp)

  // key = `${sp}|${catCode}|${subCode}`  (subCode '' = the category-level line)
  const lines = new Map<string, Acc>()
  const catLabel = new Map<string, string>()   // `${sp}|${catCode}` → label
  const line = (sp: number, catCode: string, subCode: string, label: string): Acc => {
    const k = `${sp}|${catCode}|${subCode}`
    let a = lines.get(k)
    if (!a) { a = acc(label); lines.set(k, a) }
    else if (!a.label && label) a.label = label
    return a
  }
  const noteCat = (sp: number, catCode: string, label: string) => {
    const k = `${sp}|${catCode}`
    if (label && !catLabel.get(k)) catLabel.set(k, label)
  }

  // Contractor-side codes come from the skills lookup; the hub reads the same
  // numeric prefix off the Excel, so the two agree by construction.
  const skillCodes = (catId: number, subId: number) => {
    const cat = skillById.get(catId)
    const sub = subId && subId !== catId ? skillById.get(subId) : undefined
    const c = cat ? splitCode(cat.name) : { code: '', label: '' }
    const s = sub ? splitCode(sub.name) : { code: '', label: '' }
    // Labels WITHOUT their code — the head is rebuilt as "code label" below,
    // exactly as the Excel prints it.
    return { catCode: c.code, catLabel: cat ? splitCode(cleanLabel(cat.name)).label : '', subCode: s.code, subLabel: sub ? splitCode(cleanLabel(sub.name)).label : '' }
  }
  const put = (sp: number, catId: number, subId: number, f: (a: Acc) => void) => {
    if (!want(sp)) return
    const k = skillCodes(catId, subId)
    if (!k.catCode) return
    noteCat(sp, k.catCode, k.catLabel)
    f(line(sp, k.catCode, k.subCode, k.subLabel))
  }

  // ── Contractor budget ──────────────────────────────────────────────────────
  // Sub-skill rows are the lines. A category row is the category's total; the
  // part of it not explained by its sub-skill rows is a line the report shows
  // at category level (NGH A's "05 Waterproofing Works" carries ₹34,000 of its
  // own above the three sub-skills). A category with no sub-skill rows at all
  // (23 Equipment Cost) is simply a category-level line.
  const subBudgetByCat = new Map<string, number>()
  for (const b of x.budgetWc) {
    if (!b.parent_id) continue
    put(b.subproject_id, b.parent_id, b.skill_id, a => { a.budget += b.budget_allocated })
    const k = `${b.subproject_id}|${b.parent_id}`
    subBudgetByCat.set(k, (subBudgetByCat.get(k) ?? 0) + b.budget_allocated)
  }
  for (const b of x.budgetWc) {
    if (b.parent_id) continue
    const residual = b.budget_allocated - (subBudgetByCat.get(`${b.subproject_id}|${b.skill_id}`) ?? 0)
    put(b.subproject_id, b.skill_id, 0, a => { if (Math.abs(residual) >= 0.5) a.budget += residual })
  }

  // ── Material budget (keyed by material type / sub-type code) ───────────────
  const matSubTypes = new Set<string>()  // `${sp}|${typeId}` that have sub-type rows
  for (const b of x.budgetMat) if (b.material_subtype_id) matSubTypes.add(`${b.subproject_id}|${b.material_type_id}`)
  for (const b of x.budgetMat) {
    if (!want(b.subproject_id)) continue
    const type = matTypeById.get(b.material_type_id)
    if (!type) continue
    const tc = splitCode(type.name)
    if (!tc.code) continue
    noteCat(b.subproject_id, tc.code, splitCode(cleanLabel(type.name)).label)
    if (b.material_subtype_id) {
      const st = matSubById.get(b.material_subtype_id)
      const sc = st ? splitCode(st.name) : { code: '', label: '' }
      line(b.subproject_id, tc.code, sc.code, st ? splitCode(cleanLabel(st.name)).label : '').budget += b.budget_allocated
    } else if (!matSubTypes.has(`${b.subproject_id}|${b.material_type_id}`)) {
      line(b.subproject_id, tc.code, '', '').budget += b.budget_allocated
    }
  }

  // ── Work orders: gross value split by BOQ share; advance at category level ─
  const sharesByWo = new Map<number, Array<{ sub: number; amt: number }>>()
  for (const s of x.boqShares) {
    const arr = sharesByWo.get(s.wo_id) ?? []
    arr.push({ sub: s.subcategory_id, amt: s.amt })
    sharesByWo.set(s.wo_id, arr)
  }
  for (const w of x.workOrders) {
    if (WO_EXCLUDED.has(w.status) || !want(w.subproject_id)) continue
    const shares = (sharesByWo.get(w.wo_id) ?? []).filter(s => s.amt > 0)
    const total = shares.reduce((t, s) => t + s.amt, 0)
    if (total > 0) {
      for (const s of shares) put(w.subproject_id, w.category_id, s.sub, a => { a.wo += w.wo_gross_value * s.amt / total })
    } else {
      put(w.subproject_id, w.category_id, w.subcategory_id, a => { a.wo += w.wo_gross_value })
    }
    put(w.subproject_id, w.category_id, 0, a => { a.adv += w.wo_advance_balance_amt })
  }

  // ── Contractor certificates ────────────────────────────────────────────────
  for (const c of x.certificates) {
    if (CERT_EXCLUDED.has(c.status)) continue
    put(c.subproject_id, c.category_id, c.subcategory_id, a => { a.gross += c.gross_bill_amt; a.paid += c.paid_amt })
  }

  // ── Material GRN / landed / paid per sub-skill ─────────────────────────────
  for (const s of x.supplier) put(s.subproject_id, s.skill_id, s.subskill_id, a => { a.wo += s.grn_amount; a.gross += s.landed_cost; a.paid += s.paid_amt })

  // ── Shape like the Excel parser ────────────────────────────────────────────
  const out = new Map<number, SubprojectReport>()
  const bySp = new Map<number, Map<string, Acc>>()
  for (const [k, a] of lines) {
    const [spS, catCode, subCode] = k.split('|')
    const sp = Number(spS)
    const m = bySp.get(sp) ?? new Map<string, Acc>()
    m.set(`${catCode}|${subCode}`, a)
    bySp.set(sp, m)
  }
  for (const [sp, m] of bySp) {
    const cats = new Map<string, Acc>()
    const subRows: ReportSubRow[] = []
    for (const [k, a] of m) {
      const [catCode, subCode] = k.split('|')
      const c = cats.get(catCode) ?? acc(catLabel.get(`${sp}|${catCode}`) ?? '')
      c.budget += a.budget; c.wo += a.wo; c.gross += a.gross; c.paid += a.paid; c.adv += a.adv
      cats.set(catCode, c)
      if (subCode) {
        subRows.push({
          head: `${subCode} ${a.label}`.trim(), subNum: subCode, catNum: catCode,
          budget: r2(a.budget), woApproved: r2(a.wo), actual: r2(Math.max(a.paid, a.gross)),
        })
      }
    }
    const rows: ReportRow[] = [...cats.entries()].map(([catCode, c]) => ({
      head: `${catCode} ${c.label}`.trim(), catNum: catCode,
      budget: r2(c.budget), woApproved: r2(c.wo), actual: r2(Math.max(c.paid, c.gross + c.adv)),
    }))
    rows.sort((a, b) => Number(a.catNum) - Number(b.catNum))
    subRows.sort((a, b) => Number(a.subNum) - Number(b.subNum) || a.catNum.localeCompare(b.catNum))
    out.set(sp, { subprojectId: sp, rows, subRows })
  }
  return out
}
