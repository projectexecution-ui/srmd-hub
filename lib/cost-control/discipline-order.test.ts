import { describe, it, expect } from 'vitest'
import {
  disciplineCodeNumber,
  disciplineRank,
  compareDisciplines,
  sortDisciplines,
} from './discipline-order'

// The real SRAH project set: 01–20 carry an explicit display_order that mirrors
// their code, while 53 and 54 were added without one and defaulted to 0.
const SRAH = [
  { code: '53', name: "OT'S",                 display_order: 0 },
  { code: '54', name: 'Specialized Flooring', display_order: 0 },
  { code: '01', name: 'Site Pre-lims',        display_order: 1 },
  { code: '02', name: 'Earthworks - Building', display_order: 2 },
  { code: '03', name: 'Civil',                display_order: 3 },
  { code: '20', name: 'Extra Works',          display_order: 20 },
]

describe('disciplineCodeNumber', () => {
  it('reads the leading digits of a code', () => {
    expect(disciplineCodeNumber('03')).toBe(3)
    expect(disciplineCodeNumber('53')).toBe(53)
    expect(disciplineCodeNumber('001')).toBe(1)
  })

  it('tolerates the suffixed codes that exist in the master list', () => {
    expect(disciplineCodeNumber('02E')).toBe(2)   // 'xtra Works'
    expect(disciplineCodeNumber('01.')).toBe(1)   // 'Pre Design Works'
  })

  it('sends a code with no leading digit to the end, never the top', () => {
    expect(disciplineCodeNumber('MISC')).toBe(Number.POSITIVE_INFINITY)
    expect(disciplineCodeNumber(null)).toBe(Number.POSITIVE_INFINITY)
    expect(disciplineCodeNumber('')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('disciplineRank', () => {
  it('honours an explicit display_order', () => {
    expect(disciplineRank({ code: '99', display_order: 4 })).toBe(4)
  })

  it('treats 0 and null as unset and falls back to the code number', () => {
    // 0 is the column default and what the admin form writes for a blank box,
    // so it must NOT be read as "put me first".
    expect(disciplineRank({ code: '53', display_order: 0 })).toBe(53)
    expect(disciplineRank({ code: '53', display_order: null })).toBe(53)
  })
})

describe('sortDisciplines', () => {
  it('puts the numbered list first and the unset ones after it', () => {
    expect(sortDisciplines(SRAH).map(d => d.code))
      .toEqual(['01', '02', '03', '20', '53', '54'])
  })

  it('no longer floats an order-0 discipline above Site Pre-lims', () => {
    // The bug: a bare `a.display_order - b.display_order` ranked both 0s first.
    const bare = [...SRAH].sort((a, b) => a.display_order - b.display_order)
    expect(bare[0].code).toBe('53')
    expect(sortDisciplines(SRAH)[0].code).toBe('01')
  })

  it('breaks a display_order tie deterministically', () => {
    // Two unset disciplines whose code numbers also collide must still have one
    // fixed order, or the table reshuffles itself between page loads.
    const tied = [
      { code: '07B', display_order: 0 },
      { code: '07A', display_order: 0 },
    ]
    expect(sortDisciplines(tied).map(d => d.code)).toEqual(['07A', '07B'])
    expect(sortDisciplines([...tied].reverse()).map(d => d.code)).toEqual(['07A', '07B'])
  })

  it('keeps a deliberate re-order by display_order', () => {
    // An admin setting 1 on the '12' discipline means it belongs first.
    const rows = [
      { code: '03', display_order: 3 },
      { code: '12', display_order: 1 },
    ]
    expect(sortDisciplines(rows).map(d => d.code)).toEqual(['12', '03'])
  })

  it('does not mutate its input', () => {
    const rows = [...SRAH]
    sortDisciplines(rows)
    expect(rows.map(d => d.code)).toEqual(SRAH.map(d => d.code))
  })

  it('compareDisciplines is symmetric', () => {
    const a = { code: '53', display_order: 0 }
    const b = { code: '01', display_order: 1 }
    expect(Math.sign(compareDisciplines(a, b))).toBe(-Math.sign(compareDisciplines(b, a)))
  })
})
