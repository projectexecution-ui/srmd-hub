import { describe, it, expect } from 'vitest'
import {
  FIGURE_NAMES, parseViewMode, cardMatches, anyFlags, jumpChips, countFlags, phoneLines, usedNote,
} from './phone-view'

describe('one name per number', () => {
  it('no two figures share a name, and none of the old aliases survive', () => {
    const names = Object.values(FIGURE_NAMES)
    expect(new Set(names).size).toBe(names.length)
    // The three names the ERP budget used to carry on one screen.
    for (const stale of ['ERP', 'ERP Budget', 'Approved Budget (ERP)', 'Est', 'Estimate', 'Committed (WO/PO)']) {
      expect(names).not.toContain(stale)
    }
  })
})

describe('phoneLines — every card has the same lines', () => {
  const full = { estimate: 2311645, awaiting: 178149, ctHub: 0, erp: 2311645, wo: 2366247, paid: 521526, showErp: true }
  const bare = { estimate: 6355388, awaiting: 0, ctHub: 0, erp: 6355388, wo: 1099126, paid: 574817, showErp: true }

  it('returns six lines with ERP on, in the desktop column order, whatever the values', () => {
    const a = phoneLines(full).map(l => l.key)
    const b = phoneLines(bare).map(l => l.key)
    expect(a).toEqual(['estimate', 'awaiting', 'ctHub', 'erp', 'wo', 'paid'])
    expect(b).toEqual(a)
  })
  it('a zero is a line that prints "—", not a missing line', () => {
    const lines = phoneLines(bare)
    expect(lines.find(l => l.key === 'awaiting')?.amount).toBeNull()
    expect(lines.find(l => l.key === 'ctHub')?.amount).toBeNull()
  })
  it('three lines when the ERP columns are switched off', () => {
    expect(phoneLines({ ...full, showErp: false }).map(l => l.key)).toEqual(['estimate', 'awaiting', 'ctHub'])
  })
  it('labels come from FIGURE_NAMES', () => {
    for (const l of phoneLines(full)) expect(l.label).toBe(FIGURE_NAMES[l.key])
  })
  it('Paid carries the desktop formula as a note; nothing to divide by means no note', () => {
    expect(phoneLines(full).find(l => l.key === 'paid')?.note).toBe('23 % used')
    expect(usedNote(100, 0)).toBeUndefined()
  })
})

describe('jump chips', () => {
  it('cardMatches — All takes everything, the rest take their one fact', () => {
    const f = { awaiting: true, over: false, closed: false }
    expect(cardMatches('all', f)).toBe(true)
    expect(cardMatches('awaiting', f)).toBe(true)
    expect(cardMatches('over', f)).toBe(false)
    expect(cardMatches('closed', f)).toBe(false)
  })
  it('a category matches when any card does', () => {
    expect(anyFlags([
      { awaiting: false, over: false, closed: true },
      { awaiting: true, over: false, closed: false },
    ])).toEqual({ awaiting: true, over: false, closed: true })
    expect(anyFlags([])).toEqual({ awaiting: false, over: false, closed: false })
  })
  it('SRAH today: 6 lines awaiting, 1 over, none closed → All, Awaiting, Over budget; no Closed chip', () => {
    const chips = jumpChips({ all: 23, awaiting: 6, over: 1, closed: 0 })
    expect(chips.map(c => `${c.label} ${c.count}`)).toEqual(['All 23', 'Awaiting 6', 'Over budget 1'])
  })
  it('countFlags feeds jumpChips', () => {
    const c = countFlags([
      { awaiting: true, over: true, closed: false },
      { awaiting: false, over: false, closed: false },
    ])
    expect(c).toEqual({ all: 2, awaiting: 1, over: 1, closed: 0 })
  })
})

describe('parseViewMode', () => {
  it('only "table" means table; garbage and nothing mean cards', () => {
    expect(parseViewMode('table')).toBe('table')
    expect(parseViewMode('cards')).toBe('cards')
    expect(parseViewMode(null)).toBe('cards')
    expect(parseViewMode('TABLE')).toBe('cards')
  })
})
