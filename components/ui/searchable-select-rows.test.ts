import { describe, it, expect } from 'vitest'
import {
  filterOptions, arrangeOptions, startsBand, type SelectOption,
} from './searchable-select-rows'

const o = (id: string, label: string, group?: string, hint?: string): SelectOption =>
  ({ id, label, group, hint })

// A slice of the real item master, which is what sent Aksha this way:
// 659 items in a native <select>, scrolled by thumb.
const ITEMS: SelectOption[] = [
  o('a', '1.5 SQMM COPPER FLEXIBLE WIRES BLACK COLOR (300 MTR) C29', 'Electrical', 'Nos'),
  o('b', '100mm CPVC PIPE (3 MTR Length)', 'Plumbing', 'Nos'),
  o('c', 'Roff Extrofix', 'Civil', 'Bags'),
  o('d', 'Gabion Box 4x1x1', 'Civil', 'Nos'),
  o('e', 'Scaffolding Prop 3.0m', 'Civil', 'Nos'),
]

describe('filterOptions', () => {
  it('finds a word anywhere in the name, whatever the case', () => {
    expect(filterOptions(ITEMS, 'roff').map(r => r.id)).toEqual(['c'])
    expect(filterOptions(ITEMS, 'GABION').map(r => r.id)).toEqual(['d'])
    expect(filterOptions(ITEMS, 'cpvc').map(r => r.id)).toEqual(['b'])
  })

  it('searches the second line too — the unit is how near-identical names differ', () => {
    expect(filterOptions(ITEMS, 'bags').map(r => r.id)).toEqual(['c'])
  })

  it('an empty query is every option, not none', () => {
    expect(filterOptions(ITEMS, '')).toHaveLength(ITEMS.length)
    expect(filterOptions(ITEMS, '   ')).toHaveLength(ITEMS.length)
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterOptions(ITEMS, 'zzz')).toEqual([])
  })
})

describe('arrangeOptions', () => {
  it('keeps the options in order under their own headings when nothing is pinned', () => {
    const rows = arrangeOptions(ITEMS)
    expect(rows.map(r => r.o.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(rows.map(r => r.band)).toEqual(['Electrical', 'Plumbing', 'Civil', 'Civil', 'Civil'])
  })

  it('holds the pinned items at the top, in the order given', () => {
    const rows = arrangeOptions(ITEMS, ['e', 'c'])
    expect(rows.slice(0, 2).map(r => r.o.id)).toEqual(['e', 'c'])
    expect(rows.slice(0, 2).every(r => r.band === 'Used here lately')).toBe(true)
  })

  it('never lists a pinned item twice — one row, one place to tap', () => {
    const rows = arrangeOptions(ITEMS, ['c'])
    expect(rows.filter(r => r.o.id === 'c')).toHaveLength(1)
    expect(rows).toHaveLength(ITEMS.length)
  })

  it('survives a pinned id that is not in the list, and one pinned twice', () => {
    expect(arrangeOptions(ITEMS, ['gone']).map(r => r.o.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(arrangeOptions(ITEMS, ['c', 'c']).filter(r => r.o.id === 'c')).toHaveLength(1)
  })

  it('does not resurrect a pinned row the search has excluded', () => {
    // Recent is a convenience, not an override: searching "roff" must not
    // bring back last week's scaffolding prop.
    const rows = arrangeOptions(filterOptions(ITEMS, 'roff'), ['e', 'c'])
    expect(rows.map(r => r.o.id)).toEqual(['c'])
  })
})

describe('startsBand — where a heading is printed', () => {
  it('prints a heading once per run, not once per row', () => {
    const rows = arrangeOptions(ITEMS)
    expect(rows.map((_, i) => startsBand(rows, i))).toEqual([true, true, true, false, false])
  })

  it('prints nothing for options that carry no group', () => {
    const rows = arrangeOptions([o('x', 'One'), o('y', 'Two')])
    expect(rows.map((_, i) => startsBand(rows, i))).toEqual([false, false])
  })

  it('opens the pinned heading and then the first real group again', () => {
    const rows = arrangeOptions(ITEMS, ['c'])
    // pinned "c" · then a, b, d, e under their own headings
    expect(rows.map(r => r.band)).toEqual([
      'Used here lately', 'Electrical', 'Plumbing', 'Civil', 'Civil',
    ])
    expect(rows.map((_, i) => startsBand(rows, i))).toEqual([true, true, true, true, false])
  })
})
