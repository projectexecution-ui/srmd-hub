import { describe, it, expect } from 'vitest'
import { buildCategoryTree, consultantSkillNames, oneLine, splitParties, flagParties, matchesQuery, looksLikeGstin, looksLikePan, type Party, lastOrderLinks } from './masters-in4'

const SKILLS = [
  { id: -1, name: 'Sub Project Milestone', parent_id: 0 },
  { id: 1, name: '03 Civil', parent_id: 0, code: '03', is_active: true },
  { id: 41, name: 'Site Pre-lims', parent_id: 0, is_active: true },
  { id: 43, name: '01 Soil Investigation', parent_id: 41, code: '01', is_active: true },
  { id: 47, name: '04 Site Prelims Electrical Works(old)', parent_id: 41, code: '04', is_active: false },
  { id: 370, name: '18 Consultants Cost', parent_id: 0, code: '18', is_active: true },
  { id: 372, name: '1801 Consultant Fees', parent_id: 370, code: '1801', is_active: true },
]

const party = (o: Partial<Party> & { id: number; name: string }): Party => ({
  kind: 'contractor', code: null, pan: null, gstin: null, address: null, city: null, state: null, pin: null,
  phone: null, email: null, contactPerson: null, isActive: true, skills: [], duplicateOf: [], gstinLooksWrong: false, panLooksWrong: false, ...o,
})

describe('consultantSkillNames — IN4 has no consultant master, only a category', () => {
  it('takes the "consultant" main category and everything under it', () => {
    expect([...consultantSkillNames(SKILLS)].sort()).toEqual(['18 Consultants Cost', '1801 Consultant Fees'])
  })
})

describe('splitParties — the map’s three lists from IN4’s two', () => {
  const parties = [
    party({ id: 6, name: 'ACCUTAPE ENGINEERS', skills: ['Site Survey Works(old)', '1801 Consultant Fees'] }),
    party({ id: 423, name: 'SONAL CERAMICS', skills: ['03 Civil'] }),
    party({ id: 68, name: 'NATUROPROTECT', kind: 'supplier' }),
  ]
  const out = splitParties(parties, consultantSkillNames(SKILLS))
  it('puts a contractor with a consultant skill under Consultants only', () => {
    expect(out.consultants.map(p => p.name)).toEqual(['ACCUTAPE ENGINEERS'])
    expect(out.contractors.map(p => p.name)).toEqual(['SONAL CERAMICS'])
  })
  it('vendors are the suppliers', () => {
    expect(out.vendors.map(p => p.name)).toEqual(['NATUROPROTECT'])
  })
})

describe('flagParties — the scattering IN4 itself carries', () => {
  const out = flagParties([
    { kind: 'contractor', id: 223, name: 'JANAK BHAVSAR', gstin: '24AAEFN0301R1ZE', pan: 'AAEFN0301R' },
    { kind: 'contractor', id: 225, name: 'Janak  Bhavsar', gstin: null, pan: 'AKXPM9594' },
    { kind: 'supplier', id: 9, name: 'JANAK BHAVSAR', gstin: 'GST-PENDING', pan: null },
  ])
  it('finds the same name twice within one kind, but not across kinds', () => {
    expect(out[0].duplicateOf).toEqual([225])
    expect(out[1].duplicateOf).toEqual([223])
    expect(out[2].duplicateOf).toEqual([])
  })
  it('flags a GSTIN or PAN of the wrong shape, never an absent one', () => {
    expect(out[0]).toMatchObject({ gstinLooksWrong: false, panLooksWrong: false })
    expect(out[1]).toMatchObject({ gstinLooksWrong: false, panLooksWrong: true })
    expect(out[2]).toMatchObject({ gstinLooksWrong: true, panLooksWrong: false })
    expect(looksLikeGstin('27AAMFS8877P1ZU')).toBe(true)
    expect(looksLikePan('AABTS2637Q')).toBe(true)
    expect(looksLikePan('NA')).toBe(false)
  })
})

describe('matchesQuery', () => {
  it('is a case-insensitive contains over any field, and false for an empty query', () => {
    expect(matchesQuery('pidi', 'Pidilite - Roff (T02) Grey')).toBe(true)
    expect(matchesQuery('ngh', 'New Guest House', 'NGH')).toBe(true)
    expect(matchesQuery('', 'anything')).toBe(false)
    expect(matchesQuery('x', null, undefined)).toBe(false)
  })
})

describe('buildCategoryTree', () => {
  const tree = buildCategoryTree(SKILLS, new Map([[1, 500], [41, 12]]), new Map([[43, 7]]))
  it('is two levels, ordered by IN4’s numeric code, without the -1 pseudo-skill', () => {
    expect(tree.map(c => c.name)).toEqual(['03 Civil', '18 Consultants Cost', 'Site Pre-lims'])
    expect(tree.find(c => c.id === 41)!.subs.map(x => x.name)).toEqual(['01 Soil Investigation', '04 Site Prelims Electrical Works(old)'])
  })
  it('carries work-order counts and the inactive flag', () => {
    expect(tree[0].workOrders).toBe(500)
    const pre = tree.find(c => c.id === 41)!
    expect(pre.subs[0].workOrders).toBe(7)
    expect(pre.subs[1].isActive).toBe(false)
  })
})

describe('oneLine — IN4 addresses as one tidy line', () => {
  it('joins line breaks with commas and drops doubled commas and a trailing one', () => {
    expect(oneLine('DN Annexe \r\nShrimad Rajchandra Ashram\r\nMohangadh\r\nDharampur')).toBe('DN Annexe, Shrimad Rajchandra Ashram, Mohangadh, Dharampur')
    expect(oneLine('Opp Asura Post Office, Near Kataria Showroom, Asura, Dharampur,')).toBe('Opp Asura Post Office, Near Kataria Showroom, Asura, Dharampur')
    expect(oneLine('Shrimad Rajchandra Educational Trust, Asura, Dharampur,, Valsad.')).toBe('Shrimad Rajchandra Educational Trust, Asura, Dharampur, Valsad.')
  })
  it('is null for nothing', () => {
    expect(oneLine('')).toBeNull()
    expect(oneLine(null)).toBeNull()
  })
})

describe('the last order behind a master row (Aksha, 10 Sep 2026)', () => {
  it('a WO offers its print and the project tab; a PO adds the ledger; nothing when unlinked', () => {
    const wo = { kind: 'wo' as const, id: 1842, ref: 'WO/SRJT/SRAH/2026-27/4', date: null, party: 'SANDEEP KUMAR', rate: 145, qty: 650, project: 'SRAH', subprojectId: 31, hubProjectId: 'abc' }
    expect(lastOrderLinks(wo).map(l => [l.label, l.href])).toEqual([['WO SRAH/2026-27/4', '/api/in4/work-order/1842/print'], ['In project', '/project/abc/wo-po?q=WO%2FSRJT%2FSRAH%2F2026-27%2F4']])
    const po = { ...wo, kind: 'po' as const, id: 1164, ref: 'PO/SRASSK/NGH/2025-26/92', hubProjectId: null }
    expect(lastOrderLinks(po).map(l => l.label)).toEqual(['PO NGH/2025-26/92', 'Ledger'])
    expect(lastOrderLinks(null)).toEqual([])
  })
})
