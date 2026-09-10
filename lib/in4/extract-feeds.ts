// The SELECTs behind the Phase 2 feeds — the Contractor and Supplier reports
// and the masters (the Indent → PO tracker feed left on 10 Sep 2026). Each is one query over a
// view or table named in docs/IN4_DB_MAPPING.md; IN4's column names are kept,
// lower-cased, and dates come out as ISO 'YYYY-MM-DD' strings.

import { in4Query } from './db'
import type { In4ContractorCert } from './contractor'
import type { In4SupplierCert } from './supplier'

const n = (v: unknown): number => (v == null ? 0 : Number(v))
const ni = (v: unknown): number | null => (v == null ? null : Number(v))
const s = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const sn = (v: unknown): string | null => { const t = s(v); return t ? t : null }
const d = (v: unknown): string | null => {
  if (v == null) return null
  const t = v instanceof Date ? v : new Date(String(v))
  return isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10)
}

// ── Contractor certificates ──────────────────────────────────────────────────

export async function extractContractorCerts(): Promise<In4ContractorCert[]> {
  const rows = await in4Query<Record<string, unknown>>(`
    SELECT 'wo' kind, c.CERTIFICATE_ID, c.CERTIFICATE_TYPE_ID type_id, c.CERTIFICATE_SUBTYPE type_name, c.WORK_ORDER_ID wo_id, w.DISPLAY_NO wo_no, w.WORK_ORDER_VALUE wo_value,
           w.PROJECT_ID, w.SUBPROJECT_ID, w.SKILL_ID, w.SUB_SKILL_ID, w.SERVICE_PROVIDER_ID contractor_id, c.STATUS,
           c.INVOICE_NO, c.INVOICE_DATE, c.CREATION_DT,
           c.GROSS_AMT gross,
           (ISNULL(c.ADVANCE_RECOVERY_AMT,0) + ISNULL(c.MISC_EXPENSE_RECOVERY_AMT,0) + ISNULL(c.MATERIAL_ADJUSTMENT,0) + ISNULL(c.DEBIT_NOTE_RECOVERY_AMT,0)) recoveries,
           c.PAID_AMT paid, (ISNULL(c.TAX_DED,0) + ISNULL(c.ADDITIONAL_DEDUCTION_AMT,0)) deductions, c.RETENTION_AMT retention, c.Amt_Outstanding outstanding, c.CERTIFICATE_AMT certified
    FROM ENGG_RPT_WO_CERTIFICATE_DETAILS c
    JOIN ENGG_WORK_ORDER w ON w.ID = c.WORK_ORDER_ID
    UNION ALL
    SELECT 'advance', a.CERTIFICATE_ID, 1, 'Advance', a.WO_ID, w.DISPLAY_NO, w.WORK_ORDER_VALUE,
           w.PROJECT_ID, a.SUBPROJECT_ID, w.SKILL_ID, w.SUB_SKILL_ID, w.SERVICE_PROVIDER_ID, a.STATUS,
           a.BILL_NO, a.BILL_DT, a.CREATED_DT,
           a.GROSS_BILL_AMT, 0, (ISNULL(a.PAYABLE_AMT,0) - ISNULL(a.OUTSTANDING_AMT,0)), ISNULL(a.TAX_DEDUCTION_AMT,0), 0, a.OUTSTANDING_AMT, a.CERTIFIED_AMT
    FROM BI.ENGG_ADVANCE_PAYMENTS_HEADER a
    JOIN ENGG_WORK_ORDER w ON w.ID = a.WO_ID
    UNION ALL
    SELECT 'misc', m.CERTIFICATE_ID, 0, 'Misc', NULL, NULL, 0,
           sp.PROJECT_ID, m.SUBPROJECT_ID, NULL, NULL, m.CONTRACTOR_ID, m.STATUS,
           m.BILL_NO, m.BILL_DT, m.CREATED_DT,
           m.GROSS_BILL_AMT, ISNULL(m.RECOVERED_AMT,0), (ISNULL(m.GROSS_BILL_AMT,0) - ISNULL(m.TAX_DEDUCTION_AMT,0) - ISNULL(m.OUTSTANDING_AMT,0)), ISNULL(m.TAX_DEDUCTION_AMT,0), 0, m.OUTSTANDING_AMT, m.CERTIFICATE_AMT
    FROM BI.ENGG_MISC_PAYMENTS_HEADER m
    JOIN ENGG_SUBPROJECT sp ON sp.ID = m.SUBPROJECT_ID`)
  return rows.map(r => ({
    kind: r.kind as In4ContractorCert['kind'], certificate_id: n(r.CERTIFICATE_ID),
    certificate_type_id: ni(r.type_id), certificate_type: sn(r.type_name),
    wo_id: ni(r.wo_id), wo_no: sn(r.wo_no), wo_value: n(r.wo_value),
    project_id: ni(r.PROJECT_ID), subproject_id: n(r.SUBPROJECT_ID), skill_id: ni(r.SKILL_ID), subskill_id: ni(r.SUB_SKILL_ID),
    contractor_id: ni(r.contractor_id), status: n(r.STATUS),
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
      SELECT CERTIFICATE_ID, MAX(CAST(CERTIFICATE_NO AS NVARCHAR(50))) certificate_no FROM BI.DIM_PURCHASE_SUPPLIER_PAY GROUP BY CERTIFICATE_ID
    )
    SELECT 'payment' kind, f.CERTIFICATE_ID, MAX(nos.certificate_no) certificate_no, MAX(f.SUBPROJECT_ID) subproject_id, MAX(f.SUPPLIER_ID) supplier_id, MAX(f.PO_ID) po_id, MAX(f.STATUS_ID) status,
           MAX(c.category) category,
           SUM(f.CERTIFIED_AMT) certified, SUM(f.LANDED_COST) landed, SUM(f.TAX_ADDITION_AMT) tax_add, SUM(f.TAX_DEDUCTION_AMT) tax_ded,
           SUM(f.ADV_RECOVERY_AMT) adv_recovery, SUM(f.DEBIT_NOTE_ADJ_AMT) debit_note, SUM(f.RETENTION_AMT) retention,
           SUM(f.PAYABLE_AMT) payable, SUM(f.PAID_AMT) paid, SUM(f.CERTIFIED_OUT_AMT) outstanding
    FROM BI.FACT_PURCHASE_SUPPLIER_PAY f
    LEFT JOIN catagg c ON c.CERTIFICATE_ID = f.CERTIFICATE_ID
    LEFT JOIN nos ON nos.CERTIFICATE_ID = f.CERTIFICATE_ID
    GROUP BY f.CERTIFICATE_ID
    UNION ALL
    SELECT 'advance', a.CERTIFICATE_ID, MAX(CAST(a.CERTIFICATE_NO AS NVARCHAR(50))), MAX(a.SUBPROJECT_ID), MAX(a.SUPPLIER_ID), MAX(a.PO_ID), MAX(a.STATUS_ID),
           NULL,
           SUM(a.CERTIFIED_AMT), SUM(a.GROSS_AMT), 0, 0,
           0, 0, 0,
           SUM(a.GROSS_AMT), SUM(a.TILL_DT_PAID_AMT), SUM(a.OUTSTANDING_AMT)
    FROM BI.FACT_PURCHASE_SUPPLIER_ADV_PAY a
    GROUP BY a.CERTIFICATE_ID`)
  return rows.map(r => ({
    kind: r.kind as In4SupplierCert['kind'], certificate_id: n(r.CERTIFICATE_ID), certificate_no: sn(r.certificate_no),
    project_id: null, subproject_id: n(r.subproject_id), supplier_id: ni(r.supplier_id), po_id: ni(r.po_id), status: n(r.status),
    category: sn(r.category),
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

export interface In4Company { id: number; name: string; code: string | null; print_name: string | null }
export async function extractCompanies(): Promise<In4Company[]> {
  const rows = await in4Query<Record<string, unknown>>(`SELECT CompanyID, CompanyName, CompanyCode, CompanyPrintName FROM COMMON.TBLCOMMONCOMPANY`)
  return rows.map(r => ({ id: n(r.CompanyID), name: s(r.CompanyName), code: sn(r.CompanyCode), print_name: sn(r.CompanyPrintName) }))
}

export interface In4Uom { id: number; name: string; is_active: boolean }
export async function extractUoms(): Promise<In4Uom[]> {
  const rows = await in4Query<Record<string, unknown>>(`SELECT ID, NAME, IsActive FROM COMMON_UOM_LOOKUP`)
  return rows.map(r => ({ id: n(r.ID), name: s(r.NAME), is_active: r.IsActive == null ? true : Boolean(r.IsActive) }))
}
