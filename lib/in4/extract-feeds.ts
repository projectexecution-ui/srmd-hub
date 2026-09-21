// The SELECTs behind the Phase 2 feeds — the Contractor and Supplier reports
// and the masters (the Indent → PO tracker feed left on 10 Sep 2026). Each is one query over a
// view or table named in docs/IN4_DB_MAPPING.md; IN4's column names are kept,
// lower-cased, and dates come out as ISO 'YYYY-MM-DD' strings.

import { in4Query } from './db'
import type { In4IndentRow } from './tracker'
import type { In4ContractorCert } from './contractor'
import type { In4SupplierCert } from './supplier'

// ── Indent → PO ──────────────────────────────────────────────────────────────

/** PURCH_INDENT_TO_ISSUE hands back a TOP 5 in 5 s and never finishes the
 *  full 38-column result (measured 5 Sept 2026: 9 minutes, then the server
 *  reset the connection). The plan is the problem, not the size — every
 *  column group below returns all 5,586 rows in 8–15 s with
 *  OPTION (RECOMPILE, MAXDOP 1), except GRN qty/rate/value, which stall on
 *  their own. So the view is read in four groups keyed by
 *  (INDENT_ITEM_ID, PO_DETAIL_ID, GRN_ID) and joined here, and the three GRN
 *  figures come from BI.FACT_PURCHASE_GRN_DETAILS (base-UOM qty, unit rate,
 *  material cost), keyed by GRN + indent + material. */
/** One PO line as IN4's PO-details fact holds it: quantity in base UOM and
 *  material value for THAT line. */
export interface PoLineDetail { qty: number; value: number; rate: number }

/** The view's PO quantity and rate, corrected from the PO line itself.
 *
 *  PURCH_INDENT_TO_ISSUE reports PO_ORDER_QTY_IN_BASE_UOM as the PO's total
 *  for the material, not the line's own quantity. PO/SRASSK/NGH/2025-26/93
 *  has two lines — 44,200 kg and 70 kg — and the view says 44,270 on both,
 *  so the tracker ordered 88,540 kg of a 44,270 kg PO, and the 70 kg indent
 *  looked 44,200 kg over-ordered. Checked 8 Sept 2026: 424 of 4,714 PO lines
 *  in the view differ from BI.FACT_PURCHASE_ORDER_DETAILS, over-stating
 *  70.8 lakh; every view line has a detail row. The detail wins; the rate is
 *  the line's value over its base quantity so it is in the same UOM as the
 *  quantity. A line IN4 has cancelled to zero stays zero. */
export function applyPoLine(
  view: { po_qty: number; po_rate: number },
  det: PoLineDetail | undefined,
): { po_qty: number; po_rate: number } {
  if (!det) return view
  return { po_qty: det.qty, po_rate: det.qty > 0 ? det.value / det.qty : view.po_rate }
}

