// What we read from IN4, and nothing more. Each function is one SELECT over a
// view or table named in docs/IN4_DB_MAPPING.md. Column names are IN4's own,
// lower-cased — the mapping is documented once, here, not re-derived downstream.

import { in4Query } from './db'

export interface In4Project {
  id: number; name: string; ex_code: string | null; parent_project_id: number | null
  cert_company_id: number | null; status: number | null; budget_amt: number | null
}
export interface In4Subproject {
  id: number; project_id: number; name: string; ex_code: string | null; is_active: boolean
  status: number | null; construction_area_ft: number | null; budget: number | null
  parent_subproject_id: number | null; is_common_service: boolean
}
export interface In4Skill { id: number; name: string; parent_id: number; short_name: string | null; is_active: boolean }
export interface In4MaterialType { id: number; kind: 'type' | 'subtype'; parent_id: number | null; name: string; is_active: boolean }

/** Contractor-side budget line from the current approved budget version.
 *  One row per skill: a category (parent_id = 0) carries the category total,
 *  a sub-skill (parent_id = its category) carries its own share. */
export interface In4BudgetWcLine {
  subproject_id: number; budget_period_id: number; skill_id: number; parent_id: number; budget_allocated: number
}
/** Material-side budget line, keyed by material type / sub-type. */
export interface In4BudgetMatLine {
  subproject_id: number; budget_period_id: number; material_type_id: number; material_subtype_id: number
  budget_allocated: number
}
export interface In4WorkOrder {
  wo_id: number; subproject_id: number; category_id: number; subcategory_id: number; status: number
  display_no: string | null; contractor_id: number | null
  wo_value: number; wo_gross_value: number; wo_paid_amt: number; wo_advance_balance_amt: number
}
/** WO value split by BOQ item into sub-categories — the report attributes a WO
 *  raised at category level to sub-skills by this share. */
export interface In4WoBoqShare { wo_id: number; subcategory_id: number; amt: number }
/** One WO BOQ line as ORDERED, with its name/unit from the paired dimension.
 *  `item_id` is the join key to the certified abstracts — never `boq_id`, which
 *  the two IN4 facts disagree on by one. */
export interface In4WoBoqItem {
  item_id: number; wo_id: number; boq_id: number; category_id: number; subcategory_id: number
  quantity: number; rate: number; amt: number
  boq_name: string | null; boq_subname: string | null; description: string | null; uom: string | null; uom_id: number | null
}
/** One certified quantity, per BOQ item per certificate ("abstract" = IN4's
 *  word for a bill/RA certificate). `bill_no`/`abstract_dt` come from the
 *  ENGG_BOQ_ABSTRACT header; joins to In4WoBoqItem on `item_id`. */
export interface In4WoAbstractItem {
  abstract_id: number; wo_id: number; item_id: number
  executed_quantity: number; recommended_rate: number; executed_amt: number
  bill_no: string | null; display_no: string | null; abstract_dt: string | null
}
export interface In4WoCertificate {
  certificate_id: number; wo_id: number; subproject_id: number; category_id: number; subcategory_id: number
  status: number; gross_bill_amt: number; certified_amt: number; paid_amt: number; advance_recovery_amt: number
}
/** Supplier (material) money per sub-skill: GRN value, certified+tax (landed), paid. */
export interface In4SupplierSkill {
  subproject_id: number; skill_id: number; subskill_id: number
  grn_amount: number; certified_amt: number; tax_amount: number; landed_cost: number; paid_amt: number
}

