import { describe, it, expect } from 'vitest'
import { buildIndentsTree, type IndentRaw, type IndentItemRaw, type PoLineRaw, type GrnRaw, type AuditRaw } from './indents-tree'
import {
  flattenRows, shortRef, pendingValue, ageBandOf, bandCounts, supplierOf, lineRate,
  searchRows, stageRows, headline, boardTree, rollUp, catTotals, treeTotals, boardHref, cleanName, summariseChain, meaningfulRemark,
} from './indents-board'
import type { ChainStep } from './indents-tree'

const SKILLS = [
  { id: 324, name: '09 Fire Fighting Works', code: '09' },
  { id: 330, name: '901 Sprinkler System', code: '901' },
  { id: 1, name: '03 Civil', code: '03' },
  { id: 422, name: '310 Door & Window Sills', code: '310' },
]
const NOW = '2026-09-10T04:00:00.000Z'

// IND …/151 — at Verify, two GI pipe lines, no PO.
const IND_151: IndentRaw = { ID: 1403, DISPLAY_NO: 'IND/SRASSK/NGH/2026-27/151', CREATION_DT: '2026-09-08T00:00:00Z', STATUS: 113, SUBPROJECT_ID: 12, PROJECT_ID: 12, project: 'New Guest House', WORK_ORDER_ID: 2030, wo_no: 'WO/NGH/ND/29', MATERIAL_TYPE: ' 09 (M) Fire Fighting Works', REMARKS: 'NGH Wing-B GI pipes', raised_by: 'Kantilal Kheni' }
const ITEMS_151: IndentItemRaw[] = [5389, 5390].map((id, i) => ({ ID: id, indent_id: 1403, MATERIAL_ID: 3754 + i, material: `GI PIPE ${80 - 30 * i}MM`, ORDER_QTY: 54 * (i + 1), uom: 'Mtr', WORK_CATEGORY_ID: 324, WORK_SUBCATEGORY_ID: 330, CLOSED_FOR_PO: false }))
const AUDIT_151: AuditRaw[] = [
  { doc_id: 1403, STATUS: 13, MODIFIED_DT: '2026-09-08T15:36:49Z', who: 'Kantilal Kheni', REMARKS: '' },
  { doc_id: 1403, STATUS: 113, MODIFIED_DT: '2026-09-08T15:48:33Z', who: 'Kantilal Kheni', REMARKS: 'Checked and Verfiy OK' },
]

// IND …/99 — approved, PO 92 approved, received in full.
const IND_99: IndentRaw = { ID: 1047, DISPLAY_NO: 'IND/SRASSK/NGH/2025-26/99', CREATION_DT: '2026-03-20T00:00:00Z', STATUS: 2, SUBPROJECT_ID: 12, PROJECT_ID: 12, project: 'New Guest House', WORK_ORDER_ID: 1739, wo_no: 'WO/NGH/ND/12', MATERIAL_TYPE: ' 03 (M) Civil', REMARKS: null, raised_by: 'Kalyan Singh' }
const ITEM_99: IndentItemRaw = { ID: 3456, indent_id: 1047, MATERIAL_ID: 3285, material: 'Pidilite - Roff (T02) Grey', ORDER_QTY: 5800, uom: 'Kgs', WORK_CATEGORY_ID: 1, WORK_SUBCATEGORY_ID: 422, CLOSED_FOR_PO: false }
const AUDIT_99: AuditRaw[] = [
  { doc_id: 1047, STATUS: 13, MODIFIED_DT: '2026-03-20T10:00:00Z', who: 'Kalyan Singh', REMARKS: '' },
  { doc_id: 1047, STATUS: 2, MODIFIED_DT: '2026-03-25T10:13:48Z', who: 'Ambrishkumar Mistry', REMARKS: '' },
]
const PO_LINE_92: PoLineRaw = { po_item_id: 3725, INDENT_ITEM_ID: 3456, ORDER_QTY: 5800, po_id: 1164, po_no: 'PO/SRASSK/NGH/2025-26/92', po_status: 2, po_date: '2026-03-26T00:00:00Z', supplier: 'NATUROPROTECT', NET_RATE: 13.25, LANDED_COST: 90683, MATERIAL_VALUE: 76850, GRN_QTY: 5800 }
const GRN_92: GrnRaw = { PO_ID: 1164, MATERIAL_ID: 3285, GRN_ID: 1273, GRN_NO: 'GRN/SRASSK/NGH/2026-27/1', GRN_DT: '2026-04-06T00:00:00Z', grn_status: 'Approved', RECIEVED_QTY: 5800, GRN_MATERIAL_COST: 90683 }
const PO_AUDIT_92: AuditRaw[] = [
  { doc_id: 1164, STATUS: 13, MODIFIED_DT: '2026-03-26T10:00:00Z', who: 'Subhash Mahyavanshi', REMARKS: '' },
  { doc_id: 1164, STATUS: 2, MODIFIED_DT: '2026-03-26T11:05:00Z', who: 'Subhash Mahyavanshi', REMARKS: 'Ok' },
]