export async function extractIndentRows(): Promise<In4IndentRow[]> {
  const HINT = 'OPTION (RECOMPILE, MAXDOP 1)'
  const KEY = 'INDENT_ITEM_ID, PO_DETAIL_ID, GRN_ID'
  const q = (cols: string) => in4Query<Record<string, unknown>>(`SELECT ${KEY}, ${cols} FROM PURCH_INDENT_TO_ISSUE ${HINT}`)
  const [names, indent, po, grn, grnFacts, poDetails] = await Promise.all([
    q('PROJECT_ID, PROJECT_NAME, SUBPROJECT_ID, SUBPROJECT_NAME, WO_SKILL_NAME, WO_DISPLAY_NO, WO_SERVICE_PROVIDER_NAME'),
    q('MATERIAL_TYPE, MAT_SUBTYPE, MATERIAL_ID, MATERIAL_NAME, INDENT_ID, INDENT_DISPLAY_NO, INDENT_STATUS, INDENT_CREATION_DT, INDENT_TYPE, INDENT_QTY_BASE_UOM, INDENT_BASE_UOM'),
    q('PO_ID, PO_DISPLAY_NO, PO_SUPPLIER_ID, PO_SUPPLIER_NAME, PO_STATUS, PO_CREATED_DT, PO_ORDER_QTY_IN_BASE_UOM, PO_ORDER_RATE_IN_BASE_UOM'),
    q('GRN_DISPLAY_NO, GRN_DATE, GRN_STATUS, CLOSED_FOR_PO, SKILL_ID, WORK_ORDER_ID'),
    in4Query<Record<string, unknown>>(`
      SELECT GRN_ID, INDENT_ID, MATERIAL_ID, SUM(BASE_UOM_QTY) qty, MAX(UNIT_RATE) rate, SUM(GRN_MATERIAL_COST) value
      FROM BI.FACT_PURCHASE_GRN_DETAILS GROUP BY GRN_ID, INDENT_ID, MATERIAL_ID`),
    // The PO line's OWN quantity and value (see applyPoLine). ITEM_ID is the
    // view's PO_DETAIL_ID. MAX, not SUM: 2 of 4,946 rows are exact repeats.
    in4Query<Record<string, unknown>>(`
      SELECT ITEM_ID, MAX(BASE_PO_QTY) qty, MAX(MATERIAL_VALUE) value, MAX(NET_RATE) rate
      FROM BI.FACT_PURCHASE_ORDER_DETAILS GROUP BY ITEM_ID`),
  ])
  const key = (r: Record<string, unknown>) => `${r.INDENT_ITEM_ID}|${r.PO_DETAIL_ID ?? ''}|${r.GRN_ID ?? ''}`
  const merged = new Map<string, Record<string, unknown>>()
  for (const group of [names, indent, po, grn]) {
    for (const r of group) {
      const k = key(r)
      const cur = merged.get(k)
      if (cur) Object.assign(cur, r); else merged.set(k, { ...r })
    }
  }
  const grnByKey = new Map<string, { qty: number; rate: number; value: number }>()
  for (const g of grnFacts) grnByKey.set(`${g.GRN_ID}|${g.INDENT_ID}|${g.MATERIAL_ID}`, { qty: n(g.qty), rate: n(g.rate), value: n(g.value) })
  const detailByItem = new Map<number, PoLineDetail>()
  for (const p of poDetails) detailByItem.set(n(p.ITEM_ID), { qty: n(p.qty), value: n(p.value), rate: n(p.rate) })

  return [...merged.values()].map(r => {
    const g = r.GRN_ID == null ? null : grnByKey.get(`${r.GRN_ID}|${r.INDENT_ID}|${r.MATERIAL_ID}`) ?? null
    const line = applyPoLine(
      { po_qty: n(r.PO_ORDER_QTY_IN_BASE_UOM), po_rate: n(r.PO_ORDER_RATE_IN_BASE_UOM) },
      r.PO_DETAIL_ID == null ? undefined : detailByItem.get(n(r.PO_DETAIL_ID)),
    )
    return {
      project_id: n(r.PROJECT_ID), project_name: s(r.PROJECT_NAME), subproject_id: n(r.SUBPROJECT_ID), subproject_name: s(r.SUBPROJECT_NAME),
      skill_id: ni(r.SKILL_ID), wo_skill_name: sn(r.WO_SKILL_NAME), wo_id: ni(r.WORK_ORDER_ID), wo_no: sn(r.WO_DISPLAY_NO), contractor_name: sn(r.WO_SERVICE_PROVIDER_NAME),
      material_type: s(r.MATERIAL_TYPE), material_subtype: s(r.MAT_SUBTYPE), material_id: n(r.MATERIAL_ID), material_name: s(r.MATERIAL_NAME),
      indent_id: n(r.INDENT_ID), indent_no: s(r.INDENT_DISPLAY_NO), indent_status: n(r.INDENT_STATUS), indent_date: d(r.INDENT_CREATION_DT), indent_type: sn(r.INDENT_TYPE),
      indent_item_id: n(r.INDENT_ITEM_ID), indent_qty: n(r.INDENT_QTY_BASE_UOM), uom: s(r.INDENT_BASE_UOM),
      po_id: ni(r.PO_ID), po_detail_id: ni(r.PO_DETAIL_ID), po_no: sn(r.PO_DISPLAY_NO), po_supplier_id: ni(r.PO_SUPPLIER_ID), po_supplier: sn(r.PO_SUPPLIER_NAME),
      po_status: ni(r.PO_STATUS), po_date: d(r.PO_CREATED_DT), po_qty: line.po_qty, po_rate: line.po_rate,
      grn_id: ni(r.GRN_ID), grn_no: sn(r.GRN_DISPLAY_NO), grn_date: d(r.GRN_DATE), grn_status: ni(r.GRN_STATUS),
      grn_qty: g?.qty ?? 0, grn_rate: g?.rate ?? 0, grn_value: g?.value ?? 0,
      closed_for_po: n(r.CLOSED_FOR_PO) === 1,
    }
  })
}

const n = (v: unknown): number => (v == null ? 0 : Number(v))
const ni = (v: unknown): number | null => (v == null ? null : Number(v))
/** Like ni, for money and quantities: null stays null. A rate of null and a
 *  rate of zero mean different things on a rate screen. */
const num = (v: unknown): number | null => (v == null ? null : Number(v))
const s = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const sn = (v: unknown): string | null => { const t = s(v); return t ? t : null }
/** A calendar date with the time dropped — these are shown as days, and a
 *  timestamp would only invite a timezone to shift them. */
const day = (v: unknown): string | null => { if (v == null) return null; const d = new Date(v as string); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }
const d = (v: unknown): string | null => {
  if (v == null) return null
  const t = v instanceof Date ? v : new Date(String(v))
  return isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10)
}

// ── Contractor certificates ──────────────────────────────────────────────────

