import { describe, it, expect } from 'vitest'
import { normAlias, resolveAlias, type AliasMap, type AliasRow } from './aliases'

const row = (o: Partial<AliasRow>): AliasRow => ({ id: 1, source: 'in4', alias: '', alias_norm: '', project_id: null, confidence: 'certain', why: null, ...o })

describe('aliases', () => {
  it('normalises the way the database column does', () => {
    expect(normAlias('  P2  Infra ')).toBe('p2 infra')
    expect(normAlias('Sheth House - Design ')).toBe('sheth house design')
    expect(normAlias('Civil & MEP Central Warehouse')).toBe('civil mep central warehouse')
  })
  it('resolves exactly, never fuzzily', () => {
    const map: AliasMap = new Map([
      ['new guest house a', { projectId: 'p1', row: row({ alias: 'New Guest House A', project_id: 'p1' }) }],
      ['raj uphaar', { projectId: null, row: row({ alias: 'Raj Uphaar', why: 'not ours yet' }) }],
    ])
    expect(resolveAlias(map, 'New Guest House A').kind).toBe('project')
    expect(resolveAlias(map, 'NEW GUEST HOUSE - A').kind).toBe('project')
    expect(resolveAlias(map, 'Raj Uphaar').kind).toBe('not-ours')
    expect(resolveAlias(map, 'New Guest House').kind).toBe('unknown')   // the group is not the building
  })
})