// IND …/120 — approved, PO 200 approved 19 days ago, half received: a late delivery.
const IND_120: IndentRaw = { ID: 1200, DISPLAY_NO: 'IND/SRASSK/NGH/2026-27/120', CREATION_DT: '2026-08-10T00:00:00Z', STATUS: 2, SUBPROJECT_ID: 12, PROJECT_ID: 12, project: 'New Guest House', WORK_ORDER_ID: null, wo_no: null, MATERIAL_TYPE: ' 03 (M) Civil', REMARKS: null, raised_by: 'Kalyan Singh' }
const ITEM_120: IndentItemRaw = { ID: 4000, indent_id: 1200, MATERIAL_ID: 5000, material: 'Cement OPC 53', ORDER_QTY: 100, uom: 'Bags', WORK_CATEGORY_ID: 1, WORK_SUBCATEGORY_ID: 422, CLOSED_FOR_PO: false }
const AUDIT_120: AuditRaw[] = [{ doc_id: 1200, STATUS: 2, MODIFIED_DT: '2026-08-12T10:00:00Z', who: 'Ambrishkumar Mistry', REMARKS: '' }]
const PO_LINE_200: PoLineRaw = { po_item_id: 9000, INDENT_ITEM_ID: 4000, ORDER_QTY: 100, po_id: 2000, po_no: 'PO/SRASSK/NGH/2026-27/200', po_status: 2, po_date: '2026-08-20T00:00:00Z', supplier: 'ULTRATECH', NET_RATE: 400, LANDED_COST: 40000, MATERIAL_VALUE: 40000, GRN_QTY: 50 }
const PO_AUDIT_200: AuditRaw[] = [{ doc_id: 2000, STATUS: 2, MODIFIED_DT: '2026-08-21T10:00:00Z', who: 'Subhash Mahyavanshi', REMARKS: '' }]

const tree = buildIndentsTree(
  [IND_151, IND_99, IND_120], [...ITEMS_151, ITEM_99, ITEM_120], [PO_LINE_92, PO_LINE_200], [GRN_92],
  [...AUDIT_151, ...AUDIT_99, ...AUDIT_120], [...PO_AUDIT_92, ...PO_AUDIT_200], SKILLS, { now: NOW },
)
const rows = flattenRows(tree.cats)
const line = (m: string) => rows.find(r => r.item.material === m)!.item

describe('lines', () => {
  it('lists every line once with its category names', () => {
    expect(rows).toHaveLength(4)
    expect(rows.find(r => r.item.material === 'Cement OPC 53')).toMatchObject({ category: '03 Civil', subcategory: '310 Door & Window Sills' })
  })
  it('drops the trust prefix from a reference', () => {
    expect(shortRef('IND/SRASSK/NGH/2026-27/151')).toBe('NGH/2026-27/151')
    expect(shortRef('PO/SRASSK/NGH/2025-26/92')).toBe('NGH/2025-26/92')
    expect(shortRef(null)).toBe('')
  })
  it('₹ to come = the undelivered share of the landed PO value', () => {
    expect(pendingValue(line('Cement OPC 53'))).toBeCloseTo(20000)
    expect(pendingValue(line('Pidilite - Roff (T02) Grey'))).toBe(0)
    expect(pendingValue(line('GI PIPE 80MM'))).toBe(0)
  })
  it('names the supplier a line waits on, and IN4’s rate', () => {
    expect(supplierOf(line('Cement OPC 53'))).toBe('ULTRATECH')
    expect(supplierOf(line('GI PIPE 80MM'))).toBeNull()
    expect(lineRate(line('Cement OPC 53'))).toBe(400)
    expect(lineRate(line('GI PIPE 80MM'))).toBeNull()
  })
  it('strips the code from a category name', () => {
    expect(cleanName('09 Fire Fighting Works')).toBe('Fire Fighting Works')
  })
})