export async function extractContractorCerts(): Promise<In4ContractorCert[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT 'wo' kind, c.CERTIFICATE_ID, c.CERTIFICATE_TYPE_ID type_id, c.CERTIFICATE_SUBTYPE type_name, pa.DISPLAY_NO display_no, c.WORK_ORDER_ID wo_id, w.DISPLAY_NO wo_no, w.WORK_ORDER_VALUE wo_value,
           w.PROJECT_ID, w.SUBPROJECT_ID, w.SKILL_ID, w.SUB_SKILL_ID, w.SERVICE_PROVIDER_ID contractor_id, c.STATUS, sl.NAME status_name,
           c.INVOICE_NO, c.INVOICE_DATE, c.CREATION_DT,
           c.GROSS_AMT gross,
           (ISNULL(c.ADVANCE_RECOVERY_AMT,0) + ISNULL(c.MISC_EXPENSE_RECOVERY_AMT,0) + ISNULL(c.MATERIAL_ADJUSTMENT,0) + ISNULL(c.DEBIT_NOTE_RECOVERY_AMT,0)) recoveries,
           c.PAID_AMT paid, (ISNULL(c.TAX_DED,0) + ISNULL(c.ADDITIONAL_DEDUCTION_AMT,0)) deductions, c.RETENTION_AMT retention, c.Amt_Outstanding outstanding, c.CERTIFICATE_AMT certified
    FROM ENGG_RPT_WO_CERTIFICATE_DETAILS c
    JOIN ENGG_WORK_ORDER w ON w.ID = c.WORK_ORDER_ID
    LEFT JOIN ENGG_WO_PAYMENT_AUTHORISATION pa ON pa.ID = c.CERTIFICATE_ID
    LEFT JOIN COMMON_STATUS_LOOKUP sl ON sl.ID = c.STATUS
    UNION ALL
    SELECT 'advance', a.CERTIFICATE_ID, 1, 'Advance', aa.DISPLAY_NO, a.WO_ID, w.DISPLAY_NO, w.WORK_ORDER_VALUE,
           w.PROJECT_ID, a.SUBPROJECT_ID, w.SKILL_ID, w.SUB_SKILL_ID, w.SERVICE_PROVIDER_ID, a.STATUS, sl2.NAME,
           a.BILL_NO, a.BILL_DT, a.CREATED_DT,
           a.GROSS_BILL_AMT, 0, (ISNULL(a.PAYABLE_AMT,0) - ISNULL(a.OUTSTANDING_AMT,0)), ISNULL(a.TAX_DEDUCTION_AMT,0), 0, a.OUTSTANDING_AMT, a.CERTIFIED_AMT
    FROM BI.ENGG_ADVANCE_PAYMENTS_HEADER a
    JOIN ENGG_WORK_ORDER w ON w.ID = a.WO_ID
    LEFT JOIN ENGG_WO_ADVANCE_AUTHORISATION aa ON aa.ID = a.CERTIFICATE_ID
    LEFT JOIN COMMON_STATUS_LOOKUP sl2 ON sl2.ID = a.STATUS
    UNION ALL
    SELECT 'misc', m.CERTIFICATE_ID, 0, 'Misc', NULL, NULL, NULL, 0,
           sp.PROJECT_ID, m.SUBPROJECT_ID, NULL, NULL, m.CONTRACTOR_ID, m.STATUS, sl3.NAME,
           m.BILL_NO, m.BILL_DT, m.CREATED_DT,
           m.GROSS_BILL_AMT, ISNULL(m.RECOVERED_AMT,0), (ISNULL(m.GROSS_BILL_AMT,0) - ISNULL(m.TAX_DEDUCTION_AMT,0) - ISNULL(m.OUTSTANDING_AMT,0)), ISNULL(m.TAX_DEDUCTION_AMT,0), 0, m.OUTSTANDING_AMT, m.CERTIFICATE_AMT
    FROM BI.ENGG_MISC_PAYMENTS_HEADER m
    JOIN ENGG_SUBPROJECT sp ON sp.ID = m.SUBPROJECT_ID
    LEFT JOIN COMMON_STATUS_LOOKUP sl3 ON sl3.ID = m.STATUS`)
  return rows.map(r => ({
    kind: r.kind as In4ContractorCert['kind'], certificate_id: n(r.CERTIFICATE_ID),
    certificate_type_id: ni(r.type_id), certificate_type: sn(r.type_name), display_no: sn(r.display_no),
    wo_id: ni(r.wo_id), wo_no: sn(r.wo_no), wo_value: n(r.wo_value),
    project_id: ni(r.PROJECT_ID), subproject_id: n(r.SUBPROJECT_ID), skill_id: ni(r.SKILL_ID), subskill_id: ni(r.SUB_SKILL_ID),
    contractor_id: ni(r.contractor_id), status: n(r.STATUS), status_name: sn(r.status_name),
    invoice_no: sn(r.INVOICE_NO), invoice_date: d(r.INVOICE_DATE), creation_dt: d(r.CREATION_DT),
    gross: n(r.gross), recoveries: n(r.recoveries), paid: n(r.paid), deductions: n(r.deductions), retention: n(r.retention), outstanding: n(r.outstanding), certified: n(r.certified),
  }))
}

// ── Supplier certificates ────────────────────────────────────────────────────

export async function extractSupplierCerts(): Promise<In4SupplierCert[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    WITH cats AS (
      SELECT DISTINCT f.CERTIFICATE_ID, t.NAME type_name
      FROM BI.FACT_PURCHASE_SUPPLIER_PAY f
      JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = f.MATERIAL_ID
      JOIN PURCH_MATERIAL_SUBTYPE_LOOKUP st ON st.ID = m.MATERIAL_SUBTYPE_ID
      JOIN PURCH_MATERIAL_TYPE_LOOKUP t ON t.ID = st.MATERIAL_TYPE_ID
    ), catagg AS (
      SELECT CERTIFICATE_ID, STRING_AGG(type_name, ',') WITHIN GROUP (ORDER BY type_name) category FROM cats GROUP BY CERTIFICATE_ID
    ), nos AS (
      SELECT CERTIFICATE_ID, MAX(CAST(CERTIFICATE_NO AS NVARCHAR(50))) certificate_no, MAX(CERTIFICATE_DT) certificate_dt, MAX(INVOICE_DT) invoice_dt FROM BI.DIM_PURCHASE_SUPPLIER_PAY GROUP BY CERTIFICATE_ID
    )
    SELECT 'payment' kind, f.CERTIFICATE_ID, MAX(nos.certificate_no) certificate_no, MAX(f.SUBPROJECT_ID) subproject_id, MAX(f.SUPPLIER_ID) supplier_id, MAX(f.PO_ID) po_id, MAX(f.STATUS_ID) status,
           MAX(c.category) category, MAX(nos.certificate_dt) certificate_dt, MAX(nos.invoice_dt) invoice_dt,
           SUM(f.CERTIFIED_AMT) certified, SUM(f.LANDED_COST) landed, SUM(f.TAX_ADDITION_AMT) tax_add, SUM(f.TAX_DEDUCTION_AMT) tax_ded,
           SUM(f.ADV_RECOVERY_AMT) adv_recovery, SUM(f.DEBIT_NOTE_ADJ_AMT) debit_note, SUM(f.RETENTION_AMT) retention,
           SUM(f.PAYABLE_AMT) payable, SUM(f.PAID_AMT) paid, SUM(f.CERTIFIED_OUT_AMT) outstanding
    FROM BI.FACT_PURCHASE_SUPPLIER_PAY f
    LEFT JOIN catagg c ON c.CERTIFICATE_ID = f.CERTIFICATE_ID
    LEFT JOIN nos ON nos.CERTIFICATE_ID = f.CERTIFICATE_ID
    GROUP BY f.CERTIFICATE_ID
    UNION ALL
    SELECT 'advance', a.CERTIFICATE_ID, MAX(CAST(a.CERTIFICATE_NO AS NVARCHAR(50))), MAX(a.SUBPROJECT_ID), MAX(a.SUPPLIER_ID), MAX(a.PO_ID), MAX(a.STATUS_ID),
           NULL, NULL, NULL,
           SUM(a.CERTIFIED_AMT), SUM(a.GROSS_AMT), 0, 0,
           0, 0, 0,
           SUM(a.GROSS_AMT), SUM(a.TILL_DT_PAID_AMT), SUM(a.OUTSTANDING_AMT)
    FROM BI.FACT_PURCHASE_SUPPLIER_ADV_PAY a
    GROUP BY a.CERTIFICATE_ID`)
  return rows.map(r => ({
    kind: r.kind as In4SupplierCert['kind'], certificate_id: n(r.CERTIFICATE_ID), certificate_no: sn(r.certificate_no),
    project_id: null, subproject_id: n(r.subproject_id), supplier_id: ni(r.supplier_id), po_id: ni(r.po_id), status: n(r.status),
    category: sn(r.category), certificate_date: d(r.certificate_dt), invoice_date: d(r.invoice_dt),
    certified: n(r.certified), landed: n(r.landed), tax_add: n(r.tax_add), tax_ded: n(r.tax_ded),
    adv_recovery: n(r.adv_recovery), debit_note: n(r.debit_note), retention: n(r.retention),
    payable: n(r.payable), paid: n(r.paid), outstanding: n(r.outstanding),
  }))
}

