// Printing a purchase order in IN4's OWN format — the PO twin of wo-print.ts.
//
// ── WHAT WAS ESTABLISHED FIRST (8 Sept 2026, live IN4) ──────────────────────
//
// Template 100, "Purchase Order For SRM", is the live PO format. Not a guess
// from the name: IN4's print log (`COMMON_HtmlPrintCount`, event 33) shows
// 3,461 of the 3,680 purchase-order prints ever made used it, the latest on
// the day this was written. Six older templates share the event; none has
// been printed since May 2023.
//
// The template has 65 merge tags and THREE repeating rows — the material
// lines, a delivery schedule and the conditions — so it is rendered with
// `renderTemplateGroups` rather than the work order's single-row renderer.
//
// Where IN4 keeps each part:
//   · Lines — `PURCH_PURCHASE_ORDER_RATE` (quantity, rate, discount, value per
//     material; the current values after any amendment). `PURCH_PURCHASE_
//     ORDER_ITEMS` carries the indent split and holds a zero rate.
//   · Discounted rate — IN4's own UNIT_RATE − DISCOUNTED_RATE_AMOUNT. Checked
//     on PO 1419: 35.15 − 5.3618 = 29.79, × 403 = 12,004.64, exactly its
//     TOTAL_MATERIAL_VALUE.
//   · GST split — `COMMON_TAX_LINE_ITEM_VIEW`, EVENT_NAME 'Purchase Order',
//     one row per line per tax (CGST 9.00%, SGST 9.00%, IGST 18.00% …).
//     `PURCH_PURCHASE_ORDER_TEMP_TAX_DETAILS` is a screen's scratch table
//     (29,543 distinct "PO ids" for 1,442 real orders, material ids that do
//     not match the order) and is deliberately NOT read.
//   · Freight / other charges — the header. The charge line table IN4 has
//     for packing, loading and unloading is EMPTY for every order, so those
//     three tags stay blank and are reported.
//   · Paying company — no PO names one (BILL_TO_COMPANY_ID is null on all
//     1,442), so it is the project's certifying company, which is also the
//     code inside every PO number (PO/SRASSK/NGH/… → SRASSK).
//   · HSN — `PURCH_MATERIAL_LOOKUP.HSN_ID`, set on 7 of 4,041 materials.
//   · Delivery schedule — `PURCH_PURCHASE_ORDER_SCHEDULE`, filled for 17
//     orders in all.
//   · Conditions — `PURCH_PURCHASE_ORDER_CONDITION` holds the full text per
//     order with its type ("Acknowledgment of Order", "Transit Insurance").
//   · Buyer-side contact and company logo — nothing on the PO record.
//
// Same honesty rules as the work order: a tag IN4 cannot fill is left blank
// and named on the page; the foot line says CT Hub rendered it and that IN4
// is the record. [[feedback_dont_guess_follow_the_source]]

import { in4Query, in4Config } from './db'
import { In4NotConfigured, escapeHtml, fmtDate, fmtMoney, fmtNum, type PrintRow, type RowGroup } from './wo-print'
import { amountInWords } from './amount-in-words'

/** The eight tags of one material line in template 100. */
export const PO_ITEM_TAGS = [
  '[MatSerial.No]', '[Total_Material_Details_Material_Name]', '[Total_Material_Details_Additional_Information]',
  '[Total_Material_HSN_CODE]', '[Total_Material_Details_PO_UOM]', '[Total_Material_Details_PO_OrderQty]',
  '[Total_Material_Details_Discounted_Rate]', '[Total_Material_Details_Material_Cost]',
] as const

/** One delivery-schedule row. */
export const PO_SCHEDULE_TAGS = ['[DelSch_Mat_Name]', '[DelSch_Mat_Order_Qty]', '[DelSch_Mat_UOM]', '[DelSch_Date]'] as const

