import { describe, it, expect } from 'vitest'
import { isOutOfScope, rowOutOfScope } from './scope'

describe('what Bills Approval leaves out', () => {
  it('excludes every shape of Design sub-project IN4 actually has', () => {
    for (const n of [
      'Admin Block - Design',
      'New Guest House B-Design',
      'New Guest House - Infra Work - Design',
      'Design Admin',
      'Step Terrace MEP Infra - Design',
      'Welcome Centre Extension - Design',
    ]) expect(isOutOfScope(n), n).toBe(true)
  })

  it('excludes Professional Consultancy in every shape', () => {
    for (const n of [
      'Raj Uphaar - Professional Consultancy',
      'Professional Consultancy (Staff)',
      'New Guest House - Design Professional Consultancy',
      'SRAH - Professional Consultancy',
    ]) expect(isOutOfScope(n), n).toBe(true)
  })

  it('survives the invisible character in "Old Swadhyay Hall - ⁠Design"', () => {
    // U+2060 word joiner, pasted in from a document. Renders as nothing.
    const real = 'Old Swadhyay Hall - ⁠Design'
    expect(real).not.toBe('Old Swadhyay Hall - Design')   // genuinely different strings
    expect(isOutOfScope(real)).toBe(true)
    // and the other invisibles that turn up in pasted names
    expect(isOutOfScope('Warehouse -​ Design')).toBe(true)
    expect(isOutOfScope('﻿Design Admin')).toBe(true)
  })

  it('keeps execution, infra, interior and the rest of the work', () => {
    for (const n of [
      'Staff Facilities Block - Execution',
      'Raj Uphaar - Infra Work - Execution',
      'Raj Saurabh - Interior Scope',
      'New Guest House - Common Expenses',
      'P2 Stepped Terraces - Execution A-02',
      'RU Infra Work',
      'Naturopathy - Bhoomi Pujan',
      'Raj Uphaar - SRMD Landscape',
      'Warehouse - SRMD Ashram Security Team',
    ]) expect(isOutOfScope(n), n).toBe(false)
  })

  it('treats a missing name as in scope rather than hiding it', () => {
    expect(isOutOfScope(null)).toBe(false)
    expect(isOutOfScope(undefined)).toBe(false)
    expect(isOutOfScope('')).toBe(false)
  })

  it('only drops a row when it really belongs to an excluded sub-project', () => {
    const ex = new Set([18, 27])
    expect(rowOutOfScope(ex, 18)).toBe(true)
    expect(rowOutOfScope(ex, 5)).toBe(false)
    expect(rowOutOfScope(ex, null)).toBe(false)
    expect(rowOutOfScope(ex, undefined)).toBe(false)
  })
})
