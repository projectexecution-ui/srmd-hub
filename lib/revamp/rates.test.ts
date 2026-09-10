import { describe, it, expect } from 'vitest'
import { summariseMaterialRates, type PoRateLine } from './rates'

const line = (o: Partial<PoRateLine> & { rate: number; qty: number }): PoRateLine => ({
  materialId: 3285, material: 'Pidilite - Roff (T02) Grey', uom: 'Kgs', poId: 1, poNo: 'PO/1', date: '2026-03-26',
  supplierId: 68, supplier: 'NATUROPROTECT', project: 'New Guest House', value: o.rate * o.qty, ...o,
})

describe('summariseMaterialRates — what we paid, grouped the way the question is asked', () => {
  it('finds last, min, max, weighted average and the spread', () => {
    const [m] = summariseMaterialRates([
      line({ rate: 13.25, qty: 5800, date: '2026-03-26' }),
      line({ rate: 14.0, qty: 1000, date: '2026-05-01', poId: 2, poNo: 'PO/2', supplier: 'OTHER', supplierId: 9 }),
      line({ rate: 12.0, qty: 200, date: '2025-11-10', poId: 3, poNo: 'PO/3', supplier: 'OTHER', supplierId: 9 }),
    ])
    expect(m.lastRate).toBe(14.0)
    expect(m.lastSupplier).toBe('OTHER')
    expect(m.minRate).toBe(12.0)
    expect(m.maxRate).toBe(14.0)
    expect(m.avgRate).toBeCloseTo((13.25 * 5800 + 14 * 1000 + 12 * 200) / 7000, 4)
    expect(m.spread).toBeCloseTo(2 / 12, 4)
    expect(m.suppliers).toEqual(['NATUROPROTECT', 'OTHER'])
    expect(m.lines[0].poNo).toBe('PO/2')
  })
  it('names the cheapest supplier only when more than one supplied', () => {
    const one = summariseMaterialRates([line({ rate: 13.25, qty: 100 })])[0]
    expect(one.cheapest).toBeNull()
    const two = summariseMaterialRates([line({ rate: 13.25, qty: 100 }), line({ rate: 12, qty: 100, supplier: 'OTHER', supplierId: 9 })])[0]
    expect(two.cheapest).toEqual({ supplier: 'OTHER', rate: 12 })
  })
  it('orders materials by spend, biggest first', () => {
    const out = summariseMaterialRates([
      line({ materialId: 1, material: 'Small', rate: 10, qty: 1 }),
      line({ materialId: 2, material: 'Big', rate: 1000, qty: 100 }),
    ])
    expect(out.map(m => m.material)).toEqual(['Big', 'Small'])
  })
})
