import { describe, it, expect } from 'vitest'
import { buildIndentsTree, chainFrom, stageOf, type IndentRaw, type IndentItemRaw, type PoLineRaw, type GrnRaw, type AuditRaw } from './indents-tree'

const SKILLS = [
  { id: 324, name: '09 Fire Fighting Works', code: '09' },
  { id: 330, name: '901 Sprinkler System', code: '901' },
  { id: 1, name: '03 Civil', code: '03' },
  { id: 422, name: '310 Door & Window Sills', code: '310' },
]

// IND/SRASSK/NGH/2026-27/151 as IN4 held it on 8 Sep 2026: four GI pipe
// lines, at Verify, no PO yet.
const IND_151: IndentRaw = { ID: 1403, DISPLAY_NO: 'IND/SRASSK/NGH/2026-27/151', CREATION_DT: '2026-09-08T00:00:00Z', STATUS: 113, SUBPROJECT_ID: 12, WORK_ORDER_ID: 2030, wo_no: 'WO/NGH/ND/29', MATERIAL_TYPE: ' 09 (M) Fire Fighting Works', REMARKS: 'NGH Wing-B GI pipes', raised_by: 'Kantilal Kheni' }
const ITEMS_151: IndentItemRaw[] = [5389, 5390].map((id, i) => ({ ID: id, indent_id: 1403, MATERIAL_ID: 3754 + i, material: `GI PIPE ${80 - 30 * i}MM`, ORDER_QTY: 54 * (i + 1), uom: 'Mtr', WORK_CATEGORY_ID: 324, WORK_SUBCATEGORY_ID: 330 }))
const AUDIT_151: AuditRaw[] = [
  { doc_id: 1403, STATUS: 113, MODIFIED_DT: '2026-09-08T15:48:33Z', who: 'Kantilal Kheni', REMARKS: 'Checked and Verfiy OK' },
  { doc_id: 1403, STATUS: 13, MODIFIED_DT: '2026-09-08T15:36:49Z', who: 'Kantilal Kheni', REMARKS: '' },
  { doc_id: 1403, STATUS: 1, MODIFIED_DT: '2026-09-08T15:48:11Z', who: 'Kantilal Kheni', REMARKS: 'Checked and Found OK' },
]

// IND …/99: one Pidilite line, approved, PO 92 raised and approved, GRN in full.
const IND_99: IndentRaw = { ID: 1047, DISPLAY_NO: 'IND/SRASSK/NGH/2025-26/99', CREATION_DT: '2026-03-20T00:00:00Z', STATUS: 2, SUBPROJECT_ID: 12, WORK_ORDER_ID: 1739, wo_no: 'WO/NGH/ND/12', MATERIAL_TYPE: ' 03 (M) Civil', REMARKS: null, raised_by: 'Kalyan Singh' }
const ITEM_99: IndentItemRaw = { ID: 3456, indent_id: 1047, MATERIAL_ID: 3285, material: 'Pidilite - Roff (T02) Grey', ORDER_QTY: 5800, uom: 'Kgs', WORK_CATEGORY_ID: 1, WORK_SUBCATEGORY_ID: 422 }
const PO_LINE_92: PoLineRaw = { po_item_id: 3725, INDENT_ITEM_ID: 3456, ORDER_QTY: 5800, po_id: 1164, po_no: 'PO/SRASSK/NGH/2025-26/92', po_status: 2, po_date: '2026-03-26T00:00:00Z', supplier: 'NATUROPROTECT', NET_RATE: 13.25, LANDED_COST: 90683, MATERIAL_VALUE: 76850, GRN_QTY: 5800 }
const GRN_92: GrnRaw = { PO_ID: 1164, MATERIAL_ID: 3285, GRN_ID: 1273, GRN_NO: 'GRN/SRASSK/NGH/2026-27/1', GRN_DT: '2026-04-06T00:00:00Z', grn_status: 'Approved', RECIEVED_QTY: 5800, GRN_MATERIAL_COST: 90683 }
const PO_AUDIT_92: AuditRaw[] = [
  { doc_id: 1164, STATUS: 13, MODIFIED_DT: '2026-03-26T10:00:00Z', who: 'Subhash Mahyavanshi', REMARKS: '' },
  { doc_id: 1164, STATUS: 1, MODIFIED_DT: '2026-03-26T10:30:00Z', who: 'Subhash Mahyavanshi', REMARKS: '' },
  { doc_id: 1164, STATUS: 113, MODIFIED_DT: '2026-03-26T11:00:00Z', who: 'Subhash Mahyavanshi', REMARKS: 'Checked & Approved By Akshay Sir.' },
  { doc_id: 1164, STATUS: 2, MODIFIED_DT: '2026-03-26T11:05:00Z', who: 'Subhash Mahyavanshi', REMARKS: 'Ok' },
]

describe('stageOf / chainFrom — IN4’s statuses as the four steps of the cycle', () => {
  it('maps IN4 status ids to stages', () => {
    expect([13, 1, 113, 2, 6, 66, 117, 77].map(stageOf)).toEqual(['draft', 'submitted', 'verify', 'approved', 'closed', 'closed', 'verify', 'submitted'])
  })
  it('orders the audit trail by time, keeping who and the remark', () => {
    const c = chainFrom(AUDIT_151)
    expect(c.map(x => x.status)).toEqual(['Draft', 'Submitted', 'Verify'])
    expect(c[2]).toMatchObject({ stage: 'verify', by: 'Kantilal Kheni', remark: 'Checked and Verfiy OK' })
  })
})