describe('age bands', () => {
  it('places a wait in exactly one band', () => {
    expect([0, 6, 7, 13, 14, 29, 30, 200, null].map(ageBandOf)).toEqual(['lt7', 'lt7', '7to14', '7to14', '14to30', '14to30', '30plus', '30plus', 'lt7'])
  })
  it('counts lines and ₹ per band', () => {
    const b = bandCounts(stageRows(rows, 'delivery'))
    expect(b.all).toEqual({ count: 1, value: 20000 })
    expect(b['14to30']).toEqual({ count: 1, value: 20000 })
    expect(b.lt7.count).toBe(0)
  })
})

describe('search / headline', () => {
  it('finds a line by material, indent, PO number or supplier — every word must match', () => {
    expect(searchRows(rows, 'ultratech').map(r => r.item.material)).toEqual(['Cement OPC 53'])
    expect(searchRows(rows, '2026-27/151')).toHaveLength(2)
    expect(searchRows(rows, 'gi 80')).toHaveLength(1)
    expect(searchRows(rows, 'nothing here')).toHaveLength(0)
    expect(searchRows(rows, '  ')).toHaveLength(4)
  })
  it('the headline reads the cycle as numbers', () => {
    const h = headline(rows, tree.pending, Date.parse(NOW))
    expect(h.approval).toEqual({ count: 1, oldest: 1, late: 0 })
    expect(h.po.count).toBe(0)
    expect(h.delivery).toMatchObject({ count: 1, value: 20000, oldest: 19, late: 1 })
    expect(h.received).toMatchObject({ count: 1, value: 90683 })
    expect(h.late).toEqual({ count: 1, value: 20000 })
    expect(h.ordered).toEqual({ value: 130683, pos: 2 })
  })
})

describe('the tree the board shows', () => {
  it('is the whole tree when nothing is filtered', () => {
    expect(boardTree(tree.cats, 'all', undefined, 'all')).toEqual(tree.cats)
  })
  it('keeps only the stage’s lines, re-summed, empty branches dropped', () => {
    const t = boardTree(tree.cats, 'delivery', undefined, 'all')
    expect(t).toHaveLength(1)
    expect(t[0].name).toBe('03 Civil')
    expect(t[0].subs[0].indents.map(r => r.ref)).toEqual(['IND/SRASSK/NGH/2026-27/120'])
    expect(t[0].poValue).toBe(40000)
  })
  it('search and age band narrow the tree the same way', () => {
    expect(boardTree(tree.cats, 'all', 'gi pipe', 'all')[0].name).toBe('09 Fire Fighting Works')
    expect(boardTree(tree.cats, 'all', 'gi pipe', 'all')[0].subs[0].indents[0].items).toHaveLength(2)
    expect(boardTree(tree.cats, 'all', undefined, '14to30')[0].subs[0].indents[0].items[0].material).toBe('Cement OPC 53')
    expect(boardTree(tree.cats, 'all', 'nothing here', 'all')).toEqual([])
  })
  it('rolls a branch up: items, open, PO’d, received, to come, late, oldest', () => {
    expect(treeTotals(tree.cats)).toEqual({ indents: 3, items: 4, open: 3, poValue: 130683, receivedValue: 110683, toCome: 20000, late: 1, oldest: 19 })
    const civil = tree.cats.find(c => c.name === '03 Civil')!
    expect(catTotals(civil)).toMatchObject({ indents: 2, items: 2, open: 1, poValue: 130683, toCome: 20000 })
    expect(rollUp([])).toEqual({ indents: 0, items: 0, open: 0, poValue: 0, receivedValue: 0, toCome: 0, late: 0, oldest: null })
  })
})

