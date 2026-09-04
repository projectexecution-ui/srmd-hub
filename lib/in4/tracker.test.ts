import { describe, it, expect } from 'vitest'
import { buildTracker, buildTrackerState, compareTracker, excelDate, excelMaterialCell, type In4IndentRow } from './tracker'

const base: In4IndentRow = {
  project_id: 8, project_name: 'Raj Uphaar', subproject_id: 20, subproject_name: 'Raj Uphaar - Execution',
  skill_id: 1, wo_skill_name: '03 Civil', wo_id: 5, wo_no: 'WO/SRET/RU/2023-24/5', contractor_name: 'Desai',
  material_type: '19 Site Admin', material_subtype: '1901 Site Office', material_id: 77, material_name: 'Umbrella',
  indent_id: 3, indent_no: 'IND/SRET/RU/2023-24/3', indent_status: 2, indent_date: '2024-06-01', indent_type: 'PO & ISSUE',
  indent_item_id: 31, indent_qty: 6, uom: 'Nos',
  po_id: null, po_detail_id: null, po_no: null, po_supplier_id: null, po_supplier: null, po_status: null, po_date: null, po_qty: 0, po_rate: 0,
  grn_id: null, grn_no: null, grn_date: null, grn_status: null, grn_qty: 0, grn_rate: 0, grn_value: 0, closed_for_po: false,
}
const NOW = Date.parse('2026-09-05T00:00:00Z')

describe('IN4 → tracker lines', () => {
  it('writes dates the way the Excel did, so old and new lines read alike', () => {
    expect(excelDate('2024-06-03')).toBe('Jun 3, 2024')
    expect(excelDate(null)).toBe('')
  })

  it('rebuilds the Excel material cell so the cleaned material string is byte-identical', () => {
    expect(excelMaterialCell({ material_type: '13 (A) Interiors', material_subtype: '1302 (A) Loose Furniture', material_name: 'Bed Wooden Single' }))
      .toBe('13 (A) Interiors - 1302 (A) Loose Furniture-Bed Wooden Single')
    const { lines } = buildTracker([base], NOW)
    expect(lines[0].material).toBe('Umbrella')
    expect(lines[0].discipline).toBe('19 Site Admin')
  })

  it('one line per indent item; POs and GRNs de-duplicated across the view’s repeated rows', () => {
    const rows: In4IndentRow[] = [
      { ...base, po_id: 1, po_detail_id: 11, po_no: 'PO/SRET/RU/2024-25/3', po_supplier: 'Jyoti Umbrellas', po_date: '2024-06-03', po_qty: 0, po_rate: 0 },
      { ...base, po_id: 2, po_detail_id: 12, po_no: 'PO/SRET/RU/2024-25/8', po_supplier: 'Jyoti Umbrellas', po_date: '2024-06-03', po_qty: 6, po_rate: 224,
        grn_id: 5, grn_no: 'GRN/SRET/RU/2024-25/5', grn_date: '2024-08-31', grn_qty: 6, grn_rate: 224, grn_value: 1344 },
      // the same GRN again, on an issue row
      { ...base, po_id: 2, po_detail_id: 12, po_no: 'PO/SRET/RU/2024-25/8', po_supplier: 'Jyoti Umbrellas', po_date: '2024-06-03', po_qty: 6, po_rate: 224,
        grn_id: 5, grn_no: 'GRN/SRET/RU/2024-25/5', grn_date: '2024-08-31', grn_qty: 6, grn_rate: 224, grn_value: 1344 },
    ]
    const { lines, items } = buildTracker(rows, NOW)
    expect(lines).toHaveLength(1)
    const l = lines[0]
    expect(l.id).toBe('IND/SRET/RU/2023-24/3|0')
    expect(l.pos).toHaveLength(2)
    expect(l.grns).toHaveLength(1)
    expect(l.orderedQty).toBe(6)
    expect(l.receivedQty).toBe(6)
    expect(l.status).toBe('received')
    expect(l.grns[0].lagDays).toBe(89)
    expect(l.pos[1].amount).toBe(1344)
    expect(l.project).toBe('Raj Uphaar')
    expect(l.block).toBe('Raj Uphaar')
    expect(items[0].indent_item_id).toBe(31)
    expect(items[0].status).toBe('received')
  })

  it('numbers materials within an indent in document order and marks drafts', () => {
    const rows: In4IndentRow[] = [
      { ...base, indent_item_id: 31 },
      { ...base, indent_item_id: 32, material_name: 'Chair', po_id: 9, po_detail_id: 91, po_no: 'DRAFT-PO/SRET/RU/2025-26/1', po_qty: 2, po_rate: 100, po_date: '2026-09-01' },
    ]
    const { lines } = buildTracker(rows, NOW)
    expect(lines.map(l => l.id)).toEqual(['IND/SRET/RU/2023-24/3|0', 'IND/SRET/RU/2023-24/3|1'])
    expect(lines[0].status).toBe('no_po')
    expect(lines[1].status).toBe('pending')
    expect(lines[1].pos[0].draft).toBe(true)
    expect(lines[1].pendingValue).toBe(200)
  })

  it('builds the stored state and compares it with the last upload', () => {
    const { lines } = buildTracker([base], NOW)
    const state = buildTrackerState(lines, 'IN4 live sync 2026-09-05', '2026-09-05T00:00:00Z')
    expect(state.format).toBe('banded')
    expect(state.projects[0].projectName).toBe('Raj Uphaar')
    expect(state.lineStatuses).toHaveLength(1)
    const cmp = compareTracker(null, state)
    expect(cmp.totals.in4Lines).toBe(1)
    expect(cmp.projects[0]).toMatchObject({ project: 'Raj Uphaar', hubLines: 0, in4Lines: 1 })
  })
})