// ── Masters ──────────────────────────────────────────────────────────────────

export interface In4Party {
  kind: 'contractor' | 'supplier'; id: number; name: string; code: string | null
  pan: string | null; gstin: string | null; msme: string | null; constitution: string | null
  address: string | null; city: string | null; state: string | null; pin: string | null
  phone: string | null; email: string | null; contact_person: string | null
  is_active: boolean; skills: string[]
}

const ADDRESS_JOIN = `
    LEFT JOIN COMMON_ADDRESS a ON a.ID = x.ADDR_ID
    LEFT JOIN COMMON_LOCATION_LOOKUP l ON l.ID = a.LOCATION_ID
    LEFT JOIN COMMON_STATE_LOOKUP st ON st.ID = a.STATE_ID`

export async function extractParties(): Promise<In4Party[]> {
  const contractors = await in4Query<Record<string, unknown>>(`
    SELECT x.ID, x.FIRM_NAME name, COALESCE(NULLIF(x.VENDOR_CODE,''), NULLIF(x.FIRM_CODE,'')) code, x.PAN_NO pan, x.GSTIN_NO gstin, x.MSME_NO msme, x.IsActive is_active,
           x.CONTACT_PERSON contact_person, x.CONTACT_DETAILS contact_details,
           a.ADDR address, a.PIN pin, a.OFF_PHONE off_phone, a.MOBILE mobile, a.EMAIL email, l.NAME city, st.NAME state,
           c.Contact_Name c_name, c.Contact_Phone c_phone, c.Contact_Mobile c_mobile, c.Contact_Email c_email,
           (SELECT STRING_AGG(k.NAME, '|') FROM ENGG_SERVICE_PROVIDER_SKILL ss JOIN ENGG_SKILLS_LOOKUP k ON k.ID = ss.SKILL_ID WHERE ss.SERVICE_PROVIDER_ID = x.ID) skills
    FROM ENGG_SERVICE_PROVIDER x
    ${ADDRESS_JOIN}
    OUTER APPLY (SELECT TOP 1 * FROM ENGG_SERVICE_PROVIDER_CONTACT cc WHERE cc.SERVICE_PROVIDER_ID = x.ID ORDER BY cc.ID) c`)
  const suppliers = await in4Query<Record<string, unknown>>(`
    SELECT x.ID, x.NAME name, COALESCE(NULLIF(x.VENDOR_CODE,''), NULLIF(x.CODE,'')) code, x.PAN pan, x.GSTIN_NO gstin, x.MSME_NO msme, x.IsActive is_active,
           x.CONTACT_NAME contact_person, NULL contact_details,
           a.ADDR address, a.PIN pin, a.OFF_PHONE off_phone, a.MOBILE mobile, a.EMAIL email, l.NAME city, st.NAME state,
           c.Contact_Name c_name, c.Contact_Phone c_phone, c.Contact_Mobile c_mobile, c.Contact_Email c_email,
           NULL skills
    FROM PURCH_SUPPLIER x
    ${ADDRESS_JOIN}
    OUTER APPLY (SELECT TOP 1 * FROM PURCH_SUPPLIER_CONTACT cc WHERE cc.SUPPLIER_ID = x.ID ORDER BY cc.ID) c`)
  const map = (kind: In4Party['kind']) => (r: Record<string, unknown>): In4Party => ({
    kind, id: n(r.ID), name: s(r.name), code: sn(r.code),
    pan: sn(r.pan), gstin: sn(r.gstin), msme: sn(r.msme), constitution: null,
    address: sn(r.address), city: sn(r.city), state: sn(r.state), pin: sn(r.pin),
    phone: sn(r.c_mobile) ?? sn(r.c_phone) ?? sn(r.mobile) ?? sn(r.off_phone) ?? sn(r.contact_details),
    email: sn(r.c_email) ?? sn(r.email),
    contact_person: sn(r.contact_person) ?? sn(r.c_name),
    is_active: r.is_active == null ? true : Number(r.is_active) === 1 || r.is_active === true,
    skills: s(r.skills) ? s(r.skills).split('|').map(x => x.trim()).filter(Boolean) : [],
  })
  return [...contractors.map(map('contractor')), ...suppliers.map(map('supplier'))]
}

