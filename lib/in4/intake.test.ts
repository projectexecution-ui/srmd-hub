import { describe, it, expect } from 'vitest'
import { classifySubproject, autoAdopts, proposeCode, planIntake, bphEntryFor, intakeWords, hubNameFor } from './intake'

describe('classifySubproject — IN4 names, as they are today', () => {
  it('reads the kind off the suffix', () => {
    expect(classifySubproject('Old Swadhyay Hall - Execution')).toBe('execution')
    expect(classifySubproject('Prem Parking - Execution')).toBe('execution')
    expect(classifySubproject('Raj Uphaar - Design')).toBe('design')
    expect(classifySubproject('New Guest House B-Design')).toBe('design')
    expect(classifySubproject('DN Extension - Professional Consultancy')).toBe('consultancy')
    expect(classifySubproject('New Guest House - Design Professional Consultancy')).toBe('consultancy')
    expect(classifySubproject('Shrimad Rajchandra Jivadaya Trust')).toBe('other')
    expect(classifySubproject('SRMD Fixed Assets')).toBe('other')
    expect(classifySubproject('Common Expenses')).toBe('other')
    expect(classifySubproject('Naturopathy - Bhoomi Pujan')).toBe('other')
  })
  it('a name with no suffix is treated as execution — the building itself', () => {
    expect(classifySubproject('Design Admin')).toBe('design')  // says design
    expect(classifySubproject('Staff Facilities Block - Execution')).toBe('execution')
  })
  it('only execution arrives on its own', () => {
    expect(autoAdopts('execution')).toBe(true)
    for (const k of ['design', 'consultancy', 'other'] as const) expect(autoAdopts(k)).toBe(false)
  })
})

describe('proposeCode', () => {
  it('initials of the building, without the suffix; unique against what exists', () => {
    expect(proposeCode('Old Swadhyay Hall - Execution', new Set())).toBe('OSH')
    expect(proposeCode('Prem Parking - Execution', new Set(['PP']))).toBe('PP2')
    expect(proposeCode('Warehouse - Design', new Set())).toBe('WARE')
    expect(proposeCode('DN Extension - Execution', new Set(['de']))).toBe('DE2')  // case-insensitive clash
  })
})

describe('planIntake', () => {
  const rows = [
    { subprojectId: 101, name: 'Old Swadhyay Hall - Execution', in4ProjectId: 7, in4ProjectName: 'Old Swadhyay Hall', areaFt: 1200, budget: null, firstSeenAt: '2026-09-23T04:00:00Z' },
    { subprojectId: 102, name: 'Old Swadhyay Hall - Design', in4ProjectId: 7, in4ProjectName: 'Old Swadhyay Hall', areaFt: null, budget: null, firstSeenAt: '2026-09-23T04:00:00Z' },
    { subprojectId: 55, name: 'Raj Uphaar - Design', in4ProjectId: 3, in4ProjectName: 'Raj Uphaar', areaFt: null, budget: null, firstSeenAt: '2026-09-23T04:00:00Z' },
  ]
  it('uses the existing group where a sibling already lives, and creates ONE new group per IN4 project otherwise', () => {
    const plan = planIntake(rows, { groupByIn4Project: new Map([[3, 'rug-id']]), takenCodes: new Set(['RU', 'RUG']) })
    expect(plan[2].parent).toEqual({ id: 'rug-id' })
    expect(plan[0].parent).toEqual({ create: { name: 'Old Swadhyay Hall', code: 'OSHG' } })
    expect(plan[1].parent).toEqual(plan[0].parent)  // same new group, not two
    expect(plan.map(p => p.code)).toEqual(['OSH', 'OSH2', 'RU2'])
    expect(plan.map(p => p.kind)).toEqual(['execution', 'design', 'design'])
  })
  it('keeps IN4’s own name', () => {
    expect(hubNameFor('Old  Swadhyay Hall - Execution ')).toBe('Old Swadhyay Hall - Execution')
  })
})

describe('bphEntryFor and words', () => {
  it('mints a greppable id for the undo', () => {
    expect(bphEntryFor(101, 'X', 5).id).toBe('ctin4101')
    expect(bphEntryFor(101, 'X', 5)).toMatchObject({ type: 'project', data: null, parentId: null })
  })
  it('Today lines read as sentences', () => {
    expect(intakeWords({ waiting: 67, arrivedRecently: 0 })).toEqual({ waiting: '67 IN4 sub-projects are not in the hub — choose which come in.', arrived: null })
    expect(intakeWords({ waiting: 0, arrivedRecently: 1 }).arrived).toBe('1 new IN4 project arrived from the sync and needs finishing — an Atm Head and categories.')
    expect(intakeWords({ waiting: 1, arrivedRecently: 0 }).waiting).toBe('1 IN4 sub-project is not in the hub — choose which come in.')
  })
})