const n = (v: unknown): number => (v == null ? 0 : Number(v))
const str = (v: unknown): string | null => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s || null }
const day = (v: unknown): string | null => { if (v == null) return null; const d = new Date(v as string); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

export async function extractProjects(): Promise<In4Project[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT ID, NAME, EX_CODE, PARENT_PROJECT_ID, CERT_COMPANY_ID, STATUS, BUDGET_AMT FROM ENGG_PROJECT`)
  return rows.map(r => ({
    id: n(r.ID), name: String(r.NAME ?? '').trim(), ex_code: (r.EX_CODE as string | null)?.trim() ?? null,
    parent_project_id: r.PARENT_PROJECT_ID == null ? null : n(r.PARENT_PROJECT_ID),
    cert_company_id: r.CERT_COMPANY_ID == null ? null : n(r.CERT_COMPANY_ID),
    status: r.STATUS == null ? null : n(r.STATUS), budget_amt: r.BUDGET_AMT == null ? null : n(r.BUDGET_AMT),
  }))
}

export async function extractSubprojects(): Promise<In4Subproject[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT ID, PROJECT_ID, SUBPROJECT_NAME, EX_CODE, ISACTIVE, STATUS, CONSTRUCTION_AREA_FEET, BUDGET,
           PARENT_SUBPROJECT_ID, IS_COMMON_SERVICE
    FROM ENGG_SUBPROJECT`)
  return rows.map(r => ({
    id: n(r.ID), project_id: n(r.PROJECT_ID), name: String(r.SUBPROJECT_NAME ?? '').replace(/\s+/g, ' ').trim(),
    ex_code: (r.EX_CODE as string | null)?.trim() ?? null, is_active: !!r.ISACTIVE,
    status: r.STATUS == null ? null : n(r.STATUS),
    construction_area_ft: r.CONSTRUCTION_AREA_FEET == null ? null : n(r.CONSTRUCTION_AREA_FEET),
    budget: r.BUDGET == null ? null : n(r.BUDGET),
    parent_subproject_id: r.PARENT_SUBPROJECT_ID == null ? null : n(r.PARENT_SUBPROJECT_ID),
    is_common_service: !!r.IS_COMMON_SERVICE,
  }))
}

export async function extractSkills(): Promise<In4Skill[]> {
  const rows = await in4Query<Record<string, unknown>>(`SELECT ID, NAME, PARENT_ID, SHORT_NAME, isActive FROM ENGG_SKILLS_LOOKUP`)
  return rows.map(r => ({ id: n(r.ID), name: String(r.NAME ?? '').replace(/\s+/g, ' ').trim(), parent_id: n(r.PARENT_ID), short_name: (r.SHORT_NAME as string | null) ?? null, is_active: !!r.isActive }))
}

export async function extractMaterialTypes(): Promise<In4MaterialType[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT 'type' kind, ID, NULL parent_id, NAME, isActive FROM PURCH_MATERIAL_TYPE_LOOKUP
    UNION ALL
    SELECT 'subtype', ID, MATERIAL_TYPE_ID, NAME, isActive FROM PURCH_MATERIAL_SUBTYPE_LOOKUP`)
  return rows.map(r => ({ id: n(r.ID), kind: r.kind as 'type' | 'subtype', parent_id: r.parent_id == null ? null : n(r.parent_id), name: String(r.NAME ?? '').replace(/\s+/g, ' ').trim(), is_active: !!r.isActive }))
}

/** Every sub-project has exactly one approved budget version (checked 4 Sept
 *  2026: 102 headers, 102 sub-projects). Read that version's lines from the
 *  base table — BI.FACT_ENGG_BUDGET_WC_LINE_ITEMS looked equivalent but drops
 *  lines (NGH B's 1204 Flooring, ₹34.4 L, was missing from it). */
export async function extractBudgetWc(): Promise<In4BudgetWcLine[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT b.SUBPROJECT_ID, b.ENGG_BUDGET_PERIOD_ID, b.SKILL_ID, ISNULL(k.PARENT_ID, 0) PARENT_ID, b.Budget_Allocated
    FROM ENGG_SUBPROJECT_BUDGET b
    JOIN BI.DIM_ENGG_BUDGET_WC_HEADER h ON h.BUDGET_PERIOD_ID = b.ENGG_BUDGET_PERIOD_ID AND h.STATUS = 2
    LEFT JOIN ENGG_SKILLS_LOOKUP k ON k.ID = b.SKILL_ID`)
  return rows.map(r => ({
    subproject_id: n(r.SUBPROJECT_ID), budget_period_id: n(r.ENGG_BUDGET_PERIOD_ID),
    skill_id: n(r.SKILL_ID), parent_id: n(r.PARENT_ID), budget_allocated: n(r.Budget_Allocated),
  }))
}

