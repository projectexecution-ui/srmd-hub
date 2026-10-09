import { describe, it, expect } from 'vitest'
import { parseIePosition, donorRows, suggestCover, rowLabel } from './ie-cover'

// The NGH C Electrical case from 9 Oct 2026: the whole Electrical estimate sat
// on 701 (₹2.51 Cr, imported), the request was ₹72,47,618 on 702 with none.
const raw = {
  applies: true, status: 'ph_approved', sub_skill_id: 's702', discipline: '07 Electrical Works',
  ie: '0', ie_set: false, approved: 0, pending: '7247618', ask: 7247618, shortfall: '7247618',
  can_cover: true, cover_block: null,
  rows: [
    { sub_skill_id: 's701', code: '701', name: 'Panels & DBs', ie: '25050000', ie_set: false, approved: 0, pending: 0, spare: '25050000', is_this: false },
    { sub_skill_id: 's702', code: '702', name: 'Electrical Conducting & Wiring Works', ie: 0, ie_set: false, approved: 0, pending: 7247618, spare: -7247618, is_this: true },
    { sub_skill_id: 's703', code: '703', name: 'Lighting', ie: 500000, ie_set: true, approved: 500000, pending: 0, spare: 0, is_this: false },
  ],
  moves: [],
}

describe('parseIePosition', () => {
  it('turns numeric strings into numbers and keeps the flags', () => {
    const p = parseIePosition(raw)!
    expect(p.applies).toBe(true)
    expect(p.shortfall).toBe(7247618)
    expect(p.pending).toBe(7247618)
    expect(p.rows?.[0].spare).toBe(25050000)
    expect(p.rows?.[1].is_this).toBe(true)
    expect(p.can_cover).toBe(true)
  })
  it('reads a sheet the rule does not apply to as not applying', () => {
    expect(parseIePosition({ applies: false })).toEqual({ applies: false })
  })
  it('reads garbage as nothing to show', () => {
    expect(parseIePosition(null)).toBeNull()
    expect(parseIePosition('x')).toBeNull()
  })
})

describe('donorRows', () => {
  it('offers only other sub-categories with spare, most spare first', () => {
    const p = parseIePosition(raw)!
    expect(donorRows(p).map(r => r.code)).toEqual(['701'])
  })
})

describe('suggestCover', () => {
  const p = parseIePosition(raw)!
  it('takes the whole gap from a donor with enough spare', () => {
    expect(suggestCover(7247618, donorRows(p))).toEqual({ takes: { s701: 7247618 }, addNew: 0 })
  })
  it('spreads across donors and adds new only for what they cannot give', () => {
    const donors = [
      { sub_skill_id: 'a', code: '1', name: 'A', ie: 0, ie_set: true, approved: 0, pending: 0, spare: 300, is_this: false },
      { sub_skill_id: 'b', code: '2', name: 'B', ie: 0, ie_set: true, approved: 0, pending: 0, spare: 200, is_this: false },
    ]
    expect(suggestCover(1000, donors)).toEqual({ takes: { a: 300, b: 200 }, addNew: 500 })
  })
  it('adds it all as new when no sub-category has spare', () => {
    expect(suggestCover(4000, [])).toEqual({ takes: {}, addNew: 4000 })
  })
  it('suggests nothing when there is no gap', () => {
    expect(suggestCover(0, donorRows(p))).toEqual({ takes: {}, addNew: 0 })
  })
})

describe('rowLabel', () => {
  it('reads code and name as the identity block does', () => {
    expect(rowLabel({ code: '702', name: 'Electrical Conducting & Wiring Works' })).toBe('702 Electrical Conducting & Wiring Works')
    expect(rowLabel({ code: null, name: null })).toBe('Sub-category')
  })
})
