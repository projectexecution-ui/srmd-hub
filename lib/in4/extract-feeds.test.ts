import { describe, it, expect } from 'vitest'
import { applyPoLine } from './extract-feeds'

describe('applyPoLine — the PO line’s own quantity beats the view’s PO total', () => {
  // PO/SRASSK/NGH/2025-26/93, 8 Sept 2026: two lines, 44,200 kg and 70 kg. The
  // view reports 44,270 on both. The details fact has each line's own figures.
  it('takes the detail line quantity and prices it from the line value', () => {
    const big = applyPoLine({ po_qty: 44270, po_rate: 13.25 }, { qty: 44200, value: 585650, rate: 13.25 })
    expect(big).toEqual({ po_qty: 44200, po_rate: 13.25 })
    const small = applyPoLine({ po_qty: 44270, po_rate: 13.25 }, { qty: 70, value: 927.5, rate: 13.25 })
    expect(small.po_qty).toBe(70)
    expect(small.po_rate).toBeCloseTo(13.25, 6)
  })
  it('leaves the view alone when there is no detail row', () => {
    expect(applyPoLine({ po_qty: 6, po_rate: 224 }, undefined)).toEqual({ po_qty: 6, po_rate: 224 })
  })
  it('a line IN4 cancelled to zero stays zero, keeping the view rate for reference', () => {
    expect(applyPoLine({ po_qty: 100, po_rate: 9 }, { qty: 0, value: 0, rate: 9 })).toEqual({ po_qty: 0, po_rate: 9 })
  })
})
