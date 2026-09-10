import { describe, it, expect } from 'vitest'
import { renderTemplateGroups } from './wo-print'
import { buildPoPrint, PO_ITEM_TAGS, PO_SCHEDULE_TAGS, PO_CONDITION_TAGS, type PoRaw } from './po-print'

// Cut down from IN4's real template 100: the three repeating rows exactly as
// IN4 writes them, one header tag block and the money block.
const TPL = `<p>Purchase Order [PODetails_No] dated [PODetails_Purchase_Order_Date]</p>
<p>[SUPPLIERNAME], [CITY] — GSTIN [PO_SUPPLIER_GSTIN_NO]</p>
<table><tbody>
  <tr><td>Sr</td><td>Material</td><td>Info</td><td>HSN</td><td>UOM</td><td>Qty</td><td>Rate</td><td>Cost</td></tr>
  <tr class="item"><td>[MatSerial.No]</td><td>[Total_Material_Details_Material_Name]</td><td>[Total_Material_Details_Additional_Information]</td><td>[Total_Material_HSN_CODE]</td><td>[Total_Material_Details_PO_UOM]</td><td>[Total_Material_Details_PO_OrderQty]</td><td>[Total_Material_Details_Discounted_Rate]</td><td>[Total_Material_Details_Material_Cost]</td></tr>
</tbody></table>
<table><tbody>
  <tr><td>Material</td><td>Qty</td><td>UOM</td><td>Date</td></tr>
  <tr class="sched"><td>[DelSch_Mat_Name]</td><td>[DelSch_Mat_Order_Qty]</td><td>[DelSch_Mat_UOM]</td><td>[DelSch_Date]</td></tr>
</tbody></table>
<p>Total [Tax_And_Amount_Total_Material_Cost_PO_Currency] · CGST [TAX_AND_AMOUNT_CGST_TOTAL] · SGST [TAX_AND_AMOUNT_SGST_TOTAL] · IGST [TAX_AND_AMOUNT_IGST_TOTAL]</p>
<p>Grand total [Tax_And_Amount_PO_Amount_post_discount] ([Total_PO_Amount_InWords_POCurrency])</p>
<table><tbody>
  <tr class="cond"><td>[General Conditions Category]</td><td>[General Conditions]</td></tr>
</tbody></table>
<p>Contact [Contact_Name] · Packing [Vch_Packing_Forwarding]</p>`

// PO/SRASSK/NGH/2025-26/92 as IN4 holds it on 8 Sept 2026.
const RAW: PoRaw = {
  po: {
    ID: 1164, DISPLAY_NO: 'PO/SRASSK/NGH/2025-26/92', PO_DT: new Date('2026-03-26T00:00:00Z'),
    PAYMENT_TERMS: 'Payment terms- 100% Payment after successfully material delivered at site.',
    TOTAL_VALUE: 90683, PO_VALUE: 90683, PO_MATERIAL_VALUE: 76850, PO_TAX_ADDITIONS: 13833,
    PO_FREIGHT_CHARGES: 0, PO_OTHER_CHARGES: 0, DISCOUNT_AMOUNT: 0, ACTIVE_AMENDMENT_ID: null,
    supplier: 'NATUROPROTECT', supplier_print: 'NATUROPROTECT', supplier_pan: 'AAEFN0301R',
    supplier_gstin: '24AAEFN0301R1ZE', supplier_contact: 'Shrenik Shah',
    addr: '8Th floor, Office no.821, Homeland City', pin: '395007', off_phone: '9825600406', email: 'info@naturoprotect.com',
    city: 'Surat', state: 'Gujarat', country: 'India', project: 'New Guest House', subproject: null,
    company: 'Shrimad Rajchandra Adhyatmik Satsang Sadhana Kendra', company_code: 'SRASSK',
    co_pan: 'AABTS2637Q', co_city: 'Valsad', co_state: 'Gujarat', co_pin: '396050', co_gstin: null,
  },
  lines: [{
    ID: 3643, MATERIAL_ID: 3285, material: 'Pidilite - Roff (T02) Grey', hsn: null, uom: 'Kgs', brand: null,
    ORDER_QTY: 5800, UNIT_RATE: 13.25, DISCOUNT_PCT: 0, DISCOUNTED_RATE_AMOUNT: 0, TOTAL_MATERIAL_VALUE: 76850,
    DESCRIPTION: '', REMARKS: '',
  }],
  indents: [{ DISPLAY_NO: 'IND/SRASSK/NGH/2025-26/99', CREATION_DT: new Date('2026-03-20T00:00:00Z') }],
  schedule: [],
  conditions: [
    { type_name: 'Acknowledgment of Order', text: '1. The Vendor shall acknowledge receipt.\n2. Within three days.' },
    { type_name: 'Transit Insurance', text: 'Transit insurance to vendor account.' },
  ],
  taxes: [{ TAX_TYPE: 'CGST', amt: 6916.5 }, { TAX_TYPE: 'SGST', amt: 6916.5 }],
}

