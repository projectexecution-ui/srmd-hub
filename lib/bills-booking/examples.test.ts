import { describe, it, expect } from 'vitest'
import { EXAMPLE_PLANS, buildExamples } from './examples'
import type { PickableOrder } from './orders'

const TODAY = new Date('2026-09-14T00:00:00Z')

const wo = (o: Partial<PickableOrder> = {}): PickableOrder => ({
  kind: 'WO', orderId: 1, orderNo: 'WO/SRASSK/SQ/2026-27/105', projectId: 5, subprojectId: 12, subprojectCount: 1,
  categoryId: 46, categoryName: null, workDescription: 'Tiling to lobby', partyId: 5,
  party: 'Amin Developers', orderedGross: 4_522_350, billedGross: 1_317_650,
  balance: 3_204_700, retentionPct: 5, trust: 'SRASSK', bills: 3,
  lastBillNo: 'SR-26-27-67', status: 'Approved', ...o,
})

const wos = Array.from({ length: 8 }, (_, i) => wo({ orderId: i + 1, orderNo: `WO/SRASSK/SQ/2026-27/${100 + i}` }))
const resolve = () => ({ projectId: 'p-1', subprojectId: 12, discipline: 'Finishes' })

describe('the ten walkthrough bills', () => {
  it('is ten, numbered once, simple before complex', () => {
    expect(EXAMPLE_PLANS).toHaveLength(10)
    expect(EXAMPLE_PLANS.map(p => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const firstComplex = EXAMPLE_PLANS.findIndex(p => p.complexity === 'complex')
    expect(EXAMPLE_PLANS.slice(firstComplex).every(p => p.complexity === 'complex')).toBe(true)
  })

  it('says what to look at on every one', () => {
    for (const p of EXAMPLE_PLANS) {
      expect(p.title.length, `${p.n} title`).toBeGreaterThan(10)
      expect(p.check.length, `${p.n} check`).toBeGreaterThan(30)
    }
  })

  // The point of seeding from real work orders: the arithmetic behaves.
  it('draws its figures from the real work order it names', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos, resolve, TODAY)
    const first = rows[0]
    expect(first.order_no).toBe('WO/SRASSK/SQ/2026-27/100')
    expect(first.vendor_text).toBe('Amin Developers')
    expect(first.wo_value).toBe(4_522_350)
    expect(first.paid_till_date).toBe(1_317_650)
    expect(first.trust).toBe('SRASSK')
    // 18% of the 32,04,700 still to bill.
    expect(first.claimed_amount).toBe(576_846)
  })

  it('overshoots the order on the amendment example, and only there', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos, resolve, TODAY)
    const over = rows.filter(r => r.amendment_flag)
    expect(over).toHaveLength(1)
    const r = over[0]
    expect(r.paid_till_date + r.claimed_amount).toBeGreaterThan(r.wo_value!)
  })

  it('gives the no-order examples no work order at all', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos, resolve, TODAY)
    const none = rows.filter(r => r.order_type === 'Without WO/PO')
    expect(none).toHaveLength(2)
    for (const r of none) {
      expect(r.order_no).toBeNull()
      expect(r.wo_value).toBeNull()
      expect(r.ra_no).toBeNull()
    }
    expect(rows.filter(r => r.wo_pending)).toHaveLength(1)
  })

  // Before the CT Head locks it there is no certified figure; inventing one
  // would misread the flow.
  it('sets net payable only where a desk has actually certified it', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos, resolve, TODAY)
    const withNet = rows.filter(r => r.net_amount != null)
    expect(withNet).toHaveLength(1)
    expect(withNet[0].stage).toBe('trust')
    expect(withNet[0].net_amount!).toBeLessThan(withNet[0].claimed_amount)
  })

  it('spreads them across the desks so the timeline has something to show', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos, resolve, TODAY)
    expect(new Set(rows.map(r => r.stage)).size).toBeGreaterThanOrEqual(6)
    expect(rows.some(r => r.days_at_desk > 7)).toBe(true)
    expect(rows.every(r => r.bill_no.startsWith('EX-'))).toBe(true)
  })

  // A walkthrough built on a work order that is not in the mirror would teach
  // the wrong arithmetic, so it is skipped rather than invented.
  it('skips an example whose work order is missing, and keeps the rest', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos.slice(0, 3), resolve, TODAY)
    expect(rows.length).toBeLessThan(10)
    expect(rows.some(r => r.order_type === 'Without WO/PO')).toBe(true)
  })

  it('dates every bill before the day it arrived at its desk', () => {
    const rows = buildExamples(EXAMPLE_PLANS, wos, resolve, TODAY)
    for (const r of rows) expect(new Date(r.bill_date).getTime()).toBeLessThan(TODAY.getTime())
  })
})