/** Material budgets. A row with MATERIAL_SUBTYPE_ID = 0 is the type total (the
 *  sum of its sub-type rows) — kept so the loader can fall back to it when a
 *  type has no sub-type rows, dropped otherwise or it would double count. */
export async function extractBudgetMaterial(): Promise<In4BudgetMatLine[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT b.SUBPROJECT_ID, b.ENGG_BUDGET_PERIOD_ID, b.MATERIAL_TYPE_ID, b.MATERIAL_SUBTYPE_ID, b.BUDGET_ALLOCATED
    FROM ENGG_SUBPROJECT_MATERIAL_BUDGET b
    JOIN BI.DIM_ENGG_BUDGET_WC_HEADER h ON h.BUDGET_PERIOD_ID = b.ENGG_BUDGET_PERIOD_ID AND h.STATUS = 2
    WHERE b.IS_BUDGETED = 1`)
  return rows.map(r => ({
    subproject_id: n(r.SUBPROJECT_ID), budget_period_id: n(r.ENGG_BUDGET_PERIOD_ID),
    material_type_id: n(r.MATERIAL_TYPE_ID), material_subtype_id: n(r.MATERIAL_SUBTYPE_ID), budget_allocated: n(r.BUDGET_ALLOCATED),
  }))
}

export async function extractWorkOrders(): Promise<In4WorkOrder[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT f.WO_ID, f.SUBPROJECT_ID, f.WORK_CATEGORY_ID, f.WORK_SUBCATEGORY_ID, w.STATUS, w.DISPLAY_NO, f.CONTRACTOR_ID,
           f.WO_VALUE, f.WO_GROSS_VALUE, f.WO_PAID_AMT, f.WO_ADVANCE_BALANCE_AMT
    FROM BI.FACT_ENGG_WORK_ORDER f
    JOIN ENGG_WORK_ORDER w ON w.ID = f.WO_ID`)
  return rows.map(r => ({
    wo_id: n(r.WO_ID), subproject_id: n(r.SUBPROJECT_ID), category_id: n(r.WORK_CATEGORY_ID), subcategory_id: n(r.WORK_SUBCATEGORY_ID),
    status: n(r.STATUS), display_no: (r.DISPLAY_NO as string | null) ?? null, contractor_id: r.CONTRACTOR_ID == null ? null : n(r.CONTRACTOR_ID),
    wo_value: n(r.WO_VALUE), wo_gross_value: n(r.WO_GROSS_VALUE), wo_paid_amt: n(r.WO_PAID_AMT), wo_advance_balance_amt: n(r.WO_ADVANCE_BALANCE_AMT),
  }))
}

