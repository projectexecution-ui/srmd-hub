import { describe, it, expect } from 'vitest'
import { stripToRaw, formatIndian, countDigitsLeftOf, caretPosForDigitCount } from './money'

describe('formatIndian — lakh/crore grouping', () => {
  it('leaves small numbers ungrouped', () => {
    expect(formatIndian('0')).toBe('0')
    expect(formatIndian('5')).toBe('5')
    expect(formatIndian('999')).toBe('999')
  })

  it('groups thousands', () => {
    expect(formatIndian('1000')).toBe('1,000')
    expect(formatIndian('12345')).toBe('12,345')
  })

  it('groups lakhs (2-digit groups after the first 3)', () => {
    expect(formatIndian('150000')).toBe('1,50,000')
    expect(formatIndian('1000000')).toBe('10,00,000')
  })

  it('groups crores', () => {
    expect(formatIndian('10000000')).toBe('1,00,00,000')
    expect(formatIndian('1500000000')).toBe('1,50,00,00,000')
  })

  it('preserves the decimal part untouched', () => {
    expect(formatIndian('1500000.50')).toBe('15,00,000.50')
    expect(formatIndian('1234.5')).toBe('1,234.5')
  })

  it('handles negatives when present', () => {
    expect(formatIndian('-150000')).toBe('-1,50,000')
  })

  it('passes intermediate typing states straight through', () => {
    expect(formatIndian('')).toBe('')
    expect(formatIndian('-')).toBe('-')
    expect(formatIndian('.')).toBe('.')
    expect(formatIndian('-.')).toBe('-.')
  })

  it('strips leading zeros but keeps a lone zero', () => {
    expect(formatIndian('007')).toBe('7')
    expect(formatIndian('0')).toBe('0')
    expect(formatIndian('0.5')).toBe('0.5')
  })

  it('formats a fraction-only raw value', () => {
    expect(formatIndian('.5')).toBe('.5')
  })
})

describe('stripToRaw — sanitising free-typed input', () => {
  it('removes commas and stray characters', () => {
    expect(stripToRaw('1,50,000', false, 2)).toBe('150000')
    expect(stripToRaw('₹ 12,345', false, 2)).toBe('12345')
    expect(stripToRaw('abc123', false, 2)).toBe('123')
  })

  it('keeps a single decimal point and truncates to N places', () => {
    expect(stripToRaw('123.456', false, 2)).toBe('123.45')
    expect(stripToRaw('123.4.5.6', false, 2)).toBe('123.45')
    expect(stripToRaw('123.456', false, 0)).toBe('123')
  })

  it('drops the minus sign when negatives are disallowed', () => {
    expect(stripToRaw('-500', false, 2)).toBe('500')
  })

  it('keeps a single leading minus when negatives are allowed', () => {
    expect(stripToRaw('-500', true, 2)).toBe('-500')
    expect(stripToRaw('5-0-0', true, 2)).toBe('500') // minus only honoured at front
  })

  it('returns empty string for empty / junk-only input', () => {
    expect(stripToRaw('', false, 2)).toBe('')
    expect(stripToRaw('abc', false, 2)).toBe('')
  })

  it('round-trips: stripToRaw → formatIndian is stable', () => {
    const typed = '1,50,000.50'
    const raw = stripToRaw(typed, false, 2)
    expect(formatIndian(raw)).toBe('1,50,000.50')
  })
})

describe('caret helpers', () => {
  it('counts digits left of the caret, ignoring commas', () => {
    // "1,50,000" with caret after "1,50," (index 5) → digits seen: 1,5,0 = 3
    expect(countDigitsLeftOf('1,50,000', 5)).toBe(3)
    expect(countDigitsLeftOf('1,50,000', 0)).toBe(0)
    expect(countDigitsLeftOf('1,50,000', 8)).toBe(6)
  })

  it('finds caret index for a given digit count (inverse)', () => {
    // 3rd digit (0-indexed) in "1,50,000" sits at index 5
    expect(caretPosForDigitCount('1,50,000', 3)).toBe(5)
    expect(caretPosForDigitCount('1,50,000', 0)).toBe(0)
    // Beyond the last digit → end of string
    expect(caretPosForDigitCount('1,50,000', 99)).toBe('1,50,000'.length)
  })
})
