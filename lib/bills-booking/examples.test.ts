import { describe, it, expect } from 'vitest'
import { EXAMPLE_PLANS, buildExamples } from './examples'
import type { PickableOrder } from './orders'

const TODAY = new Date('2026-09-15T00:00:00Z')

const order = (o: Partial<PickableOrder> = {}): PickableOrder => ({
  kind: 'WO', orderId: 1, orderNo: 'WO/SRASSK/SQ/2026-27/105', projectId: 5,
  subprojectId: 12, subprojectIds: [12], categoryId: 46, categoryName: null,
  workDescription: 'Tiling to lobby', partyId: 5, party: 'Amin Developers',
  orderedGross: 13_17_650, billedGross: 0, balance: 13_17_650, retentionPct: 5,
  trust: 'SRASSK', bills: 3, lastBillNo: 'SR/26-27/66', status: 'Approved', ...o,
})

/** Every order the plans name, so nothing is skipped in a test that is not
 *  about skipping. */
const allOrders = new Map(
  EXAMPLE_PLANS.map(p => [
    p.order,
    order({ orderNo: p.order, kind: p.kind, party: p.kind === 'WO' ? 'Amin Developers' : 'SONAL CERAMICS' }),
  ]),
)
const resolve = () => ({ projectId: 'p-1', subprojectId: 12, discipline: 'Finishes' })

describe('the twenty walkthrough bills', () => {
  it('is ten work-order bills and ten purchase-order bills', () => {
    expect(EXAMPLE_PLANS).toHaveLength(20)
    expect(EXAMPLE_PLANS.filter(p => p.kind === 'WO')).toHaveLength(10)
    expect(EXAMPLE_PLANS.filter(p => p.kind === 'PO')).toHaveLength(10)
    expect(EXAMPLE_PLANS.map(p => p.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  // The point of the whole set. Without the real number the example would
  // demonstrate the opposite of what it is for.
  it('every work-order example carries a real IN4 bill number', () => {
    for (const p of EXAMPLE_PLANS.filter(p => p.kind === 'WO')) {
      expect(p.billNo, `example ${p.n}`).toBeTruthy()
    }
  })

  // A purchase order is received before it is invoiced, so a PO example may
  // legitimately have no bill number yet — that state has to be seeded too.
  it('lets a PO example stand with no bill number, because goods arrive first', () => {
    const withoutNo = EXAMPLE_PLANS.filter(p => p.kind === 'PO' && p.billNo == null)
    expect(withoutNo.length).toBeGreaterThan(0)
    expect(EXAMPLE_PLANS.filter(p => p.kind === 'PO' && p.billNo).length).toBeGreaterThan(0)
  })

  it('names a real order on every one, and no order twice at the same desk', () => {
    for (const p of EXAMPLE_PLANS) {
      expect(p.order, `example ${p.n}`).toMatch(/^(WO|PO)\//)
      expect(p.claimed, `example ${p.n}`).toBeGreaterThan(0)
    }
    const seen = new Set(EXAMPLE_PLANS.map(p => `${p.order}|${p.billNo ?? ''}`))
    expect(seen.size).toBe(EXAMPLE_PLANS.length)
  })

  it('spreads across the desks so every part of the flow has something to show', () => {
    const stages = new Set(EXAMPLE_PLANS.map(p => p.stage))
    for (const s of ['submitted', 'site_head', 'disc_head', 'ct_head', 'atm_approval', 'ct_billing', 'trust']) {
      expect(stages.has(s as never), s).toBe(true)
    }
  })
})

describe('turning a plan into a row', () => {
  it('carries the real bill number through — that is the whole key', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    const one = rows.find(r => r.note.startsWith('Example 1:'))!
    expect(one.bill_no).toBe('CV/RU-56')
    expect(one.order_no).toBe('WO/SRET/RU/2026-27/161')
  })

  // An abstract number was what the old set seeded to make the sheet appear.
  // Finding it by bill number is the change these examples exist to show, so
  // seeding one would hide the very thing being demonstrated.
  it('never seeds an abstract number', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    for (const r of rows) expect(r.abstract_no_in4).toBeNull()
  })

  it('numbers a work-order bill RA-n and leaves a purchase-order bill without one', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    const wo = rows.filter(r => r.order_type === 'WO')
    const po = rows.filter(r => r.order_type === 'PO')
    expect(wo.length).toBe(10)
    expect(po.length).toBe(10)
    for (const r of wo) expect(r.ra_no).toBe('RA-4')
    for (const r of po) expect(r.ra_no).toBeNull()
  })

  it('takes the order type from the order, never from the plan', () => {
    const rows = buildExamples(
      [EXAMPLE_PLANS[0]],
      new Map([[EXAMPLE_PLANS[0].order, order({ orderNo: EXAMPLE_PLANS[0].order, kind: 'PO' })]]),
      resolve, TODAY)
    expect(rows[0].order_type).toBe('PO')
    expect(rows[0].ra_no).toBeNull()
  })

  it('reads the contractor, the ordered value and what is billed off IN4', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    const one = rows[0]
    expect(one.vendor_text).toBe('Amin Developers')
    expect(one.wo_value).toBe(13_17_650)
    expect(one.trust).toBe('SRASSK')
  })

  it('skips an example whose order is no longer in IN4 rather than inventing one', () => {
    const rows = buildExamples(EXAMPLE_PLANS, new Map(), resolve, TODAY)
    expect(rows).toEqual([])
  })

  it('ages each bill from its own desk time, so the SLA colouring has something to do', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    const late = rows.find(r => r.note.startsWith('Example 5:'))!
    expect(late.days_at_desk).toBe(9)
    expect(late.bill_date).toBe('2026-09-04')   // 9 days at the desk + 2
  })

  it('only sets a net amount where the CT Head has already cut it', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    const cut = rows.filter(r => r.net_amount != null)
    expect(cut.length).toBe(1)
    expect(cut[0].net_amount).toBeLessThan(cut[0].claimed_amount)
  })

  it('flags the one that goes past the order value, and only that one', () => {
    const rows = buildExamples(EXAMPLE_PLANS, allOrders, resolve, TODAY)
    expect(rows.filter(r => r.amendment_flag).length).toBe(1)
  })
})