export async function extractWoBoqShares(): Promise<In4WoBoqShare[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT WO_ID, WORK_SUBCATEGORY_ID, SUM(AMT) amt FROM BI.FACT_ENGG_WORK_ORDER_BOQ GROUP BY WO_ID, WORK_SUBCATEGORY_ID`)
  return rows.map(r => ({ wo_id: n(r.WO_ID), subcategory_id: n(r.WORK_SUBCATEGORY_ID), amt: n(r.amt) }))
}

/** Every WO BOQ line as ORDERED (quantity × rate = amt), with its name/unit
 *  from the paired dimension BI.DIM_ENGG_WORK_ORDER_BOQ (keyed on ITEM_ID). The
 *  budget split above keeps SUM(AMT); this carries the item rows themselves. */
export async function extractWoBoqItems(): Promise<In4WoBoqItem[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT f.ITEM_ID, f.WO_ID, f.BOQ_ID, f.WORK_CATEGORY_ID, f.WORK_SUBCATEGORY_ID,
           f.QUANTITY, f.RATE, f.AMT,
           d.BOQ_NAME, d.BOQ_SUBNAME, d.BOQ_DESCRIPTION, d.UOM, d.UOM_ID
    FROM BI.FACT_ENGG_WORK_ORDER_BOQ f
    LEFT JOIN BI.DIM_ENGG_WORK_ORDER_BOQ d ON d.ITEM_ID = f.ITEM_ID`)
  return rows.map(r => ({
    item_id: n(r.ITEM_ID), wo_id: n(r.WO_ID), boq_id: n(r.BOQ_ID),
    category_id: n(r.WORK_CATEGORY_ID), subcategory_id: n(r.WORK_SUBCATEGORY_ID),
    quantity: n(r.QUANTITY), rate: n(r.RATE), amt: n(r.AMT),
    boq_name: str(r.BOQ_NAME), boq_subname: str(r.BOQ_SUBNAME), description: str(r.BOQ_DESCRIPTION),
    uom: str(r.UOM), uom_id: r.UOM_ID == null ? null : n(r.UOM_ID),
  }))
}

/** Every certified BOQ quantity, one row per (certificate, BOQ item), with the
 *  bill number + date from the ENGG_BOQ_ABSTRACT header. Joins to the ordered
 *  items on ITEM_ID. LEFT JOIN so an executed row is never dropped if its header
 *  is somehow missing (bill_no/date come back null then). */
export async function extractWoAbstractItems(): Promise<In4WoAbstractItem[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT a.ABSTRACT_ID, a.WO_ID, a.ITEM_ID, a.EXECUTED_QUANTITY, a.RECOMMENDED_RATE, a.EXECUTED_AMT,
           h.BILL_NO, h.DISPLAY_NO, h.ABSTRACT_DT
    FROM BI.FACT_ENGG_WO_ABSTRACT_BOQ a
    LEFT JOIN dbo.ENGG_BOQ_ABSTRACT h ON h.ID = a.ABSTRACT_ID`)
  return rows.map(r => ({
    abstract_id: n(r.ABSTRACT_ID), wo_id: n(r.WO_ID), item_id: n(r.ITEM_ID),
    executed_quantity: n(r.EXECUTED_QUANTITY), recommended_rate: n(r.RECOMMENDED_RATE), executed_amt: n(r.EXECUTED_AMT),
    bill_no: str(r.BILL_NO), display_no: str(r.DISPLAY_NO), abstract_dt: day(r.ABSTRACT_DT),
  }))
}

export async function extractWoCertificates(): Promise<In4WoCertificate[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT p.CERTIFICATE_ID, p.WO_ID, p.SUBPROJECT_ID, p.WORK_CATEGORY_ID, p.WORK_SUBCATEGORY_ID, p.STATUS,
           p.GROSS_BILL_AMT, p.CERTIFIED_AMT, c.PAID_AMT, c.ADVANCE_RECOVERY_AMT
    FROM BI.FACT_ENGG_WO_PAYMENTS p
    LEFT JOIN ENGG_RPT_WO_CERTIFICATE_DETAILS c ON c.CERTIFICATE_ID = p.CERTIFICATE_ID AND c.CERTIFICATE_TYPE_ID = 3`)
  return rows.map(r => ({
    certificate_id: n(r.CERTIFICATE_ID), wo_id: n(r.WO_ID), subproject_id: n(r.SUBPROJECT_ID),
    category_id: n(r.WORK_CATEGORY_ID), subcategory_id: n(r.WORK_SUBCATEGORY_ID), status: n(r.STATUS),
    gross_bill_amt: n(r.GROSS_BILL_AMT), certified_amt: n(r.CERTIFIED_AMT), paid_amt: n(r.PAID_AMT), advance_recovery_amt: n(r.ADVANCE_RECOVERY_AMT),
  }))
}

