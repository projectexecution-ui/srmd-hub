import { describe, it, expect } from 'vitest'
import { buildPriceContext, referenceRate, priceDelta, type PoRateLine } from './approver'

const L = (o: Partial<PoRateLine> & { materialId: number; rate: number }): PoRateLine => ({
  poId: 1, poNo: 'PO/SRASSK/NGH/2025-26/1', date: '2026-01-01T00:00:00.000Z', supplier: 'A', project: 'New Guest House', projectId: 12, qty: 10, value: 0, grnQty: 10, ...o,
})

const LINES: PoRateLine[] = [
  L({ materialId: 5000, rate: 380, date: '2026-03-01T00:00:00.000Z', supplier: 'ULTRATECH', poId: 1, qty: 100, grnQty: 100, value: 38000 }),
  L({ materialId: 5000, rate: 400, date: '2026-08-20T00:00:00.000Z', supplier: 'ULTRATECH', poId: 2, qty: 100, grnQty: 50, value: 40000 }),
  L({ materialId: 5000, rate: 420, date: '2026-09-01T00:00:00.000Z', supplier: 'AMBUJA', poId: 3, project: 'Raj Uphaar', projectId: 7, qty: 500, grnQty: 0, value: 210000 }),
  L({ materialId: 3754, rate: 150, date: '2025-11-01T00:00:00.000Z', supplier: 'JINDAL', poId: 4, project: 'Raj Uphaar', projectId: 7, qty: 200 }),
]

describe('buildPriceContext', () => {
  const ctx = buildPriceContext(LINES, 12)
  it('the last purchase anywhere and the last on this project are different things', () => {
    const c = ctx.get(5000)!
    expect(c.last).toMatchObject({ rate: 420, supplier: 'AMBUJA', project: 'Raj Uphaar' })
    expect(c.lastHere).toMatchObject({ rate: 400, supplier: 'ULTRATECH' })
    expect(c.purchases).toBe(3)
    expect(c.suppliers).toBe(2)
    expect([c.minRate, c.maxRate]).toEqual([380, 420])
  })
  it('sums what this project has bought so far', () => {
    expect(ctx.get(5000)!.onProject).toEqual({ orderedQty: 200, receivedQty: 150, spend: 78000, pos: 2 })
  })
  it('a material never bought here has no lastHere and nothing on the project', () => {
    const c = ctx.get(3754)!
    expect(c.lastHere).toBeNull()
    expect(c.last).toMatchObject({ rate: 150, supplier: 'JINDAL' })
    expect(c.onProject).toEqual({ orderedQty: 0, receivedQty: 0, spend: 0, pos: 0 })
  })
  it('without a project id nothing counts as "here"', () => {
    expect(buildPriceContext(LINES, null).get(5000)!.lastHere).toBeNull()
  })
})

describe('referenceRate / priceDelta', () => {
  const ctx = buildPriceContext(LINES, 12)
  it('compares with this project first, then the trust', () => {
    expect(referenceRate(ctx.get(5000))).toMatchObject({ rate: 400, where: 'here' })
    expect(referenceRate(ctx.get(3754))).toMatchObject({ rate: 150, where: 'elsewhere' })
    expect(referenceRate(undefined)).toBeNull()
  })
  it('gives the change as a percentage, or nothing to compare with', () => {
    expect(priceDelta(440, ctx.get(5000))).toBeCloseTo(10)
    expect(priceDelta(380, ctx.get(5000))).toBeCloseTo(-5)
    expect(priceDelta(100, undefined)).toBeNull()
    expect(priceDelta(null, ctx.get(5000))).toBeNull()
  })
})