/** One condition row: its type and its text. */
export const PO_CONDITION_TAGS = ['[General Conditions Category]', '[General Conditions]'] as const

export interface PoSources {
  items: number
  schedule: number
  conditions: number
  /** How many GST components IN4 holds for the order (CGST, SGST, IGST). */
  taxes: number
  /** Plain-English gaps, each a fact about IN4 rather than about the renderer. */
  gaps: string[]
}

export interface PoPrintData {
  poId: number
  displayNo: string
  scalars: Record<string, string | null>
  groups: RowGroup[]
  sources: PoSources
  templateId: number
  templateName: string
  templateHtml: string
}

/** The raw IN4 rows the pure builder works from, so the mapping is tested
 *  without a database. Column names are IN4's own, aliases as in the SQL. */
export interface PoRaw {
  po: Record<string, unknown>
  lines: Record<string, unknown>[]
  indents: { DISPLAY_NO: unknown; CREATION_DT: unknown }[]
  schedule: Record<string, unknown>[]
  conditions: { text: unknown; type_name: unknown }[]
  taxes: { TAX_TYPE: unknown; amt: unknown }[]
}

const str = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const num = (v: unknown) => (v == null ? 0 : Number(v))

/** Everything template 100 needs, from the raw rows. Pure. */
export function buildPoPrint(raw: PoRaw): Pick<PoPrintData, 'scalars' | 'groups' | 'sources'> {
  const p = raw.po
  const displayNo = str(p.DISPLAY_NO) ?? `PO ${p.ID}`
  const poValue = p.PO_VALUE ?? p.TOTAL_VALUE

  const taxes = new Map<string, number>()
  for (const t of raw.taxes) {
    const k = String(t.TAX_TYPE ?? '').trim().toUpperCase()
    if (k) taxes.set(k, (taxes.get(k) ?? 0) + num(t.amt))
  }
  const taxAdditions = num(p.PO_TAX_ADDITIONS)
  // No split rows and no tax on the order: three honest zeros. No split rows
  // but tax on the order: blank, and said out loud below.
  const taxCell = (k: string) =>
    taxes.size > 0 ? fmtMoney(taxes.get(k) ?? 0) : taxAdditions === 0 ? fmtMoney(0) : null

  const indentNos = raw.indents.map(i => str(i.DISPLAY_NO)).filter((s): s is string => s != null)
  const indentDts = raw.indents.map(i => fmtDate(i.CREATION_DT)).filter((s): s is string => s != null)

  const scalars: Record<string, string | null> = {
    // The order
    '[PODetails_No]': displayNo,
    '[PODetails_Purchase_Order_Date]': fmtDate(p.PO_DT) ?? fmtDate(p.CREATED_DT),
    '[PODetails_Payment_Terms]': str(p.PAYMENT_TERMS),
    '[PO_Project]': str(p.project),
    '[PO_SubProject]': str(p.subproject),
    '[Indent_Details_IndentNo]': indentNos.length ? [...new Set(indentNos)].join(', ') : null,
    '[Indent_Details_IndentDt]': indentDts.length ? [...new Set(indentDts)].join(', ') : null,

    // The supplier
    '[SUPPLIERNAME]': str(p.supplier_print) ?? str(p.supplier),
    '[STREET]': str(p.addr),
    '[CITY]': str(p.city),
    '[PINCODE]': str(p.pin),
    '[STATE]': str(p.state),
    '[COUNTRY]': str(p.country),
    '[OFFPHONENO]': str(p.off_phone) ?? str(p.mobile),
    '[EMAIL]': str(p.email),
    '[CONTACTNAME]': str(p.supplier_contact),
    '[PO_SUPPLIER_GSTIN_NO]': str(p.supplier_gstin),
    '[PANNO]': str(p.supplier_pan),

    // The paying company
    '[CompanyName]': str(p.company_print) ?? str(p.company),
    '[COMPANYNAME]': str(p.company_print) ?? str(p.company),
    '[CompanyCode]': str(p.company_code),
    '[Company_PANNO]': str(p.co_pan),
    '[PO_COMPANY_GSTIN_NO]': str(p.co_gstin),
    '[CompanyAddress1]': str(p.co_addr1) ?? str(p.co_paddr1),
    '[CompanyAddress2]': str(p.co_addr2) ?? str(p.co_paddr2),
    '[PrintAddress1]': str(p.co_paddr1) ?? str(p.co_addr1),
    '[PrintAddress2]': str(p.co_paddr2) ?? str(p.co_addr2),
    '[CompanyCity]': str(p.co_city),
    '[PrintCity]': str(p.co_city),
    '[CompanyPINCode]': str(p.co_pin) ?? str(p.co_ppin),
    '[PrintPincode]': str(p.co_ppin) ?? str(p.co_pin),
    '[CompanyState]': str(p.co_state),
    '[PrintState]': str(p.co_state),

    // The money block. Every figure is IN4's own header value; only the
    // words are computed.
    '[Tax_And_Amount_Total_Material_Cost_PO_Currency]': fmtMoney(p.PO_MATERIAL_VALUE),
    '[Tax_And_Amount_Discount]': fmtMoney(p.DISCOUNT_AMOUNT ?? 0),
    '[Vch_Freight_charge]': fmtMoney(p.PO_FREIGHT_CHARGES ?? p.FREIGHT_CHARGES ?? 0),
    '[Vch_Ohter_Charges]': fmtMoney(p.PO_OTHER_CHARGES ?? p.OTHER_CHARGES ?? 0),
    '[TAX_AND_AMOUNT_CGST_TOTAL]': taxCell('CGST'),
    '[TAX_AND_AMOUNT_SGST_TOTAL]': taxCell('SGST'),
    '[TAX_AND_AMOUNT_IGST_TOTAL]': taxCell('IGST'),
    '[Tax_And_Amount_PO_Amount_post_discount]': fmtMoney(poValue),
    '[Total_PO_Amount_InWords_POCurrency]': amountInWords(poValue),
  }

  const uomByMaterial = new Map<string, string>()
  const items: PrintRow[] = raw.lines.map((l, i) => {
    const rate = num(l.UNIT_RATE)
    const discount = num(l.DISCOUNTED_RATE_AMOUNT)
    const brand = str(l.brand)
    const extra = [str(l.DESCRIPTION), str(l.REMARKS), brand ? `Brand: ${brand}` : null]
      .filter((s): s is string => s != null)
    const uom = str(l.uom) ?? ''
    if (l.MATERIAL_ID != null && uom) uomByMaterial.set(String(l.MATERIAL_ID), uom)
    return {
      '[MatSerial.No]': String(i + 1),
      '[Total_Material_Details_Material_Name]': str(l.material) ?? '',
      '[Total_Material_Details_Additional_Information]': [...new Set(extra)].join(' · '),
      '[Total_Material_HSN_CODE]': str(l.hsn) ?? '',
      '[Total_Material_Details_PO_UOM]': uom,
      '[Total_Material_Details_PO_OrderQty]': fmtNum(l.ORDER_QTY) ?? '',
      '[Total_Material_Details_Discounted_Rate]': fmtNum(rate - discount, 2) ?? '',
      '[Total_Material_Details_Material_Cost]': fmtMoney(l.TOTAL_MATERIAL_VALUE) ?? '',
    }
  })

  const schedule: PrintRow[] = raw.schedule.map(s => ({
    '[DelSch_Mat_Name]': str(s.material) ?? '',
    '[DelSch_Mat_Order_Qty]': fmtNum(s.SCHEDULED_QTY) ?? '',
    '[DelSch_Mat_UOM]': str(s.uom) ?? uomByMaterial.get(String(s.MATERIAL_ID)) ?? '',
    '[DelSch_Date]': fmtDate(s.SCH_DATE) ?? '',
  }))

  // IN4 stores each condition as plain text with line breaks; the row is
  // written raw so the breaks survive, after escaping the text itself.
  const conditions: PrintRow[] = raw.conditions
    .filter(c => str(c.text) != null)
    .map(c => ({
      '[General Conditions Category]': escapeHtml(str(c.type_name) ?? ''),
      '[General Conditions]': escapeHtml(String(c.text).trim()).replace(/\r?\n/g, '<br>'),
    }))

  const groups: RowGroup[] = [
    { tags: PO_ITEM_TAGS, rows: items, emptyText: 'IN4 holds no material lines for this purchase order.' },
    { tags: PO_SCHEDULE_TAGS, rows: schedule, emptyText: 'IN4 holds no delivery schedule for this purchase order.' },
    { tags: PO_CONDITION_TAGS, rows: conditions, emptyText: 'IN4 holds no terms and conditions for this purchase order.', raw: true },
  ]

  const gaps: string[] = []
  if (items.length === 0) gaps.push('IN4 holds no material lines for this order.')
  const noHsn = raw.lines.filter(l => str(l.hsn) == null).length
  if (items.length > 0 && noHsn > 0) {
    gaps.push(noHsn === items.length
      ? `No HSN code on ${items.length === 1 ? 'the material line' : `any of the ${items.length} material lines`} — IN4 holds one for 7 of its 4,041 materials — so that column is blank.`
      : `${noHsn} of ${items.length} material lines have no HSN code in IN4, so those cells are blank.`)
  }
  if (conditions.length === 0) {
    gaps.push('This order has NO terms and conditions in IN4. It will print without any.')
  }
  if (schedule.length === 0) {
    gaps.push('IN4 holds no delivery schedule for this order (17 of its 1,442 purchase orders have one); that table says so.')
  }
  if (taxes.size === 0 && taxAdditions > 0) {
    gaps.push(`IN4 holds ${fmtMoney(taxAdditions)} of GST on this order but no CGST/SGST/IGST split, so those three lines are blank.`)
  }
  if (!str(p.co_gstin)) {
    // SRASSK holds no GSTIN anywhere in IN4 (see wo-print.ts); it is the
    // paying trust on most purchase orders too.
    gaps.push('IN4 holds no GST number for the paying trust, so that line is blank.')
  }
  if (!str(p.supplier_gstin)) gaps.push('IN4 holds no GSTIN for this supplier, so that line is blank.')
  if (p.ACTIVE_AMENDMENT_ID != null) {
    gaps.push('This order was amended in IN4. The quantities and values here are the current (amended) ones.')
  }
  gaps.push('Packing, loading and unloading charges, the buyer-side contact person and the company logo are blank: IN4 holds none of them on any purchase order.')

  return {
    scalars,
    groups,
    sources: { items: items.length, schedule: schedule.length, conditions: conditions.length, taxes: taxes.size, gaps },
  }
}

