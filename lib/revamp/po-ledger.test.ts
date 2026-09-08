import { describe, it, expect } from 'vitest'
import { buildPoLedger, type PoBillIn, type PoGrnIn } from './po-ledger'

// PO/SRASSK/NGH/2025-26/92 (id 1164) as IN4 holds it: one GRN of 5,800 kg,
// one bill for the full 90,683 — booked by IN4 under PO 93's certificate.
const GRNS: PoGrnIn[] = [
  { grnId: 1273, grnNo: 'GRN/SRASSK/NGH/2026-27/1', date: '2026-04-06', challan: '29', material: 'Pidilite - Roff (T02) Grey', uom: 'Kgs', qty: 5800, value: 90683 },
]
const BILLS: PoBillIn[] = [
  { certificateId: 1229, certificateNo: '1223', certificateDate: '2026-05-09', invoiceNo: '29', invoiceDate: '2026-04-04', status: 'Paid',
    billPoId: 1165, billPoNo: 'PO/SRASSK/NGH/2025-26/93', landed: 90683, certified: 76850, paid: 90683, tds: 0, retention: 0, advanceRecovered: 0 },
]

describe('buildPoLedger', () => {
  it('runs the receipts and ends on zero still to pay for PO 92', () => {
    const l = buildPoLedger(90683, 1164, GRNS, BILLS, [])
    expect(l.grns[0].cumQty).toBe(5800)
    expect(l.totals.receivedValue).toBe(90683)
    expect(l.rows).toHaveLength(1)
    expect(l.rows[0].ref).toBe('29')
    expect(l.rows[0].stillToPay).toBe(0)
    expect(l.totals.paidOut).toBe(90683)
  })

  it('names the PO IN4 booked the bill under when it is not this one', () => {
    const l = buildPoLedger(90683, 1164, GRNS, BILLS, [])
    expect(l.rows[0].bookedUnder).toBe('PO/SRASSK/NGH/2025-26/93')
    const own = buildPoLedger(90683, 1165, GRNS, BILLS, [])
    expect(own.rows[0].bookedUnder).toBeNull()
  })

  it('counts TDS as paid, holds retention apart, and puts advances first', () => {
    const l = buildPoLedger(1_00_000, 1, [], [
      { ...BILLS[0], certificateId: 2, invoiceNo: 'B-2', invoiceDate: '2026-06-01', landed: 60_000, certified: 50_000, paid: 40_000, tds: 1_000, retention: 5_000, advanceRecovered: 14_000, billPoId: 1, billPoNo: null },
    ], [
      { certificateId: 9, certificateNo: 'A-9', status: 2, landed: 20_000, paid: 19_600, tds: 400, retention: 0, advanceRecovered: 0 },
    ])
    expect(l.rows.map(r => r.kind)).toEqual(['advance', 'bill'])
    expect(l.rows[0].paidOut).toBe(20_000)
    expect(l.rows[0].stillToPay).toBe(80_000)
    expect(l.rows[1].paidOut).toBe(41_000)
    // 1,00,000 − 20,000 − 41,000 − 5,000 retention
    expect(l.rows[1].stillToPay).toBe(34_000)
    expect(l.totals).toMatchObject({ advancePaid: 20_000, billed: 60_000, tds: 1_400, retention: 5_000, advanceRecovered: 14_000, paidOut: 61_000 })
  })

  it('shows a cancelled advance but lets it add nothing', () => {
    const l = buildPoLedger(50_000, 1, [], [], [
      { certificateId: 3, certificateNo: 'A-3', status: 6, landed: 10_000, paid: 10_000, tds: 0, retention: 0, advanceRecovered: 0 },
    ])
    expect(l.rows[0].status).toBe('cancelled')
    expect(l.rows[0].paidOut).toBe(0)
    expect(l.rows[0].stillToPay).toBe(50_000)
  })

  it('sorts receipts by date and accumulates quantity and value', () => {
    const l = buildPoLedger(0, 1, [
      { ...GRNS[0], grnId: 2, date: '2026-04-28', qty: 70, value: 1094.45 },
      { ...GRNS[0], grnId: 1, date: '2026-04-04', qty: 25050, value: 391656.75 },
    ], [], [])
    expect(l.grns.map(g => g.grnId)).toEqual([1, 2])
    expect(l.grns[1].cumQty).toBe(25120)
    expect(l.totals.receivedValue).toBeCloseTo(392751.2, 2)
  })
})