describe('summariseChain — the audit trail as milestones', () => {
  const step = (status: string, stage: ChainStep['stage'], at: string, by: string, remark = ''): ChainStep => ({ status, stage, at, by, remark: remark || null })
  it('folds Draft → Submitted → Verify → Approved into Raised · Verified · Approved and drops "Ok"', () => {
    const m = summariseChain([
      step('Draft', 'draft', '2026-08-14T10:00:00Z', 'Vivekkumar Lad'),
      step('Submitted', 'submitted', '2026-08-14T10:05:00Z', 'Vivekkumar Lad'),
      step('Verify', 'verify', '2026-08-14T11:00:00Z', 'Ambrishkumar Mistry'),
      step('Approved', 'approved', '2026-08-14T12:00:00Z', 'Akshay Parekh', 'Ok'),
    ])
    expect(m.map(x => [x.label, x.by, x.remark])).toEqual([['Raised', 'Vivekkumar Lad', null], ['Verified', 'Ambrishkumar Mistry', null], ['Approved', 'Akshay Parekh', null]])
  })
  it('an amendment loop is one Amended line (×n) and one Approved line', () => {
    const m = summariseChain([
      step('Approved', 'approved', '2026-08-14T12:00:00Z', 'Akshay Parekh'),
      step('Amended & Draft', 'draft', '2026-08-31T09:00:00Z', 'Ambrishkumar Mistry'),
      step('Amended & Submitted', 'submitted', '2026-08-31T09:01:00Z', 'Ambrishkumar Mistry'),
      step('Amended & Verify', 'verify', '2026-08-31T09:02:00Z', 'Ambrishkumar Mistry'),
      step('Amended & Draft', 'draft', '2026-08-31T09:10:00Z', 'Ambrishkumar Mistry'),
      step('Amended & Submitted', 'submitted', '2026-08-31T09:11:00Z', 'Ambrishkumar Mistry'),
      step('Amended & Verify', 'verify', '2026-08-31T09:12:00Z', 'Ambrishkumar Mistry'),
      step('Amended & Approved', 'approved', '2026-08-31T10:00:00Z', 'Akshay Parekh', 'Ok'),
    ])
    expect(m.map(x => [x.label, x.times])).toEqual([['Approved', 1], ['Amended', 2], ['Approved', 1]])
  })
  it('keeps a Sent back with its reason, and a real remark on Verify', () => {
    const m = summariseChain([
      step('Draft', 'draft', '2026-09-01T09:00:00Z', 'Ambrishkumar Mistry'),
      step('Submitted', 'submitted', '2026-09-01T09:01:00Z', 'Ambrishkumar Mistry'),
      step('ReSubmit', 'submitted', '2026-09-01T09:30:00Z', 'Subhash Mahyavanshi', 'Need to add payment term & Quotation'),
      step('Submitted', 'submitted', '2026-09-01T09:40:00Z', 'Ambrishkumar Mistry'),
      step('ReSubmit', 'submitted', '2026-09-01T09:50:00Z', 'Subhash Mahyavanshi', 'Need to add transport note.'),
      step('Submitted', 'submitted', '2026-09-01T10:00:00Z', 'Ambrishkumar Mistry'),
      step('Verify', 'verify', '2026-09-01T10:10:00Z', 'Subhash Mahyavanshi', 'Checked & Approved By Akshay Sir.'),
      step('Approved', 'approved', '2026-09-01T10:20:00Z', 'Subhash Mahyavanshi', 'Ok'),
    ])
    expect(m.map(x => x.label)).toEqual(['Raised', 'Sent back', 'Sent back', 'Verified', 'Approved'])
    expect(m[1].remark).toBe('Need to add payment term & Quotation')
    expect(m[3].remark).toBe('Checked & Approved By Akshay Sir.')
    expect(m[4].remark).toBeNull()
  })
  it('trivial remarks are dropped, real ones kept', () => {
    expect(['Ok', 'OK.', 'Checked and Found OK', 'Checked and Verify OK', '', null].map(meaningfulRemark)).toEqual([null, null, null, null, null, null])
    expect(meaningfulRemark('NGH Wing-B GI pipes')).toBe('NGH Wing-B GI pipes')
  })
})

describe('boardHref', () => {
  it('keeps the project and months, drops defaults, and lets a patch clear a key', () => {
    expect(boardHref('/procurement-tracker', { p: '12', f: 'delivery', age: '7to14' }, { age: 'all' })).toBe('/procurement-tracker?p=12&f=delivery')
    expect(boardHref('/project/x/procurement', {}, { f: 'all' })).toBe('/project/x/procurement')
    expect(boardHref('/project/x/procurement', { f: 'po' }, { q: 'gi pipe' })).toBe('/project/x/procurement?f=po&q=gi+pipe')
  })
})