describe('buildPoPrint — IN4’s purchase order, tag by tag', () => {
  const b = buildPoPrint(RAW)

  it('fills the order, supplier and company tags from IN4’s own columns', () => {
    expect(b.scalars['[PODetails_No]']).toBe('PO/SRASSK/NGH/2025-26/92')
    expect(b.scalars['[PODetails_Purchase_Order_Date]']).toBe('26 Mar 2026')
    expect(b.scalars['[SUPPLIERNAME]']).toBe('NATUROPROTECT')
    expect(b.scalars['[PO_SUPPLIER_GSTIN_NO]']).toBe('24AAEFN0301R1ZE')
    expect(b.scalars['[CompanyCode]']).toBe('SRASSK')
    expect(b.scalars['[Indent_Details_IndentNo]']).toBe('IND/SRASSK/NGH/2025-26/99')
  })

  it('takes the GST split from IN4’s tax lines and writes the total in words', () => {
    expect(b.scalars['[TAX_AND_AMOUNT_CGST_TOTAL]']).toBe('6,916.5')
    expect(b.scalars['[TAX_AND_AMOUNT_SGST_TOTAL]']).toBe('6,916.5')
    expect(b.scalars['[TAX_AND_AMOUNT_IGST_TOTAL]']).toBe('0')
    expect(b.scalars['[Tax_And_Amount_PO_Amount_post_discount]']).toBe('90,683')
    expect(b.scalars['[Total_PO_Amount_InWords_POCurrency]']).toBe('Rupees Ninety Thousand Six Hundred Eighty-Three Only')
  })

  it('leaves the three GST lines BLANK — not zero — when IN4 has tax but no split', () => {
    const c = buildPoPrint({ ...RAW, taxes: [] })
    expect(c.scalars['[TAX_AND_AMOUNT_CGST_TOTAL]']).toBeNull()
    expect(c.sources.gaps.some(g => g.includes('no CGST/SGST/IGST split'))).toBe(true)
  })

  it('writes honest zeros when the order carries no tax at all', () => {
    const c = buildPoPrint({ ...RAW, po: { ...RAW.po, PO_TAX_ADDITIONS: 0 }, taxes: [] })
    expect(c.scalars['[TAX_AND_AMOUNT_CGST_TOTAL]']).toBe('0')
  })

  it('builds one material row per rate line, discounted rate = IN4’s rate − IN4’s discount amount', () => {
    expect(b.groups[0].rows).toHaveLength(1)
    const r = b.groups[0].rows[0]
    expect(r['[MatSerial.No]']).toBe('1')
    expect(r['[Total_Material_Details_Material_Name]']).toBe('Pidilite - Roff (T02) Grey')
    expect(r['[Total_Material_Details_PO_OrderQty]']).toBe('5,800')
    expect(r['[Total_Material_Details_Discounted_Rate]']).toBe('13.25')
    expect(r['[Total_Material_Details_Material_Cost]']).toBe('76,850')
    // PO 1419: 35.15 − 5.3618 → 29.79, which × 403 is IN4's own line value.
    const d = buildPoPrint({ ...RAW, lines: [{ ...RAW.lines[0], UNIT_RATE: 35.15, DISCOUNTED_RATE_AMOUNT: 5.3618 }] })
    expect(d.groups[0].rows[0]['[Total_Material_Details_Discounted_Rate]']).toBe('29.79')
  })

  it('escapes each condition and keeps IN4’s line breaks as <br>', () => {
    const rows = b.groups[2].rows
    expect(rows).toHaveLength(2)
    expect(rows[0]['[General Conditions Category]']).toBe('Acknowledgment of Order')
    expect(rows[0]['[General Conditions]']).toBe('1. The Vendor shall acknowledge receipt.<br>2. Within three days.')
    expect(b.groups[2].raw).toBe(true)
  })

  it('names what IN4 does not hold: HSN, schedule, the trust’s GSTIN', () => {
    expect(b.sources.gaps.some(g => g.includes('No HSN code'))).toBe(true)
    expect(b.sources.gaps.some(g => g.includes('no delivery schedule'))).toBe(true)
    expect(b.sources.gaps.some(g => g.includes('paying trust'))).toBe(true)
    expect(b.sources.gaps.some(g => g.includes('NO terms'))).toBe(false)
  })

  it('says when the order was amended, so the reader knows the figures are the current ones', () => {
    const c = buildPoPrint({ ...RAW, po: { ...RAW.po, ACTIVE_AMENDMENT_ID: 722 } })
    expect(c.sources.gaps.some(g => g.includes('amended'))).toBe(true)
    expect(b.sources.gaps.some(g => g.includes('amended'))).toBe(false)
  })
})