export interface In4Material {
  id: number; name: string; code: string | null; long_name: string | null; short_name: string | null
  type_id: number | null; type_name: string | null; subtype_id: number | null; subtype_name: string | null
  uom_id: number | null; uom: string | null; hsn_code: string | null; rate: number | null; lead_time: number | null
  is_active: boolean; created_date: string | null
}

export async function extractMaterials(): Promise<In4Material[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT m.ID, m.NAME, m.CODE, m.LONG_NAME, m.SHORT_NAME, st.MATERIAL_TYPE_ID type_id, t.NAME type_name, m.MATERIAL_SUBTYPE_ID subtype_id, st.NAME subtype_name,
           m.UNIT_OF_MEASUREMENT uom_id, u.NAME uom, h.HSNCode hsn_code, m.RATE, m.LEAD_TIME, m.ISACTIVE, m.CREATED_DATE
    FROM PURCH_MATERIAL_LOOKUP m
    LEFT JOIN PURCH_MATERIAL_SUBTYPE_LOOKUP st ON st.ID = m.MATERIAL_SUBTYPE_ID
    LEFT JOIN PURCH_MATERIAL_TYPE_LOOKUP t ON t.ID = st.MATERIAL_TYPE_ID
    LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = m.UNIT_OF_MEASUREMENT
    LEFT JOIN Fin_HSNCode_Master h ON h.Id = m.HSN_ID`)
  return rows.map(r => ({
    id: n(r.ID), name: s(r.NAME), code: sn(r.CODE), long_name: sn(r.LONG_NAME), short_name: sn(r.SHORT_NAME),
    type_id: ni(r.type_id), type_name: sn(r.type_name), subtype_id: ni(r.subtype_id), subtype_name: sn(r.subtype_name),
    uom_id: ni(r.uom_id), uom: sn(r.uom), hsn_code: sn(r.hsn_code), rate: r.RATE == null ? null : n(r.RATE), lead_time: ni(r.LEAD_TIME),
    is_active: r.ISACTIVE == null ? true : Boolean(r.ISACTIVE), created_date: d(r.CREATED_DATE),
  }))
}

export interface In4Store { id: number; name: string; code: string | null; company_id: number | null; address: string | null; location: string | null; is_active: boolean }
export async function extractStores(): Promise<In4Store[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT STORE_ID, STORE_NAME, STORE_CODE, COMPANY_ID, STORE_ADDRESS, STORE_LOCATION, IsACTIVE FROM BI.DIM_STORE`)
  return rows.map(r => ({ id: n(r.STORE_ID), name: s(r.STORE_NAME), code: sn(r.STORE_CODE), company_id: ni(r.COMPANY_ID), address: sn(r.STORE_ADDRESS), location: sn(r.STORE_LOCATION), is_active: /^(active|yes|1|true)$/i.test(s(r.IsACTIVE)) }))
}

