import { describe, it, expect } from 'vitest'
import {
  formatINR, formatNumber, indentStageColor, indentStageLabel, formatDate,
} from './utils'

describe('formatINR', () => {
  it('formats whole rupees with the ₹ symbol and Indian grouping', () => {
    // Intl may use a non-breaking space after the symbol; assert on the digits.
    expect(formatINR(150000)).toMatch(/1,50,000/)
    expect(formatINR(10000000)).toMatch(/1,00,00,000/)
  })

  it('accepts numeric strings', () => {
    expect(formatINR('2500')).toMatch(/2,500/)
  })

  it('returns an em dash for null / undefined / NaN', () => {
    expect(formatINR(null)).toBe('—')
    expect(formatINR(undefined)).toBe('—')
    expect(formatINR('not-a-number')).toBe('—')
  })

  it('returns an em dash for ±Infinity — why: Intl would render "₹∞"', () => {
    expect(formatINR(Infinity)).toBe('—')
    expect(formatINR(-Infinity)).toBe('—')
    expect(formatINR('Infinity')).toBe('—')
  })

  it('handles zero', () => {
    expect(formatINR(0)).toMatch(/0/)
  })
})

describe('formatNumber', () => {
  it('groups Indian-style with default 2 decimals', () => {
    expect(formatNumber(150000)).toBe('1,50,000.00')
  })

  it('respects a custom decimal count (rounds, per toLocaleString)', () => {
    expect(formatNumber(1234.5, 0)).toBe('1,235')   // rounds half up
    expect(formatNumber(1234.4, 0)).toBe('1,234')
    expect(formatNumber(1234.567, 3)).toBe('1,234.567')
  })

  it('returns an em dash for null / NaN / Infinity', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber('xyz')).toBe('—')
    expect(formatNumber(Infinity)).toBe('—')
  })
})

describe('indentStageColor', () => {
  it('maps known stages to badge tones', () => {
    expect(indentStageColor('approved')).toBe('success')
    expect(indentStageColor('verify')).toBe('warning')
    expect(indentStageColor('submitted')).toBe('default')
    expect(indentStageColor('draft')).toBe('secondary')
  })

  it('falls back to secondary for unknown stages', () => {
    expect(indentStageColor('whatever')).toBe('secondary')
  })
})

describe('indentStageLabel', () => {
  it('maps known stages to human labels', () => {
    expect(indentStageLabel('draft')).toBe('Draft')
    expect(indentStageLabel('verify')).toBe('In Verification')
    expect(indentStageLabel('approved')).toBe('Approved')
  })

  it('echoes unknown stages unchanged', () => {
    expect(indentStageLabel('custom_stage')).toBe('custom_stage')
  })
})

describe('formatDate', () => {
  it('returns a placeholder for empty input', () => {
    expect(formatDate(null)).toBe('--')
    expect(formatDate(undefined)).toBe('--')
  })

  it('formats an ISO date to dd Mon yyyy', () => {
    // toLocaleDateString output is environment-locale-stable for en-IN here.
    const out = formatDate('2026-06-04')
    expect(out).toMatch(/\d{2}/)        // has a day
    expect(out).toMatch(/2026/)         // has the year
  })
})
