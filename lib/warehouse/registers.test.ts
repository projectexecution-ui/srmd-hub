import { describe, expect, it } from 'vitest'
import { registerTotals, groupRows, inPeriod, vendorBalance } from './registers'
import type { RegisterRow } from './registers'

const row = (over: Partial<RegisterRow> & { itemName: string }): RegisterRow => ({
  entryId: 'e1', entryNo: 'In: 10Aug26/001', day: '2026-08-10',
  party: 'Ultratech Cement', projectName: 'NGH A', entity: 'SRASSK',
  storeName: 'NGH Open Area', itemId: over.itemName, unit: 'Bag',
  discipline: 'Civil', category: null, qty: 100, rate: 392, amount: 39200,
  ...over,
})

describe('registerTotals', () => {
  it('counts entries, not lines — one challan with four items is one entry', () => {
    const t = registerTotals([
      row({ itemName: 'cement', entryId: 'e1' }),
      row({ itemName: 'tape', entryId: 'e1' }),
      row({ itemName: 'steel', entryId: 'e2' }),
    ])
    expect(t.entries).toBe(2)
    expect(t.lines).toBe(3)
  })

  it('never adds bags to tonnes — quantity totals are per unit', () => {
    const t = registerTotals([
      row({ itemName: 'cement', unit: 'Bag', qty: 500 }),
      row({ itemName: 'sand', unit: 'Bag', qty: 120 }),
      row({ itemName: 'steel', unit: 'MT', qty: 4.5 }),
    ])
    expect(t.qtyByUnit).toEqual({ Bag: 620, MT: 4.5 })
  })

  it('adds the amounts and says so when a line has no rate', () => {
    const t = registerTotals([
      row({ itemName: 'cement', amount: 39200 }),
      row({ itemName: 'tape', rate: null, amount: null }),
    ])
    expect(t.amount).toBe(39200)
    expect(t.amountPartial).toBe(true)
  })

  it('carries shortage and damage through from the gate', () => {
    const t = registerTotals([
      row({ itemName: 'cement', shortQty: 10, damagedQty: 2 }),
      row({ itemName: 'sand', shortQty: 0, damagedQty: 5 }),
    ])
    expect(t).toMatchObject({ shortQty: 10, damagedQty: 7 })
  })

  it('is empty, not broken, with no rows', () => {
    expect(registerTotals([])).toMatchObject({ entries: 0, lines: 0, amount: 0, amountPartial: false })
  })
})

describe('groupRows', () => {
  const rows = [
    row({ itemName: 'cement', discipline: 'Civil', amount: 39200, day: '2026-08-10' }),
    row({ itemName: 'wire', discipline: 'Electrical', amount: 5000, day: '2026-08-12' }),
    row({ itemName: 'steel', discipline: 'Civil', amount: 355500, day: '2026-08-11' }),
  ]

  it('puts the biggest group first — a register is read to find where the money went', () => {
    const g = groupRows(rows, 'category')
    expect(g.map(x => x.label)).toEqual(['Civil', 'Electrical'])
    expect(g[0].totals.amount).toBe(39200 + 355500)
  })

  it('sorts inside a group newest first', () => {
    const g = groupRows(rows, 'category')
    expect(g[0].rows.map(r => r.day)).toEqual(['2026-08-11', '2026-08-10'])
  })

  it('names an empty grouping value instead of showing a blank heading', () => {
    const g = groupRows([row({ itemName: 'x', projectName: null })], 'project')
    expect(g[0].label).toBe('— no project —')
  })

  it('still returns one flat group when grouping is off', () => {
    const g = groupRows(rows, 'none')
    expect(g).toHaveLength(1)
    expect(g[0].rows).toHaveLength(3)
    expect(g[0].totals.entries).toBe(1)
  })

  it('does not mutate the rows it was given', () => {
    const original = [...rows]
    groupRows(rows, 'category')
    expect(rows).toEqual(original)
  })
})