/** A trust, as IN4's company master holds it. The Trust Master screen reads
 *  every one of these fields, so all of them are mirrored — it used to fetch
 *  them live and show blanks when it could not. */
export interface In4Company {
  id: number; name: string; code: string | null; print_name: string | null
  address: string | null; print_address: string | null; pin: string | null; print_pin: string | null
  email: string | null; phone: string | null; pan: string | null
  city: string | null; state: string | null; is_active: boolean
}
export async function extractCompanies(): Promise<In4Company[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT co.CompanyID, co.CompanyName, co.CompanyCode, co.CompanyPrintName, co.Active,
           co.Address, co.PrintAddress, co.CompanyPinCode, co.PrintPinCode,
           co.CompanyEmail, co.CompanyContactNo, co.PANNumber,
           cl.NAME city, cst.NAME state
    FROM COMMON.TBLCOMMONCOMPANY co
    LEFT JOIN COMMON_LOCATION_LOOKUP cl ON cl.ID = co.LocationID
    LEFT JOIN COMMON_STATE_LOOKUP cst ON cst.ID = co.StateID`)
  return rows.map(r => ({
    id: n(r.CompanyID), name: s(r.CompanyName), code: sn(r.CompanyCode), print_name: sn(r.CompanyPrintName),
    address: sn(r.Address), print_address: sn(r.PrintAddress), pin: sn(r.CompanyPinCode), print_pin: sn(r.PrintPinCode),
    email: sn(r.CompanyEmail), phone: sn(r.CompanyContactNo), pan: sn(r.PANNumber),
    city: sn(r.city), state: sn(r.state), is_active: r.Active == null ? true : Boolean(r.Active),
  }))
}

/** A trust's GST registrations, each with the address it is registered at. A
 *  trust may hold several, so these are keyed by the registration's own ID. */
export interface In4CompanyGstin { id: number; company_id: number; gstin: string; address: string | null; pincode: string | null }
export async function extractCompanyGstins(): Promise<In4CompanyGstin[]> {
  const rows = await in4Query<Record<string, unknown>>(`SELECT ID, COMPANY_ID, GSTIN_NO, Address, Pincode FROM FIN_COMPANY_GSTIN_LOOKUP`)
  return rows
    .map(r => ({ id: n(r.ID), company_id: n(r.COMPANY_ID), gstin: s(r.GSTIN_NO), address: sn(r.Address), pincode: sn(r.Pincode) }))
    .filter(g => g.gstin)
}

/** The most recent APPROVED purchase order each material appeared on — the
 *  answer Item Master shows, computed by IN4 and mirrored as one row per
 *  material. Supplier and project are kept as ids: in4_parties and
 *  in4_projects already hold those names.
 *
 *  The sub-project is read from the fact table. The screen used to take it
 *  from PURCH_PURCHASE_ORDER.SUBPROJECT_ID, which IN4 leaves empty on all
 *  1,450 purchase orders — so the “In project” link never appeared. The
 *  fact's own SUBPROJECT_ID is filled on every one of the 5,069 lines. */
export interface In4LastPo {
  material_id: number; po_id: number; po_no: string | null; po_dt: string | null
  supplier_id: number | null; rate: number | null; qty: number | null
  project_id: number | null; subproject_id: number | null
}
export async function extractLastPoByMaterial(): Promise<In4LastPo[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT x.MATERIAL_ID, x.PO_ID, x.PO_NO, x.PO_DT, x.SUPPLIER_ID, x.rate, x.qty, x.PROJECT_ID, x.SUBPROJECT_ID
    FROM (
      SELECT f.MATERIAL_ID, f.PO_ID, h.PO_NO, h.PO_DT, f.SUPPLIER_ID, f.NET_RATE rate, f.BASE_PO_QTY qty,
             f.PROJECT_ID, NULLIF(f.SUBPROJECT_ID, 0) SUBPROJECT_ID,
             ROW_NUMBER() OVER (PARTITION BY f.MATERIAL_ID ORDER BY h.PO_DT DESC, f.PO_ID DESC) rn
      FROM BI.FACT_PURCHASE_ORDER_DETAILS f
      JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = f.PO_ID
      WHERE h.STATUS_ID = 2
    ) x WHERE x.rn = 1`)
  return rows.map(r => ({
    material_id: n(r.MATERIAL_ID), po_id: n(r.PO_ID), po_no: sn(r.PO_NO), po_dt: day(r.PO_DT),
    supplier_id: ni(r.SUPPLIER_ID), rate: r.rate == null ? null : Number(r.rate), qty: r.qty == null ? null : Number(r.qty),
    project_id: ni(r.PROJECT_ID), subproject_id: ni(r.SUBPROJECT_ID),
  }))
}

/* ── The purchase side: what was ordered, received and billed ──────────── */

