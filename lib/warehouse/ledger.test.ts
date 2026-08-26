import { describe, expect, it } from 'vitest'
import {
  stockEffect, foldLedger, stockFlag, groupByLocation, stockTotals,
} from './ledger'
import type { LedgerRow, MovementKind, StockLine } from './ledger'

const mv = (kind: MovementKind, qty: number, day = '2026-08-10', loc = 'L1', item = 'cement'): LedgerRow =>
  ({ itemId: item, locationId: loc, kind, qty, day, rate: null })

describe('stockEffect', () => {
  it('adds what arrives and takes away what leaves', () => {
    expect(stockEffect('in', 500)).toBe(500)
    expect(stockEffect('move_in', 100)).toBe(100)
    expect(stockEffect('return', 20)).toBe(20)
    expect(stockEffect('issue', 180)).toBe(-180)
    expect(stockEffect('move_out', 100)).toBe(-100)
    expect(stockEffect('vendor_out', 30)).toBe(-30)
  })

  it('keeps damaged material OUT of good stock — that is why it is booked apart', () => {
    expect(stockEffect('damage', 12)).toBe(0)
  })

  it('lets a count correction carry its own sign', () => {
    expect(stockEffect('adjust', -29)).toBe(-29)
    expect(stockEffect('adjust', 20)).toBe(20)
  })
})

describe('foldLedger', () => {
  it('reproduces the register line: in 500, out 180, transfer +100, in hand 420', () => {
    const [c] = foldLedger([
      mv('in', 500), mv('issue', 180), mv('move_in', 100),
    ])
    expect(c).toMatchObject({ inQty: 500, outQty: 180, transferQty: 100, inHand: 420 })
  })

  it('signs a transfer by direction, so the store that gave it away shows negative', () => {
    const [c] = foldLedger([mv('in', 6), mv('issue', 1.8), mv('move_out', 1.5)])
    expect(c.transferQty).toBe(-1.5)
    expect(c.inHand).toBeCloseTo(2.7, 10)
  })

  it('ignores anything dated after the as-on date', () => {
    const rows = [
      mv('in', 500, '2026-08-01'),
      mv('issue', 180, '2026-08-05'),
      mv('in', 250, '2026-08-20'),      // after
    ]
    expect(foldLedger(rows, '2026-08-10')[0]).toMatchObject({ inQty: 500, outQty: 180, inHand: 320 })
    expect(foldLedger(rows)[0]).toMatchObject({ inQty: 750, inHand: 570 })
  })

  it('includes the as-on date itself — a truck that day is in', () => {
    expect(foldLedger([mv('in', 10, '2026-08-10')], '2026-08-10')[0].inHand).toBe(10)
  })

  it('keeps a vendor return out of site consumption', () => {
    const [c] = foldLedger([mv('in', 100), mv('issue', 30), mv('vendor_out', 40)])
    expect(c.outQty).toBe(30)          // what sites consumed
    expect(c.vendorOutQty).toBe(40)    // what went home
    expect(c.inHand).toBe(30)          // both left the store
  })

  it('tracks damage without letting it touch in-hand', () => {
    const [c] = foldLedger([mv('in', 88), mv('damage', 12)])
    expect(c).toMatchObject({ inQty: 88, damagedQty: 12, inHand: 88 })
  })

  it('separates every item and every store', () => {
    const cells = foldLedger([
      mv('in', 10, '2026-08-01', 'L1', 'cement'),
      mv('in', 20, '2026-08-01', 'L2', 'cement'),
      mv('in', 30, '2026-08-01', 'L1', 'tape'),
    ])
    expect(cells).toHaveLength(3)
    expect(cells.find(c => c.locationId === 'L2' && c.itemId === 'cement')!.inHand).toBe(20)
  })

  it('nets count corrections in both directions', () => {
    const [c] = foldLedger([mv('in', 320), mv('adjust', -29), mv('adjust', 4)])
    expect(c.adjustQty).toBe(-25)
    expect(c.inHand).toBe(295)
  })

  it('returns nothing for an empty ledger rather than a phantom zero row', () => {
    expect(foldLedger([])).toEqual([])
  })
})

describe('stockFlag', () => {
  it('calls an empty shelf nil, not low — it is a different problem', () => {
    expect(stockFlag(0, 50)).toBe('nil')
    expect(stockFlag(-3, 50)).toBe('nil')     // should not happen, but reads as nil
  })
  it('flags low only when a minimum has actually been set', () => {
    expect(stockFlag(40, 50)).toBe('low')
    expect(stockFlag(50, 50)).toBe('low')     // at the minimum counts as low
    expect(stockFlag(51, 50)).toBeNull()
    expect(stockFlag(1, null)).toBeNull()
    expect(stockFlag(1, 0)).toBeNull()        // a zero minimum is "not set"
  })
})