describe('renderTemplateGroups — three repeating rows in one template', () => {
  const b = buildPoPrint(RAW)
  const r = renderTemplateGroups(TPL, b.scalars, b.groups)

  it('repeats each row block independently', () => {
    expect(r.groupRows).toEqual([1, 0, 2])
    expect(r.rows).toBe(1)
    expect(r.html.match(/class="item"/g)?.length).toBe(1)
    expect(r.html.match(/class="cond"/g)?.length).toBe(2)
    // The empty schedule says so in one full-width row, in IN4's own frame.
    expect(r.html).toContain('colspan="4"')
    expect(r.html).toContain('IN4 holds no delivery schedule for this purchase order.')
  })

  it('inserts the raw condition rows as markup and the item rows escaped', () => {
    expect(r.html).toContain('acknowledge receipt.<br>2. Within')
    const e = renderTemplateGroups(TPL, {}, [{ ...b.groups[0], rows: [{ ...b.groups[0].rows[0], '[Total_Material_Details_Material_Name]': 'M&S <Grey>' }] }])
    expect(e.html).toContain('M&amp;S &lt;Grey&gt;')
  })

  it('reports the tags IN4 could not fill, and only those', () => {
    expect(r.unresolved).toEqual(['[Contact_Name]', '[Vch_Packing_Forwarding]'])
    expect(r.html).not.toContain('[Contact_Name]')
    expect(r.html).not.toContain('[MatSerial.No]')
  })

  it('never substitutes a tag written inside a material name', () => {
    const t = renderTemplateGroups(TPL, { '[PODetails_No]': 'PO/1' }, [
      { tags: PO_ITEM_TAGS, rows: [{ ...b.groups[0].rows[0], '[Total_Material_Details_Material_Name]': 'Pipe [PODetails_No] class' }], emptyText: 'none' },
      { tags: PO_SCHEDULE_TAGS, rows: [], emptyText: 'none' },
      { tags: PO_CONDITION_TAGS, rows: [], emptyText: 'none', raw: true },
    ])
    expect(t.html).toContain('Pipe [PODetails_No] class')
  })
})
