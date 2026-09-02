import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES, capability, fragileCapabilities, mergeGrants, hasNoApprover,
  screensReplaced, type Person, type RawGrants,
} from './project-people'

const PEOPLE: Person[] = [
  { id: 'u1', full_name: 'Akshay Atmarpit', email: 'a@srmd.org', role: 'head' },
  { id: 'u2', full_name: 'Akshay Parekh', email: 'p@gmail.com', role: 'engineer' },
  { id: 'u3', full_name: null, email: 'x@srmd.org', role: 'viewer' },
  { id: 'u4', full_name: '  ', email: 'blank@srmd.org', role: 'viewer' },
]

const EMPTY: RawGrants = {
  approvers: [], assignments: [], jmrAccess: [], indentViewers: [], deskMembers: [],
}

describe('the six tables behind one question', () => {
  it('has a unique id per capability', () => {
    const ids = CAPABILITIES.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every label to five words or fewer', () => {
    for (const c of CAPABILITIES) {
      expect(c.label.trim().split(/\s+/).length, c.id).toBeLessThanOrEqual(5)
    }
  })

  it('names a real table and a real screen for each', () => {
    for (const c of CAPABILITIES) {
      expect(c.table, c.id).toMatch(/^[a-z_]+$/)
      expect(c.replaces.startsWith('/'), c.id).toBe(true)
    }
  })

  it('covers six tables across five screens', () => {
    expect(new Set(CAPABILITIES.map(c => c.table)).size).toBe(5)
    expect(screensReplaced()).toBe(5)
  })

  // Renaming a project silently detaches this grant, because it is matched on
  // the project's NAME rather than its id. Worth flagging on screen.
  it('flags the grant that is keyed on a text name', () => {
    expect(fragileCapabilities().map(c => c.id)).toEqual(['sees_indents'])
  })

  it('throws on an unknown capability rather than returning undefined', () => {
    expect(() => capability('nope' as never)).toThrow(/Unknown capability/)
  })
})

describe('folding the six sources into one row per person', () => {
  it('returns nobody when there are no grants', () => {
    expect(mergeGrants(PEOPLE, EMPTY)).toEqual([])
  })

  it('lists only people who actually have something', () => {
    const rows = mergeGrants(PEOPLE, { ...EMPTY, assignments: [{ user_id: 'u2' }] })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Akshay Parekh')
  })

  it('gathers one person\'s grants across all six tables into a single row', () => {
    const rows = mergeGrants(PEOPLE, {
      approvers: [{ user_id: 'u1', role: 'head' }],
      assignments: [{ user_id: 'u1' }],
      jmrAccess: [{ user_id: 'u1' }],
      indentViewers: [{ user_id: 'u1' }],
      deskMembers: [{ user_id: 'u1', desk: 'CT Billing' }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].has).toEqual({
      approver: 'head', works_on: true, jmr_log: true,
      sees_indents: true, bill_desk: 'CT Billing',
    })
  })

  it('keeps the approver role and the desk name, not just a tick', () => {
    const rows = mergeGrants(PEOPLE, {
      ...EMPTY,
      approvers: [{ user_id: 'u1', role: 'project_head' }],
      deskMembers: [{ user_id: 'u2', desk: 'Site Head' }],
    })
    expect(rows.find(r => r.userId === 'u1')!.has.approver).toBe('project_head')
    expect(rows.find(r => r.userId === 'u2')!.has.bill_desk).toBe('Site Head')
  })

  it('falls back to true when the role or desk is blank', () => {
    const rows = mergeGrants(PEOPLE, {
      ...EMPTY,
      approvers: [{ user_id: 'u1', role: '  ' }],
      deskMembers: [{ user_id: 'u2', desk: null }],
    })
    expect(rows.find(r => r.userId === 'u1')!.has.approver).toBe(true)
    expect(rows.find(r => r.userId === 'u2')!.has.bill_desk).toBe(true)
  })

  // A grant left behind by a deleted account must not take the panel down.
  it('ignores a grant for someone who is no longer there', () => {
    const rows = mergeGrants(PEOPLE, { ...EMPTY, approvers: [{ user_id: 'ghost', role: 'head' }] })
    expect(rows).toEqual([])
  })

  it('falls back to the email when a person has no name', () => {
    expect(mergeGrants(PEOPLE, { ...EMPTY, assignments: [{ user_id: 'u3' }] })[0].name)
      .toBe('x@srmd.org')
    expect(mergeGrants(PEOPLE, { ...EMPTY, assignments: [{ user_id: 'u4' }] })[0].name)
      .toBe('blank@srmd.org')
  })

  it('puts approvers first, then whoever does most', () => {
    const rows = mergeGrants(PEOPLE, {
      approvers: [{ user_id: 'u3', role: 'head' }],
      assignments: [{ user_id: 'u1' }, { user_id: 'u2' }],
      jmrAccess: [{ user_id: 'u1' }],
      indentViewers: [],
      deskMembers: [],
    })
    expect(rows.map(r => r.userId)).toEqual(['u3', 'u1', 'u2'])
  })

  it('orders people with equal standing by name, so the list does not jump about', () => {
    const rows = mergeGrants(PEOPLE, {
      ...EMPTY, assignments: [{ user_id: 'u2' }, { user_id: 'u1' }],
    })
    expect(rows.map(r => r.name)).toEqual(['Akshay Atmarpit', 'Akshay Parekh'])
  })

  it('does not duplicate a person who appears twice in one table', () => {
    const rows = mergeGrants(PEOPLE, {
      ...EMPTY, deskMembers: [{ user_id: 'u1', desk: 'A' }, { user_id: 'u1', desk: 'B' }],
    })
    expect(rows).toHaveLength(1)
  })

  // The condition behind "3 projects have no approver" — a budget raised on one
  // of these has nowhere to go.
  it('spots a project nobody can sign off', () => {
    expect(hasNoApprover(mergeGrants(PEOPLE, { ...EMPTY, assignments: [{ user_id: 'u1' }] })))
      .toBe(true)
    expect(hasNoApprover(mergeGrants(PEOPLE, { ...EMPTY, approvers: [{ user_id: 'u1', role: 'head' }] })))
      .toBe(false)
  })

  it('treats an empty project as having no approver', () => {
    expect(hasNoApprover([])).toBe(true)
  })
})
