import { describe, it, expect } from 'vitest'
import { splitCheckedComment, remarkRepeatsAmount } from './approval-trail'

describe('splitCheckedComment', () => {
  // The two real entries from the sheet Aksha screenshotted.
  it('splits a sign-off into the figure and the remark', () => {
    const r = splitCheckedComment('Checked ₹51,27,656 — Ok to go ahead have checked the Working')
    expect(r.checked).toBe(5127656)
    expect(r.comment).toBe('Ok to go ahead have checked the Working')
  })

  it('handles a remark that repeats the amount in its own words', () => {
    const r = splitCheckedComment('Checked ₹51,27,656 — Adoc budgets for SWD work. Checked 51,27,656/-')
    expect(r.checked).toBe(5127656)
    expect(r.comment).toBe('Adoc budgets for SWD work. Checked 51,27,656/-')
  })

  it('returns the amount alone when no remark was typed', () => {
    const r = splitCheckedComment('Checked ₹5,00,000')
    expect(r.checked).toBe(500000)
    expect(r.comment).toBeNull()
  })

  it('leaves an ordinary comment untouched', () => {
    const r = splitCheckedComment('Rates look high on row 3, please recheck')
    expect(r.checked).toBeNull()
    expect(r.comment).toBe('Rates look high on row 3, please recheck')
  })

  it('handles a plain hyphen as well as an em dash', () => {
    expect(splitCheckedComment('Checked ₹1,00,000 - fine').comment).toBe('fine')
  })

  it('handles nothing at all', () => {
    expect(splitCheckedComment(null)).toEqual({ comment: null, checked: null })
    expect(splitCheckedComment('')).toEqual({ comment: null, checked: null })
  })
})

describe('remarkRepeatsAmount', () => {
  it('spots the figure restated in the approver own words', () => {
    // This is the duplication Aksha called out: the trail printed the amount
    // from our prefix AND from his sentence.
    expect(remarkRepeatsAmount('Adoc budgets for SWD work. Checked 51,27,656/-', 5127656)).toBe(true)
  })

  it('ignores punctuation and currency marks when comparing', () => {
    expect(remarkRepeatsAmount('approved ₹51,27,656 today', 5127656)).toBe(true)
  })

  it('is false when the remark says something else', () => {
    expect(remarkRepeatsAmount('Ok to go ahead have checked the Working', 5127656)).toBe(false)
  })

  it('is false when there is nothing to compare', () => {
    expect(remarkRepeatsAmount(null, 5127656)).toBe(false)
    expect(remarkRepeatsAmount('anything', null)).toBe(false)
  })
})