export interface In4PurchaseOrder {
  po_id: number; po_no: string | null; po_dt: string | null
  supplier_id: number | null; project_id: number | null; po_category: string | null
  po_value: number | null; payable_amt: number | null; paid_amt: number | null
  status_id: number | null; status: string | null; grn_status: string | null
}
export async function extractPurchaseOrders(): Promise<In4PurchaseOrder[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT PO_ID, PO_NO, PO_DT, SUPPLIER_ID, PROJECT_ID, PO_CATEGORY,
           PO_VALUE, PAYABLE_AMT, PAID_AMT, STATUS_ID, STATUS, GRN_STATUS
    FROM BI.PURCHASE_ORDER_HEADER`)
  return rows.map(r => ({
    po_id: n(r.PO_ID), po_no: sn(r.PO_NO), po_dt: day(r.PO_DT),
    supplier_id: ni(r.SUPPLIER_ID), project_id: ni(r.PROJECT_ID), po_category: sn(r.PO_CATEGORY),
    po_value: num(r.PO_VALUE), payable_amt: num(r.PAYABLE_AMT), paid_amt: num(r.PAID_AMT),
    status_id: ni(r.STATUS_ID), status: sn(r.STATUS), grn_status: sn(r.GRN_STATUS),
  }))
}

export interface In4PoItem {
  item_id: number; po_id: number; indent_id: number | null; wo_id: number | null
  project_id: number | null; subproject_id: number | null; supplier_id: number | null
  material_id: number | null; uom_id: number | null
  base_po_qty: number | null; grn_qty: number | null; net_rate: number | null; material_value: number | null
}
export async function extractPoItems(): Promise<In4PoItem[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT ITEM_ID, PO_ID, INDENT_ID, WO_ID, PROJECT_ID, SUBPROJECT_ID, SUPPLIER_ID, MATERIAL_ID, UOM_ID,
           BASE_PO_QTY, GRN_QTY, NET_RATE, MATERIAL_VALUE
    FROM BI.FACT_PURCHASE_ORDER_DETAILS`)
  return rows.map(r => ({
    item_id: n(r.ITEM_ID), po_id: n(r.PO_ID), indent_id: ni(r.INDENT_ID), wo_id: ni(r.WO_ID),
    project_id: ni(r.PROJECT_ID), subproject_id: ni(r.SUBPROJECT_ID), supplier_id: ni(r.SUPPLIER_ID),
    material_id: ni(r.MATERIAL_ID), uom_id: ni(r.UOM_ID),
    base_po_qty: num(r.BASE_PO_QTY), grn_qty: num(r.GRN_QTY), net_rate: num(r.NET_RATE), material_value: num(r.MATERIAL_VALUE),
  }))
}