describe('buildIndentsTree', () => {
  const t = buildIndentsTree([IND_151, IND_99], [...ITEMS_151, ITEM_99], [PO_LINE_92], [GRN_92], AUDIT_151, PO_AUDIT_92, SKILLS)

  it('files each indent under the category and sub-category of its lines', () => {
    expect(t.cats.map(c => c.name)).toEqual(['03 Civil', '09 Fire Fighting Works'])
    const ff = t.cats[1]
    expect(ff.subs[0].name).toBe('901 Sprinkler System')
    expect(ff.subs[0].indents[0].ref).toBe('IND/SRASSK/NGH/2026-27/151')
    expect(ff.items).toBe(2)
  })

  it('puts the indent at Verify in the waiting list with who and since when', () => {
    expect(t.pending).toHaveLength(1)
    expect(t.pending[0]).toMatchObject({ kind: 'indent', ref: 'IND/SRASSK/NGH/2026-27/151', status: 'Verify', by: 'Kantilal Kheni', since: '2026-09-08T15:48:33.000Z', context: 'for WO/NGH/ND/29' })
  })

  it('knows what each line waits for next', () => {
    const ff = t.cats[1].subs[0].indents[0]
    expect(ff.items.every(i => i.next === 'indent approval')).toBe(true)
    const civil = t.cats[0].subs[0].indents[0]
    expect(civil.items[0].next).toBe('done')
    expect(civil.items[0]).toMatchObject({ qty: 5800, poQty: 5800, poValue: 90683, receivedQty: 5800, receivedValue: 90683 })
  })

  it('carries the complete cycle on the approved one: indent chain, PO with its own chain, GRN', () => {
    const civil = t.cats[0].subs[0].indents[0]
    expect(civil.pos).toHaveLength(1)
    expect(civil.pos[0]).toMatchObject({ poNo: 'PO/SRASSK/NGH/2025-26/92', stage: 'approved', value: 90683, grnQty: 5800 })
    const po = civil.items[0].pos[0]
    expect(po.chain.map(c => c.status)).toEqual(['Draft', 'Submitted', 'Verify', 'Approved'])
    expect(po.chain[2].remark).toBe('Checked & Approved By Akshay Sir.')
    expect(po.grns).toHaveLength(1)
    expect(po.grns[0]).toMatchObject({ grnNo: 'GRN/SRASSK/NGH/2026-27/1', qty: 5800 })
  })

  it('totals add up across the tree', () => {
    expect(t.totals).toMatchObject({ indents: 2, items: 3, poValue: 90683, receivedValue: 90683, awaitingPo: 0, awaitingDelivery: 0, hidden: 0 })
  })

  it('says "raise PO" when an approved indent has less ordered than indented, and "delivery" when the PO is not fully received', () => {
    const half = buildIndentsTree([IND_99], [ITEM_99], [{ ...PO_LINE_92, ORDER_QTY: 3000, GRN_QTY: 1000, LANDED_COST: 46905 }], [], [], PO_AUDIT_92, SKILLS)
    const it0 = half.cats[0].subs[0].indents[0].items[0]
    expect(it0.next).toBe('raise PO')
    expect(it0.receivedValue).toBeCloseTo(46905 / 3, 2)
    const partial = buildIndentsTree([IND_99], [ITEM_99], [{ ...PO_LINE_92, GRN_QTY: 1000 }], [], [], PO_AUDIT_92, SKILLS)
    expect(partial.cats[0].subs[0].indents[0].items[0].next).toBe('delivery')
    expect(partial.totals.awaitingDelivery).toBe(1)
  })

  it('a PO still at Verify is itself a waiting approval, with the indent it serves', () => {
    const tv = buildIndentsTree([IND_99], [ITEM_99], [{ ...PO_LINE_92, po_status: 113, GRN_QTY: 0 }], [], [], PO_AUDIT_92.slice(0, 3), SKILLS)
    expect(tv.pending).toHaveLength(1)
    expect(tv.pending[0]).toMatchObject({ kind: 'po', ref: 'PO/SRASSK/NGH/2025-26/92', status: 'Verify', value: 90683, context: 'for IND/SRASSK/NGH/2025-26/99' })
    expect(tv.cats[0].subs[0].indents[0].items[0].next).toBe('PO approval')
  })

  it('hides cancelled and terminated indents by default and counts them; shows them on request', () => {
    const dead = { ...IND_151, ID: 9, DISPLAY_NO: 'IND/X', STATUS: 6 }
    const a = buildIndentsTree([dead], [{ ...ITEMS_151[0], ID: 99, indent_id: 9 }], [], [], [], [], SKILLS)
    expect(a.totals.indents).toBe(0)
    expect(a.totals.hidden).toBe(1)
    const b = buildIndentsTree([dead], [{ ...ITEMS_151[0], ID: 99, indent_id: 9 }], [], [], [], [], SKILLS, { showClosed: true })
    expect(b.totals.indents).toBe(1)
    expect(b.cats[0].subs[0].indents[0].items[0].next).toBe('closed')
  })
})
