import { describe, it, expect } from 'vitest'
import { correctTrackerLines, lineKey, type MirrorItem, type PoLineFix } from './tracker-corrections'

// PO/SRASSK/NGH/2025-26/93 as the tracker snapshot holds it on 8 Sept 2026:
// one PO with two lines (44,200 kg on indent 1048, 70 kg on indent 1101), and
// the view saying 44,270 on both. The 70 kg line also carries the other
// line's three GRNs at 0 kg.
const mat = { material_type: '12 Finishes', material_subtype: '1205 Dado', material_name: 'Pidilite - Roff (T02) Grey' }
const items: MirrorItem[] = [
  { indent_no: 'IND/SRASSK/NGH/2025-26/48', indent_id: 1048, material_id: 3286, ...mat },
  { indent_no: 'IND/SRASSK/NGH/2026-27/1', indent_id: 1101, material_id: 3286, ...mat },
]
const fixes: PoLineFix[] = [
  { poNo: 'PO/SRASSK/NGH/2025-26/93', indentId: 1048, materialId: 3286, qty: 44200, value: 585650 },
  { poNo: 'PO/SRASSK/NGH/2025-26/93', indentId: 1101, materialId: 3286, qty: 70, value: 927.5 },
]
// The tracker's material string for these items, built by the same function.
const material = 'Pidilite - Roff (T02) Grey'
const grn = (date: string, qty: number, value: number) => ({ grnNo: 'GRN/SRASSK/NGH/2026-27/1', grnDate: date, qty, rate: 15.635, value })
const bigLine = {
  id: 'IND/SRASSK/NGH/2025-26/48|0', indentNo: 'IND/SRASSK/NGH/2025-26/48', material, indentQty: 44200,
  pos: [{ poNo: 'PO/SRASSK/NGH/2025-26/93', qty: 44270, rate: 13.25, amount: 586577.5, draft: false, grnQty: 44200 }],
  grns: [grn('Apr 4, 2026', 25050, 391656.75), grn('Apr 6, 2026', 19020, 297377.7), grn('Apr 6, 2026', 130, 2032.55), grn('Apr 28, 2026', 0, 0)],
  orderedQty: 44270, receivedQty: 44200, pendingQty: 70, pendingValue: 927.5, grnValue: 691067, status: 'partial',
}
const smallLine = {
  id: 'IND/SRASSK/NGH/2026-27/1|0', indentNo: 'IND/SRASSK/NGH/2026-27/1', material, indentQty: 70,
  pos: [{ poNo: 'PO/SRASSK/NGH/2025-26/93', qty: 44270, rate: 13.25, amount: 586577.5, draft: false, grnQty: 70 }],
  grns: [grn('Apr 4, 2026', 0, 0), grn('Apr 6, 2026', 0, 0), grn('Apr 6, 2026', 0, 0), grn('Apr 28, 2026', 70, 1094.45)],
  orderedQty: 44270, receivedQty: 70, pendingQty: 44200, pendingValue: 585650, grnValue: 1094.45, status: 'partial',
}

describe('correcting tracker lines from IN4’s PO-line figures', () => {
  it('gives each line its own PO quantity, so both lines read as fully received', () => {
    const { lines, corrections } = correctTrackerLines([bigLine, smallLine], items, fixes)
    const [big, small] = lines
    expect(big.orderedQty).toBe(44200); expect(big.pendingQty).toBe(0); expect(big.status).toBe('received')
    expect(small.orderedQty).toBe(70);  expect(small.pendingQty).toBe(0); expect(small.status).toBe('received')
    expect((small.pos as Array<{ amount: number }>)[0].amount).toBe(927.5)
    expect(corrections.poLinesCorrected).toBe(2)
  })

  it('drops the GRN rows a line received nothing on, and keeps the real ones', () => {
    const { lines, corrections } = correctTrackerLines([bigLine, smallLine], items, fixes)
    expect((lines[0].grns as unknown[]).length).toBe(3)
    expect((lines[1].grns as unknown[]).length).toBe(1)
    expect(corrections.grnRowsDropped).toBe(4)
    expect(lines[1].receivedQty).toBe(70)
  })

  it('leaves a line alone when nothing about it needs correcting, and reports nothing', () => {
    const fine = { ...bigLine, pos: [{ ...bigLine.pos[0], qty: 44200 }], grns: bigLine.grns.slice(0, 3) }
    const { lines, corrections } = correctTrackerLines([fine], items, fixes)
    expect(lines[0]).toEqual(fine)
    expect(corrections).toEqual({ poLinesCorrected: 0, grnRowsDropped: 0, linesUnmatched: 0 })
  })

  it('does not guess: an indent number with two identical materials is ambiguous and untouched', () => {
    const twice = [...items, { ...items[1] }]
    const { lines, corrections } = correctTrackerLines([smallLine], twice, fixes)
    expect(lines[0].orderedQty).toBe(44270)
    expect(corrections.linesUnmatched).toBe(1)
    expect(corrections.poLinesCorrected).toBe(0)
  })

  it('with no IN4 fixes at all, only the empty GRN rows go', () => {
    const { lines, corrections } = correctTrackerLines([smallLine], [], [])
    expect(lines[0].orderedQty).toBe(44270)
    expect((lines[0].grns as unknown[]).length).toBe(1)
    expect(corrections.linesUnmatched).toBe(0)
  })

  it('the shared key is case- and space-insensitive on the material, exact on the indent number', () => {
    expect(lineKey('IND/1', ' Pidilite - Roff ')).toBe(lineKey('IND/1', 'pidilite - roff'))
    expect(lineKey('IND/1', 'x')).not.toBe(lineKey('IND/2', 'x'))
  })
})
