import { describe, it, expect } from 'vitest'
import { amountInWords, integerInWords } from './amount-in-words'

describe('amountInWords — the one computed figure on a printed PO', () => {
  it('groups the Indian way: crore, lakh, thousand', () => {
    expect(integerInWords(6_92_161)).toBe('Six Lakh Ninety-Two Thousand One Hundred Sixty-One')
    expect(integerInWords(1_23_45_678)).toBe('One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight')
    expect(integerInWords(90_683)).toBe('Ninety Thousand Six Hundred Eighty-Three')
  })
  it('handles the teens and round hundreds', () => {
    expect(integerInWords(14)).toBe('Fourteen')
    expect(integerInWords(100)).toBe('One Hundred')
    expect(integerInWords(1_00_000)).toBe('One Lakh')
    expect(integerInWords(0)).toBe('Zero')
  })
  it('wraps in Rupees … Only and writes paise only when there are any', () => {
    expect(amountInWords(90683)).toBe('Rupees Ninety Thousand Six Hundred Eighty-Three Only')
    expect(amountInWords(692161.45)).toBe('Rupees Six Lakh Ninety-Two Thousand One Hundred Sixty-One and Forty-Five Paise Only')
    expect(amountInWords('12004.64')).toBe('Rupees Twelve Thousand Four and Sixty-Four Paise Only')
  })
  it('rounds .999 paise up rather than writing "One Hundred Paise"', () => {
    expect(amountInWords(9.999)).toBe('Rupees Ten Only')
  })
  it('is blank — not "Rupees NaN" — for anything that is not a number', () => {
    expect(amountInWords(null)).toBeNull()
    expect(amountInWords('abc')).toBeNull()
    expect(amountInWords(-5)).toBeNull()
  })
})