export interface In4GrnItem {
  auto_id: number; grn_id: number | null; po_id: number | null; indent_id: number | null
  material_id: number | null; subproject_id: number | null; supplier_id: number | null
  store_id: number | null; uom_id: number | null
  received_qty: number | null; grn_material_cost: number | null
  /** IN4 own approval state for the receipt: Approved, or Submitted while it
   *  is still being checked. Only Approved moves a bill on. */
  status: string | null
  grn_no: string | null; grn_dt: string | null; delivery_challan_no: string | null
}
export async function extractGrnItems(): Promise<In4GrnItem[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT d.AUTO_ID, d.GRN_ID, d.PO_ID, d.INDENT_ID, d.MATERIAL_ID, d.SUBPROJECT_ID, d.SUPPLIER_ID,
           d.STORE_ID, d.UOM_ID, d.RECIEVED_QTY, d.GRN_MATERIAL_COST,
           g.GRN_NO, g.GRN_DT, g.DELIVERY_CHALAN_NO, g.STATUS
    FROM BI.FACT_PURCHASE_GRN_DETAILS d
    LEFT JOIN BI.DIM_PURCHASE_GRN_HEADER g ON g.GRN_ID = d.GRN_ID`)
  return rows.map(r => ({
    auto_id: n(r.AUTO_ID), grn_id: ni(r.GRN_ID), po_id: ni(r.PO_ID), indent_id: ni(r.INDENT_ID),
    material_id: ni(r.MATERIAL_ID), subproject_id: ni(r.SUBPROJECT_ID), supplier_id: ni(r.SUPPLIER_ID),
    store_id: ni(r.STORE_ID), uom_id: ni(r.UOM_ID),
    received_qty: num(r.RECIEVED_QTY), grn_material_cost: num(r.GRN_MATERIAL_COST),
    grn_no: sn(r.GRN_NO), grn_dt: day(r.GRN_DT), delivery_challan_no: sn(r.DELIVERY_CHALAN_NO),
    status: sn(r.STATUS),
  }))
}

/** Supplier bill lines at their true grain — one row per (certificate, GRN,
 *  material). Finer than in4_supplier_certificates on purpose: a bill can
 *  cover GRNs raised against a DIFFERENT purchase order, and the PO ledger
 *  names that order. */
export interface In4SupplierPayLine {
  auto_id: number; certificate_id: number | null; po_id: number | null; grn_id: number | null
  supplier_id: number | null; subproject_id: number | null; material_id: number | null
  certificate_no: number | null; certificate_dt: string | null
  invoice_no: string | null; invoice_dt: string | null; status_name: string | null
  landed_cost: number | null; certified_amt: number | null; paid_amt: number | null
  tax_deduction_amt: number | null; retention_amt: number | null; adv_recovery_amt: number | null
}
/** The fact and its dimension are read SEPARATELY and joined here, not by IN4.
 *  Neither table is indexed on AUTO_ID, so asking SQL Server to join them is a
 *  4,485 x 4,485 nested loop — over eight minutes, measured, against 0.7 s for
 *  the two plain reads. The sync gets 120 seconds on Vercel; this is the
 *  difference between it finishing and it timing out. */
export async function extractSupplierPayLines(): Promise<In4SupplierPayLine[]> {
  const [facts, dims] = await Promise.all([
    in4Query<Record<string, unknown>>(`
      SELECT AUTO_ID, CERTIFICATE_ID, PO_ID, GRN_ID, SUPPLIER_ID, SUBPROJECT_ID, MATERIAL_ID,
             LANDED_COST, CERTIFIED_AMT, PAID_AMT, TAX_DEDUCTION_AMT, RETENTION_AMT, ADV_RECOVERY_AMT
      FROM BI.FACT_PURCHASE_SUPPLIER_PAY`),
    in4Query<Record<string, unknown>>(`
      SELECT AUTO_ID, CERTIFICATE_NO, CERTIFICATE_DT, INVOICE_NO, INVOICE_DT, STATUS_NAME
      FROM BI.DIM_PURCHASE_SUPPLIER_PAY`),
  ])
  const dim = new Map(dims.map(d => [n(d.AUTO_ID), d]))
  const rows = facts.map(f => ({ ...(dim.get(n(f.AUTO_ID)) ?? {}), ...f }))
  return rows.map(r => ({
    auto_id: n(r.AUTO_ID), certificate_id: ni(r.CERTIFICATE_ID), po_id: ni(r.PO_ID), grn_id: ni(r.GRN_ID),
    supplier_id: ni(r.SUPPLIER_ID), subproject_id: ni(r.SUBPROJECT_ID), material_id: ni(r.MATERIAL_ID),
    certificate_no: ni(r.CERTIFICATE_NO), certificate_dt: day(r.CERTIFICATE_DT),
    invoice_no: sn(r.INVOICE_NO), invoice_dt: day(r.INVOICE_DT), status_name: sn(r.STATUS_NAME),
    landed_cost: num(r.LANDED_COST), certified_amt: num(r.CERTIFIED_AMT), paid_amt: num(r.PAID_AMT),
    tax_deduction_amt: num(r.TAX_DEDUCTION_AMT), retention_amt: num(r.RETENTION_AMT), adv_recovery_amt: num(r.ADV_RECOVERY_AMT),
  }))
}

export interface In4Uom { id: number; name: string; is_active: boolean }
export async function extractUoms(): Promise<In4Uom[]> {
  const rows = await in4Query<Record<string, unknown>>(`SELECT ID, NAME, IsActive FROM COMMON_UOM_LOOKUP`)
  return rows.map(r => ({ id: n(r.ID), name: s(r.NAME), is_active: r.IsActive == null ? true : Boolean(r.IsActive) }))
}

// ── The approval trail ───────────────────────────────────────────────────────

export interface In4CertEvent {
  event_id: number
  certificate_id: number
  display_no: string | null
  at: string
  status: number
  status_name: string | null
  actor_id: number | null
  actor_name: string | null
  remark: string | null
}

/** Every movement of every work-order payment certificate: who, when, to what
 *  status, and the reason they typed. IN4 keeps this in
 *  ENGG_WO_PAYMENT_AUDIT_TRAIL and never edits a row, so the mirror is
 *  append-only in practice and keyed on IN4's own event id.
 *
 *  The timestamp is kept to the second, not truncated to a day. Three
 *  approvals eighty-four seconds apart is a real and useful pattern, and a
 *  date would erase it. */
export async function extractCertEvents(): Promise<In4CertEvent[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT t.ID event_id, t.AUTHORISATION_ID certificate_id, a.DISPLAY_NO display_no,
           t.MODIFIED_DT at, t.STATUS status, s.NAME status_name,
           t.MODIFIED_BY actor_id, e.EMP_NAME actor_name, t.Remarks remark
      FROM ENGG_WO_PAYMENT_AUDIT_TRAIL t
      LEFT JOIN ENGG_WO_PAYMENT_AUTHORISATION a ON a.ID = t.AUTHORISATION_ID
      LEFT JOIN COMMON_STATUS_LOOKUP s ON s.ID = t.STATUS
      LEFT JOIN BI.DIM_HR_EMPLOYEE_MASTER e ON e.EMP_ID = t.MODIFIED_BY`)
  return rows.map(r => ({
    event_id: n(r.event_id), certificate_id: n(r.certificate_id), display_no: sn(r.display_no),
    at: new Date(r.at as string).toISOString(), status: n(r.status), status_name: sn(r.status_name),
    actor_id: ni(r.actor_id), actor_name: sn(r.actor_name), remark: sn(r.remark),
  }))
}
