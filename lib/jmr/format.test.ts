import { describe, it, expect } from 'vitest'
import { formatINR, formatINRShort, formatNumberIN, formatDateIN, formatDateShort } from './format'

// These power the JMR dashboard money tiles + the matrix/bills numbers.
// Getting them wrong means a contractor bill or a dashboard total reads
// incorrectly, so they're worth locking down.

describe('formatINR — full Indian grouping with ₹', () => {
  it('groups thousands / lakhs / crores', () => {
    expect(formatINR(1000)).toBe('₹1,000')
    expect(formatINR(12345)).toBe('₹12,345')
    expect(formatINR(150000)).toBe('₹1,50,000')
    expect(formatINR(10000000)).toBe('₹1,00,00,000')
  })

  it('rounds to 0 decimals by default', () => {
    expect(formatINR(1234.56)).toBe('₹1,235')
  })

  it('respects a custom decimal count', () => {
    expect(formatINR(1234.5, { decimals: 2 })).toBe('₹1,234.50')
  })

  it('prefixes the sign before the symbol for negatives', () => {
    expect(formatINR(-150000)).toBe('-₹1,50,000')
  })

  it('handles zero and NaN', () => {
    expect(formatINR(0)).toBe('₹0')
    expect(formatINR(NaN)).toBe('—')
  })
})

describe('formatINRShort — lakh/crore tile format', () => {
  it('uses K / L / Cr thresholds', () => {
    expect(formatINRShort(500)).toBe('₹500')
    expect(formatINRShort(1500)).toBe('₹1.5 K')
    expect(formatINRShort(8257000)).toBe('₹82.57 L')   // 82.57 lakh
    expect(formatINRShort(14167000)).toBe('₹1.42 Cr')  // 1.4167 crore → 1.42
  })

  it('handles negatives and zero', () => {
    expect(formatINRShort(-14167000)).toBe('-₹1.42 Cr')
    expect(formatINRShort(0)).toBe('₹0')
  })

  it('returns em dash for NaN', () => {
    expect(formatINRShort(NaN)).toBe('—')
  })

  it('boundary: exactly 1 lakh and 1 crore', () => {
    expect(formatINRShort(100000)).toBe('₹1.00 L')
    expect(formatINRShort(10000000)).toBe('₹1.00 Cr')
  })
})

describe('formatNumberIN — grouped number, no symbol', () => {
  it('strips the ₹ but keeps grouping', () => {
    expect(formatNumberIN(150000)).toBe('1,50,000')
    expect(formatNumberIN(1234.5, 2)).toBe('1,234.50')
  })

  it('returns em dash for NaN', () => {
    expect(formatNumberIN(NaN)).toBe('—')
  })
})

describe('date formatters', () => {
  it('formatDateIN renders d MMM yyyy', () => {
    expect(formatDateIN('2026-05-21')).toBe('21 May 2026')
  })

  it('formatDateShort renders d MMM yy', () => {
    expect(formatDateShort('2026-05-21')).toBe('21 May 26')
  })

  it('both return em dash for null / undefined', () => {
    expect(formatDateIN(null)).toBe('—')
    expect(formatDateIN(undefined)).toBe('—')
    expect(formatDateShort(null)).toBe('—')
  })
})