describe('inPeriod', () => {
  it('includes both ends — "1 to 31 August" means both days', () => {
    expect(inPeriod('2026-08-01', '2026-08-01', '2026-08-31')).toBe(true)
    expect(inPeriod('2026-08-31', '2026-08-01', '2026-08-31')).toBe(true)
    expect(inPeriod('2026-07-31', '2026-08-01', '2026-08-31')).toBe(false)
    expect(inPeriod('2026-09-01', '2026-08-01', '2026-08-31')).toBe(false)
  })
  it('treats a missing end as open', () => {
    expect(inPeriod('2020-01-01', null, '2026-08-31')).toBe(true)
    expect(inPeriod('2030-01-01', '2026-08-01', null)).toBe(true)
    expect(inPeriod('2026-08-15', null, null)).toBe(true)
  })
})

describe('vendorBalance', () => {
  const ins = [
    { party: 'Shah Scaffolding', itemId: 'plate', itemName: 'Shuttering Plate', unit: 'Nos', qty: 400 },
    { party: 'Shah Scaffolding', itemId: 'plate', itemName: 'Shuttering Plate', unit: 'Nos', qty: 200 },
    { party: 'Shah Scaffolding', itemId: 'prop', itemName: 'Adjustable Prop', unit: 'Nos', qty: 150 },
    { party: 'Mehta Forms', itemId: 'plate', itemName: 'Shuttering Plate', unit: 'Nos', qty: 100 },
  ]

  it('adds up several deliveries of the same item from the same vendor', () => {
    const b = vendorBalance(ins, [])
    const plate = b.find(r => r.party === 'Shah Scaffolding' && r.itemId === 'plate')!
    expect(plate.broughtIn).toBe(600)
    expect(plate.stillHere).toBe(600)
  })

  it('keeps two vendors\' identical items apart', () => {
    const b = vendorBalance(ins, [])
    expect(b.filter(r => r.itemId === 'plate').map(r => r.party)).toEqual(['Mehta Forms', 'Shah Scaffolding'])
  })

  it('subtracts what went back', () => {
    const b = vendorBalance(ins, [
      { party: 'Shah Scaffolding', itemId: 'plate', itemName: 'Shuttering Plate', unit: 'Nos', qty: 450 },
    ])
    const plate = b.find(r => r.party === 'Shah Scaffolding' && r.itemId === 'plate')!
    expect(plate).toMatchObject({ broughtIn: 600, takenBack: 450, stillHere: 150, overTaken: false })
  })

  it('flags a vendor taking back more than he ever brought', () => {
    const b = vendorBalance(ins, [
      { party: 'Mehta Forms', itemId: 'plate', itemName: 'Shuttering Plate', unit: 'Nos', qty: 130 },
    ])
    const plate = b.find(r => r.party === 'Mehta Forms')!
    expect(plate).toMatchObject({ takenBack: 130, stillHere: -30, overTaken: true })
  })

  it('matches the name case-insensitively and ignoring stray spaces', () => {
    const b = vendorBalance(
      [{ party: 'Shah Scaffolding', itemId: 'p', itemName: 'Plate', unit: 'Nos', qty: 100 }],
      [{ party: '  shah scaffolding ', itemId: 'p', itemName: 'Plate', unit: 'Nos', qty: 40 }],
    )
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ broughtIn: 100, takenBack: 40, stillHere: 60 })
  })

  it('shows a return with no matching IN rather than dropping it', () => {
    const b = vendorBalance([], [
      { party: 'Ghost Traders', itemId: 'p', itemName: 'Plate', unit: 'Nos', qty: 25 },
    ])
    expect(b[0]).toMatchObject({ broughtIn: 0, takenBack: 25, stillHere: -25, overTaken: true })
  })

  it('names an unnamed party instead of grouping everything under a blank', () => {
    const b = vendorBalance([{ party: null, itemId: 'p', itemName: 'Plate', unit: 'Nos', qty: 5 }], [])
    expect(b[0].party).toBe('— not named —')
  })
})
