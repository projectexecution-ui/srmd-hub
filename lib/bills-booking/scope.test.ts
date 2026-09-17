import { describe, it, expect } from 'vitest'
import { isOutOfScope, rowOutOfScope, inScopeProjects } from './scope'

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

describe('inScopeProjects — CT Hub project choosers', () => {
  // The five real ones, checked against the live project list on 17 Sep 2026.
  const REAL = [
    { name: 'New Guest House - Infra Work - Design' },
    { name: 'P2 Row Houses - Design' },
    { name: 'P2 Stepped Terraces - Professional Consultancy' },
    { name: 'Sheth House - Design ' },
    { name: 'Welcome Centre Extension - Design' },
    { name: 'NGH B' },
    { name: 'SRAH' },
    { name: 'Admin Block Full Building' },
    { name: 'P2 Stepped Terraces Common Expenses' },
    { name: 'New Row House Infra' },
  ]
  it('drops Design and Professional Consultancy, keeps the construction projects', () => {
    expect(inScopeProjects(REAL).map(p => p.name)).toEqual([
      'NGH B', 'SRAH', 'Admin Block Full Building',
      'P2 Stepped Terraces Common Expenses', 'New Row House Infra',
    ])
  })
  it('keeps a look-alike that is neither', () => {
    // "Common Expenses" sits beside the consultancy row and must survive.
    expect(inScopeProjects([{ name: 'P2 Stepped Terraces Common Expenses' }])).toHaveLength(1)
  })
  it('catches the invisible word-joiner that IN4 pasted into a name', () => {
    expect(inScopeProjects([{ name: 'Old Swadhyay Hall - ⁠Design' }])).toHaveLength(0)
  })
  it('an empty list stays empty rather than throwing', () => {
    expect(inScopeProjects([])).toEqual([])
  })
})
