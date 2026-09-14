import { describe, it, expect } from 'vitest'
import {
  REGISTERS, findRegister, totals, qtyLine, groupRows, groupValue,
  periodLabel, filterNotes, type RegisterRow,
} from './registers'

const row = (o: Partial<RegisterRow> & { itemName: string; qty: number }): RegisterRow => ({
  entryId: 'e1', entryNo: 'In: 01Sep26/001', linkedNo: null, day: '2026-09-01',
  party: 'Balaji', projectName: 'NGH B', entity: 'SRASSK', place: 'CT Warehouse → Stock',
  itemId: 'i1', discipline: 'Civil', unit: 'Nos', rate: 10, amount: o.qty * 10,
  poWoNo: null, remarks: null, ...o,
})

describe('the four registers', () => {
  it('is the map’s four, each one direction and one register', () => {
    expect(REGISTERS.map(r => r.kind)).toEqual(['vendor-in', 'vendor-out', 'srm-in', 'srm-out'])
    expect(findRegister('srm-out')).toMatchObject({ direction: 'out', register: 'srm' })
    expect(findRegister('vendor-in')).toMatchObject({ direction: 'in', register: 'vendor' })
  })

  it('does not invent a register the map never asked for', () => {
    expect(findRegister('transfer-in')).toBeUndefined()
  })
})

describe('totals', () => {
  it('counts entries once however many lines they carry', () => {
    const t = totals([
      row({ itemName: 'A', qty: 10, entryId: 'e1' }),
      row({ itemName: 'B', qty: 5, entryId: 'e1' }),
      row({ itemName: 'C', qty: 2, entryId: 'e2' }),
    ])
    expect(t.entries).toBe(2)
    expect(t.lines).toBe(3)
  })

  it('NEVER adds bags to tonnes — quantities total within a unit', () => {
    const t = totals([
      row({ itemName: 'Cement', qty: 40, unit: 'Bags' }),
      row({ itemName: 'Steel', qty: 2.5, unit: 'MT' }),
      row({ itemName: 'More cement', qty: 60, unit: 'Bags' }),
    ])
    expect(t.qtyByUnit).toEqual({ Bags: 100, MT: 2.5 })
    expect(qtyLine(t)).toBe('Bags 100 · MT 2.5')
  })

  it('says the money is understated when a line has no rate', () => {
    const t = totals([
      row({ itemName: 'Priced', qty: 10, rate: 100, amount: 1000 }),
      row({ itemName: 'Unpriced', qty: 5, rate: null, amount: null }),
    ])
    expect(t.amount).toBe(1000)
    expect(t.amountPartial).toBe(true)
  })

  it('does not flag a partial total when every line is priced', () => {
    expect(totals([row({ itemName: 'A', qty: 1 })]).amountPartial).toBe(false)
  })

  it('is empty-safe', () => {
    const t = totals([])
    expect(t).toMatchObject({ entries: 0, lines: 0, amount: 0, amountPartial: false })
    expect(qtyLine(t)).toBe('')
  })
})

describe('grouping', () => {
  const rows = [
    row({ itemName: 'A', qty: 1, projectName: 'NGH B', party: 'Balaji', day: '2026-09-01' }),
    row({ itemName: 'B', qty: 2, projectName: 'NGH A', party: 'Patel', day: '2026-09-03' }),
    row({ itemName: 'C', qty: 3, projectName: 'NGH B', party: 'Patel', day: '2026-09-02' }),
  ]

  it('groups by project, alphabetically', () => {
    expect(groupRows(rows, 'project').map(g => g.label)).toEqual(['NGH A', 'NGH B'])
  })

  it('groups by day NEWEST first — a register is read from the top', () => {
    expect(groupRows(rows, 'day').map(g => g.label)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01'])
  })

  it('gives every group its own total', () => {
    const g = groupRows(rows, 'project').find(x => x.label === 'NGH B')!
    expect(g.rows).toHaveLength(2)
    expect(g.totals.qtyByUnit.Nos).toBe(4)
  })

  it('says "No project" rather than leaving a blank heading', () => {
    expect(groupValue(row({ itemName: 'X', qty: 1, projectName: null }), 'project')).toBe('No project')
    expect(groupValue(row({ itemName: 'X', qty: 1, party: null }), 'party')).toBe('No party')
    expect(groupValue(row({ itemName: 'X', qty: 1, discipline: null }), 'discipline')).toBe('No discipline')
  })

  it('loses no row to grouping, whichever grouping is used', () => {
    for (const by of ['project', 'party', 'discipline', 'day'] as const) {
      const total = groupRows(rows, by).reduce((n, g) => n + g.rows.length, 0)
      expect(total).toBe(rows.length)
    }
  })
})

describe('what the printed page says it is', () => {
  it('spells the period in words', () => {
    expect(periodLabel({ from: '2026-08-01', to: '2026-08-31' })).toBe('1 Aug 2026 → 31 Aug 2026')
    expect(periodLabel({ from: '2026-08-01' })).toBe('From 1 Aug 2026')
    expect(periodLabel({ to: '2026-08-31' })).toBe('Up to 31 Aug 2026')
  })

  it('never leaves the period blank — an undated register is worthless', () => {
    expect(periodLabel({})).toBe('Everything on record')
  })

  it('prints the filters that were in force', () => {
    expect(filterNotes({ party: 'Balaji' }, { project: 'NGH B', discipline: 'Civil' }))
      .toEqual(['Party: Balaji', 'Project: NGH B', 'Discipline: Civil'])
  })

  it('says nothing when nothing was filtered', () => {
    expect(filterNotes({}, {})).toEqual([])
  })
})
