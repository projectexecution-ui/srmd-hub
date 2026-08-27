import { describe, it, expect } from 'vitest'
import { adhocStateOf, ADHOC_SHORT, ADHOC_LABEL } from './adhoc'

describe('adhocStateOf', () => {
  it('reads a declared adhoc budget', () => {
    expect(adhocStateOf(true)).toBe('adhoc')
    expect(ADHOC_SHORT[adhocStateOf(true)]).toBe('ADHOC')
  })

  it('reads a declared BOQ budget', () => {
    expect(adhocStateOf(false)).toBe('boq')
    expect(ADHOC_LABEL[adhocStateOf(false)]).toBe('As per BOQ')
  })

  it('treats null as UNDECLARED, never as BOQ', () => {
    // The distinction the HOD asked for: "if Mayank bhai forgets" is a real
    // state. Collapsing it into BOQ would print a claim nobody made against
    // every sheet raised before this feature existed.
    expect(adhocStateOf(null)).toBe('undeclared')
    expect(adhocStateOf(undefined)).toBe('undeclared')
    expect(ADHOC_SHORT[adhocStateOf(null)]).toBe('—')
  })
})