/**
 * Everything template 100 needs for one purchase order. The id is IN4's own
 * `PURCH_PURCHASE_ORDER.ID`, which the orders tree carries from
 * `BI.PURCHASE_ORDER_HEADER`, so there is no number matching in this path.
 * SELECT only.
 */
export async function loadPoPrint(poId: number): Promise<PoPrintData> {
  if (!in4Config()) throw new In4NotConfigured()
  if (!Number.isInteger(poId) || poId <= 0) throw new Error(`Not a purchase-order id: ${poId}`)

  // The template and the order need only the purchase-order id — neither waits
  // on the other, so they cross the ocean together rather than one after the next.
  const [[tpl], [po]] = await Promise.all([
    // The template IN4 actually prints for event 33, by its own print log.
    in4Query<{ TemplateID: number; TemplateName: string; html: string }>(`
    SELECT TOP 1 t.TemplateID, t.TemplateName, CAST(t.TemplateHtml AS nvarchar(MAX)) AS html
    FROM COMMON_HtmlTemplate t
    LEFT JOIN (
      SELECT TEMPLATE_ID, COUNT(*) AS prints, MAX(PRINT_DATE) AS last_print
      FROM COMMON_HtmlPrintCount WHERE EVENT_ID = 33 GROUP BY TEMPLATE_ID
    ) p ON p.TEMPLATE_ID = t.TemplateID
    WHERE t.EventID = 33 AND t.Active = 1
      AND LEN(CAST(t.TemplateHtml AS nvarchar(MAX))) > 0
    ORDER BY p.last_print DESC, p.prints DESC, t.LastModifiedOn DESC`),

    in4Query<Record<string, unknown>>(`
    SELECT p.ID, p.DISPLAY_NO, p.CREATED_DT, p.PAYMENT_TERMS, p.DELIVERY_SITE, p.DISCOUNT_AMOUNT,
           p.FREIGHT, p.FREIGHT_CHARGES, p.HANDLING_CHARGES, p.OTHER_CHARGES, p.TOTAL_VALUE,
           p.SUPP_QUOTATION_NO, p.POREFNO, p.STATUS, p.ACTIVE_AMENDMENT_ID,
           h.PO_DT, h.PO_VALUE, h.PO_MATERIAL_VALUE, h.PO_TAX_ADDITIONS, h.PO_FREIGHT_CHARGES,
           h.PO_HANDLING_CHARGE, h.PO_OTHER_CHARGES, h.STATUS status_name,
           s.NAME supplier, s.PrintName supplier_print, s.PAN supplier_pan, s.GSTIN_NO supplier_gstin,
           s.CONTACT_NAME supplier_contact,
           a.ADDR addr, a.PIN pin, a.OFF_PHONE off_phone, a.MOBILE mobile, a.EMAIL email,
           l.NAME city, st.NAME state, cn.NAME country,
           prj.NAME project, sub.SUBPROJECT_NAME subproject,
           co.CompanyName company, co.CompanyCode company_code, co.CompanyPrintName company_print,
           co.CompanyAddress1 co_addr1, co.CompanyAddress2 co_addr2, co.CompanyPinCode co_pin,
           co.PrintAddress1 co_paddr1, co.PrintAddress2 co_paddr2, co.PrintPinCode co_ppin,
           co.PANNumber co_pan, cl.NAME co_city, cst.NAME co_state, gst.GSTIN_NO co_gstin
    FROM PURCH_PURCHASE_ORDER p
    LEFT JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = p.ID
    LEFT JOIN PURCH_SUPPLIER s ON s.ID = p.SUPPLIER_ID
    LEFT JOIN COMMON_ADDRESS a ON a.ID = s.ADDR_ID
    LEFT JOIN COMMON_LOCATION_LOOKUP l ON l.ID = a.LOCATION_ID
    LEFT JOIN COMMON_STATE_LOOKUP st ON st.ID = a.STATE_ID
    LEFT JOIN COMMON_COUNTRY_LOOKUP cn ON cn.ID = a.COUNTRY_ID
    LEFT JOIN ENGG_PROJECT prj ON prj.ID = p.PROJECT_ID
    LEFT JOIN ENGG_SUBPROJECT sub ON sub.ID = p.SUBPROJECT_ID
    -- No order names its paying company; the project's certifying company is
    -- the one whose code sits inside every PO number.
    LEFT JOIN COMMON.TBLCOMMONCOMPANY co ON co.CompanyID = COALESCE(p.BILL_TO_COMPANY_ID, prj.CERT_COMPANY_ID)
    LEFT JOIN COMMON_LOCATION_LOOKUP cl ON cl.ID = co.LocationID
    LEFT JOIN COMMON_STATE_LOOKUP cst ON cst.ID = co.StateID
    OUTER APPLY (SELECT TOP 1 g.GSTIN_NO FROM FIN_COMPANY_GSTIN_LOOKUP g
                 WHERE g.COMPANY_ID = co.CompanyID
                 ORDER BY CASE WHEN g.STATE_ID = co.StateID THEN 0 ELSE 1 END, g.ID) gst
    WHERE p.ID = ${poId}`),
  ])
  if (!tpl?.html) throw new Error('IN4 holds no active purchase-order print template (event 33).')
  if (!po) throw new Error(`IN4 has no purchase order with id ${poId}.`)

  const [lines, indents, schedule, conditions, taxes] = await Promise.all([
    in4Query<Record<string, unknown>>(`
      SELECT r.ID, r.MATERIAL_ID, m.NAME material, hs.HSNCode hsn, u.NAME uom, b.NAME brand,
             r.ORDER_QTY, r.UNIT_RATE, r.DISCOUNT_PCT, r.DISCOUNTED_RATE_AMOUNT, r.TOTAL_MATERIAL_VALUE,
             r.DESCRIPTION, r.REMARKS
      FROM PURCH_PURCHASE_ORDER_RATE r
      LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = r.MATERIAL_ID
      LEFT JOIN Fin_HSNCode_Master hs ON hs.Id = m.HSN_ID
      LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = r.MATERIAL_UOM
      LEFT JOIN PURCH_MATERIAL_BRAND_LOOKUP b ON b.ID = r.MATERIAL_BRAND_ID
      WHERE r.PURCHASE_ORDER_ID = ${poId}
      ORDER BY r.ID`),
    in4Query<{ DISPLAY_NO: unknown; CREATION_DT: unknown }>(`
      SELECT DISTINCT i.DISPLAY_NO, i.CREATION_DT
      FROM PURCH_PURCHASE_ORDER_INDENT pi
      JOIN PURCH_INDENT i ON i.ID = pi.INDENT_ID
      WHERE pi.PURCHASE_ORDER_ID = ${poId}
      ORDER BY i.DISPLAY_NO`),
    in4Query<Record<string, unknown>>(`
      SELECT s.SCH_DATE, d.MATERIAL_ID, d.SCHEDULED_QTY, m.NAME material
      FROM PURCH_PURCHASE_ORDER_SCHEDULE s
      JOIN PURCH_PURCHASE_ORDER_SCHEDULE_DETAIL d ON d.SCH_ID = s.ID
      LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = d.MATERIAL_ID
      WHERE s.PURCHASE_ORDER_ID = ${poId}
      ORDER BY s.SCH_DATE, d.ID`),
    in4Query<{ text: unknown; type_name: unknown }>(`
      SELECT CAST(c.CONDITION_NAME AS nvarchar(MAX)) text, t.NAME type_name
      FROM PURCH_PURCHASE_ORDER_CONDITION c
      LEFT JOIN PURCH_CONDITION_LOOKUP l ON l.ID = c.CONDITION_ID
      LEFT JOIN PURCH_CONDITION_TYPE_LOOKUP t ON t.ID = l.COND_TYPE_ID
      WHERE c.PURCHASE_ORDER_ID = ${poId}
      ORDER BY c.ID`),
    in4Query<{ TAX_TYPE: unknown; amt: unknown }>(`
      SELECT TAX_TYPE, SUM(AMOUNT) amt
      FROM COMMON_TAX_LINE_ITEM_VIEW
      WHERE PO_ID = ${poId} AND EVENT_NAME = 'Purchase Order'
      GROUP BY TAX_TYPE`),
  ])

  const built = buildPoPrint({ po, lines, indents, schedule, conditions, taxes })
  return {
    poId,
    displayNo: str(po.DISPLAY_NO) ?? `PO ${poId}`,
    ...built,
    templateId: tpl.TemplateID,
    templateName: tpl.TemplateName,
    templateHtml: tpl.html,
  }
}
