import { describe, it, expect } from 'vitest'
import { searchParties, findParty, sameName, type In4Party } from './party-search'

const party = (o: Partial<In4Party>): In4Party => ({
  kind: 'contractor', id: 1, name: 'Desai Construction Pvt Ltd.', code: 'C0003', city: 'Surat', trades: ['03 Civil'], ...o,
})

const PARTIES: In4Party[] = [
  party({}),
  party({ id: 2, name: 'Crony Electricals', code: 'C0153', city: 'Vadodara', trades: ['05 Electrical'] }),
  party({ id: 3, kind: 'supplier', name: 'Desai Hardware', code: 'S0010', city: 'Dharampur', trades: [] }),
  party({ id: 4, name: 'Kasturi Projects', code: 'C0362', city: 'Valsad', trades: ['03 Civil', '12 Finishes'] }),
  party({ id: 5, name: 'Shree Desai Builders', code: 'C0400', city: 'Navsari', trades: ['03 Civil'] }),
]

describe('finding a party in IN4', () => {
  it('puts the name that starts with what was typed first, the right kind first', () => {
    expect(searchParties(PARTIES, 'desai', 'contractor').map(p => p.id)).toEqual([1, 3, 5])
    expect(searchParties(PARTIES, 'desai', 'supplier').map(p => p.id)).toEqual([3, 1, 5])
  })

  it('needs every word, anywhere: name, code, city or trade', () => {
    expect(searchParties(PARTIES, 'electrical vadodara', 'contractor').map(p => p.id)).toEqual([2])
    expect(searchParties(PARTIES, 'civil valsad', 'contractor').map(p => p.id)).toEqual([4])
    expect(searchParties(PARTIES, 'c0362', 'contractor').map(p => p.id)).toEqual([4])
  })

  it('returns nothing for an empty search', () => {
    expect(searchParties(PARTIES, '   ', 'contractor')).toEqual([])
  })

  it('knows a name IN4 holds, ignoring case and spacing — but not a near miss', () => {
    expect(findParty(PARTIES, '  desai construction pvt ltd. ')?.id).toBe(1)
    expect(findParty(PARTIES, 'Desai Construction')).toBeNull()
    expect(sameName('Crony⁠ Electricals', 'crony electricals')).toBe(true)
  })
})