const line = (over: Partial<StockLine> & { itemId: string; locationId: string }): StockLine => ({
  itemName: over.itemId, unit: 'Bag', category: null, discipline: null,
  locationName: over.locationId, siteName: 'NGH',
  inQty: 0, outQty: 0, transferQty: 0, openingQty: 0, adjustQty: 0, voidQty: 0, damagedQty: 0, vendorOutQty: 0,
  inHand: 0, minQty: null, rate: null, value: 0, flag: null,
  ...over,
})

describe('groupByLocation', () => {
  it('groups store by store with a value subtotal, sites in order', () => {
    const groups = groupByLocation([
      line({ itemId: 'tape', locationId: 'C1', locationName: 'Container 1', siteName: 'CT', value: 100 }),
      line({ itemId: 'cement', locationId: 'A1', locationName: 'Open Area', siteName: 'NGH', value: 500 }),
      line({ itemId: 'bricks', locationId: 'A1', locationName: 'Open Area', siteName: 'NGH', value: 250 }),
    ])
    expect(groups.map(g => g.siteName)).toEqual(['CT', 'NGH'])
    const ngh = groups.find(g => g.locationId === 'A1')!
    expect(ngh.value).toBe(750)
    expect(ngh.lines.map(l => l.itemName)).toEqual(['bricks', 'cement'])
  })
})

describe('stockTotals', () => {
  const lines = [
    line({ itemId: 'cement', locationId: 'A1', inHand: 420, rate: 392, value: 420 * 392 }),
    line({ itemId: 'cement', locationId: 'C1', inHand: 80, rate: 392, value: 80 * 392 }),
    line({ itemId: 'curing', locationId: 'A1', inHand: 0, minQty: 5, rate: 300, value: 0, flag: 'nil' }),
    line({ itemId: 'tape', locationId: 'A1', inHand: 4, minQty: 10, rate: 12, value: 48, flag: 'low' }),
  ]

  it('counts an item held in two stores once, and ignores one held nowhere', () => {
    // cement (in A1 and C1) + tape = 2. Curing is nil, so it is not "an item in
    // stock" — otherwise the headline count would never come down.
    expect(stockTotals(lines).items).toBe(2)
  })

  it('adds the book value and counts the warnings', () => {
    const t = stockTotals(lines)
    expect(t.value).toBe(420 * 392 + 80 * 392 + 48)
    expect(t).toMatchObject({ locations: 2, low: 1, nil: 1 })
  })

  it('reports the shortage approved counts found, as a positive figure', () => {
    const t = stockTotals([
      line({ itemId: 'cement', locationId: 'A1', inHand: 291, adjustQty: -29, rate: 392, value: 291 * 392 }),
      line({ itemId: 'bricks', locationId: 'A1', inHand: 120, adjustQty: 20, rate: 9, value: 120 * 9 }),
    ])
    expect(t.countShortQty).toBe(29)
    expect(t.countShortValue).toBe(29 * 392)   // the excess is not netted off
  })

  it('says so when the value understates because an item has no rate', () => {
    expect(stockTotals([line({ itemId: 'x', locationId: 'A1', inHand: 5 })]).valuePartial).toBe(true)
    // a nil line with no rate does not make the total wrong
    expect(stockTotals([line({ itemId: 'x', locationId: 'A1', inHand: 0 })]).valuePartial).toBe(false)
  })
})

describe('the V1 carry-over is not a count correction', () => {
  const row = (over: Partial<LedgerRow>): LedgerRow => ({
    itemId: 'i1', locationId: 'L1', kind: 'adjust', qty: 18, day: '2026-08-15',
    rate: null, ...over,
  })

  it('opening stock lands in openingQty, leaving count corrections empty', () => {
    const [c] = foldLedger([row({ opening: true })])
    expect(c.openingQty).toBe(18)
    expect(c.adjustQty).toBe(0)
    expect(c.inHand).toBe(18)   // it is still real stock
  })

  it('a genuine count correction still lands in adjustQty', () => {
    const [c] = foldLedger([row({ qty: -3 })])
    expect(c.openingQty).toBe(0)
    expect(c.adjustQty).toBe(-3)
  })

  it('the two add up side by side without double counting', () => {
    const [c] = foldLedger([row({ opening: true }), row({ qty: -3 })])
    expect(c.openingQty).toBe(18)
    expect(c.adjustQty).toBe(-3)
    expect(c.inHand).toBe(15)
  })

  it('count shortage no longer includes the carry-over', () => {
    const t = stockTotals([line({ itemId: 'i1', locationId: 'L1', openingQty: 18, inHand: 18, rate: 10 })])
    expect(t.countShortQty).toBe(0)
    expect(t.countShortValue).toBe(0)
  })
})
