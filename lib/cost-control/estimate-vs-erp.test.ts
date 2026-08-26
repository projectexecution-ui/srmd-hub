import { describe, it, expect } from 'vitest'
import { estimateShortfall, hasNoEstimate } from './estimate-vs-erp'

const erp = (budget: number) => ({ budget, wo: 0, paid: 0 })

describe('estimateShortfall', () => {
  // Real violations pulled from the live database.
  it('flags NGH B 317 Civil Contractor Cost — the largest', () => {
    expect(estimateShortfall(77_654_035, erp(118_114_151))).toBe(40_460_116)
  })

  it('flags SRAH 801 High Side — a ₹5 L placeholder against ₹1.72 Cr', () => {
    expect(estimateShortfall(500_000, erp(17_200_000))).toBe(16_700_000)
  })

  it('flags the repeated ₹12,00,000 Excavation placeholder', () => {
    expect(estimateShortfall(1_200_000, erp(5_117_836))).toBe(3_917_836)
  })

  it('flags the smallest genuine one — CV5 Flooring, ₹9,332 short', () => {
    expect(estimateShortfall(75_643, erp(84_975))).toBe(9_332)
  })

  it('does NOT flag SRAH 1602 Courtyards — ₹5,20,000 vs ₹5,20,001', () => {
    // One rupee is rounding, not a wrong estimate. A flag that fires here is
    // a flag people stop reading.
    expect(estimateShortfall(520_000, erp(520_001))).toBe(0)
  })

  it('stays silent when the estimate is above the ERP budget', () => {
    expect(estimateShortfall(20_000_000, erp(16_000_000))).toBe(0)
  })

  it('stays silent when the estimate exactly matches', () => {
    expect(estimateShortfall(5_000_000, erp(5_000_000))).toBe(0)
  })

  it('holds the noise floor at exactly ₹1,000', () => {
    expect(estimateShortfall(100_000, erp(100_999))).toBe(0)
    expect(estimateShortfall(100_000, erp(101_000))).toBe(1_000)
  })

  it('does not flag a line ERP has not funded yet', () => {
    expect(estimateShortfall(0, erp(0))).toBe(0)
    expect(estimateShortfall(50_000, erp(0))).toBe(0)
  })

  it('treats a missing estimate as absent, not as a zero-value shortfall', () => {
    // Otherwise 208 blank lines would bury the 21 genuinely wrong ones.
    expect(estimateShortfall(0, erp(17_200_000))).toBe(0)
    expect(estimateShortfall(null, erp(17_200_000))).toBe(0)
  })

  it('ignores paise on either side', () => {
    expect(estimateShortfall(520_000.4, erp(520_000.9))).toBe(0)
  })

  it('handles a missing budget line', () => {
    expect(estimateShortfall(100_000, null)).toBe(0)
  })
})

describe('hasNoEstimate', () => {
  it('is true where ERP released money and no estimate exists', () => {
    expect(hasNoEstimate(0, erp(17_200_000))).toBe(true)
    expect(hasNoEstimate(null, erp(4_000_000))).toBe(true)
  })

  it('is false once any estimate is set, however wrong', () => {
    expect(hasNoEstimate(500_000, erp(17_200_000))).toBe(false)
  })

  it('is false when ERP has not funded the line', () => {
    expect(hasNoEstimate(0, erp(0))).toBe(false)
    expect(hasNoEstimate(0, null)).toBe(false)
  })
})