/** Material money per sub-skill. GRN from the skill view; certified / tax /
 *  landed / paid from the supplier-payment fact, attributed to a sub-skill
 *  through the indent item it was bought against (4,444 of 4,444 rows join). */
export async function extractSupplierSkill(): Promise<In4SupplierSkill[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    WITH grn AS (
      SELECT SUBPROJECT_ID, SKILL_ID, SUBSKILL_ID, SUM(SUPPLIER_GRN_AMOUNT) grn_amount
      FROM PURCH_VW_SUPPLIER_GRN_AMOUNT_SKILL GROUP BY SUBPROJECT_ID, SKILL_ID, SUBSKILL_ID
    ), pay AS (
      SELECT f.SUBPROJECT_ID, ISNULL(ii.WORK_CATEGORY_ID, f.WORK_CATEGORY_ID) skill_id, ISNULL(ii.WORK_SUBCATEGORY_ID, 0) subskill_id,
             SUM(f.CERTIFIED_AMT) certified_amt, SUM(f.TAX_ADDITION_AMT) tax_amount, SUM(f.LANDED_COST) landed_cost, SUM(f.PAID_AMT) paid_amt
      FROM BI.FACT_PURCHASE_SUPPLIER_PAY f
      LEFT JOIN PURCH_INDENT_ITEMS ii ON ii.INDENT_NO = f.INDENT_ID AND ii.MATERIAL_ID = f.MATERIAL_ID
      GROUP BY f.SUBPROJECT_ID, ISNULL(ii.WORK_CATEGORY_ID, f.WORK_CATEGORY_ID), ISNULL(ii.WORK_SUBCATEGORY_ID, 0)
    )
    SELECT COALESCE(g.SUBPROJECT_ID, p.SUBPROJECT_ID) subproject_id, COALESCE(g.SKILL_ID, p.skill_id) skill_id,
           COALESCE(g.SUBSKILL_ID, p.subskill_id) subskill_id,
           ISNULL(g.grn_amount, 0) grn_amount, ISNULL(p.certified_amt, 0) certified_amt, ISNULL(p.tax_amount, 0) tax_amount,
           ISNULL(p.landed_cost, 0) landed_cost, ISNULL(p.paid_amt, 0) paid_amt
    FROM grn g
    FULL OUTER JOIN pay p ON p.SUBPROJECT_ID = g.SUBPROJECT_ID AND p.skill_id = g.SKILL_ID AND p.subskill_id = g.SUBSKILL_ID`)
  return rows.map(r => ({
    subproject_id: n(r.subproject_id), skill_id: n(r.skill_id), subskill_id: n(r.subskill_id),
    grn_amount: n(r.grn_amount), certified_amt: n(r.certified_amt), tax_amount: n(r.tax_amount), landed_cost: n(r.landed_cost), paid_amt: n(r.paid_amt),
  }))
}

export interface In4Extract {
  projects: In4Project[]; subprojects: In4Subproject[]; skills: In4Skill[]; materialTypes: In4MaterialType[]
  budgetWc: In4BudgetWcLine[]; budgetMat: In4BudgetMatLine[]; workOrders: In4WorkOrder[]; boqShares: In4WoBoqShare[]
  certificates: In4WoCertificate[]; supplier: In4SupplierSkill[]
}

/** Everything the budget report needs, in one pass. Sequential on purpose —
 *  the pool is capped at 3 and each query is a few thousand rows at most. */
export async function extractAll(): Promise<In4Extract> {
  return {
    projects: await extractProjects(),
    subprojects: await extractSubprojects(),
    skills: await extractSkills(),
    materialTypes: await extractMaterialTypes(),
    budgetWc: await extractBudgetWc(),
    budgetMat: await extractBudgetMaterial(),
    workOrders: await extractWorkOrders(),
    boqShares: await extractWoBoqShares(),
    certificates: await extractWoCertificates(),
    supplier: await extractSupplierSkill(),
  }
}
