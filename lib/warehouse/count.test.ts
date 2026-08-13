import { describe, expect, it } from 'vitest'
import {
  buildSheet, summarize, submitBlocker, adjustments, hasDiff, needsReason, isReached, SPOT_TOP_N,
} from './count'
import type { CountLine, SheetSource } from './count'

const src = (itemName: string, qty: number, rate: number | null = null): SheetSource =>
  ({ itemId: itemName, itemName, unit: 'Bag', qty, rate })

const line = (over: Partial<CountLine> & { itemId: string }): CountLine => ({
  id: over.itemId, itemName: over.itemId, unit: 'Bag', seq: 0,
  bookQty: 0, countedQty: null, skipped: false, skipReason: null,
  reason: null, remark: null, rate: null,
  ...over,
})

describe('buildSheet', () => {
  const rows = [
    src('OPC 53 Cement', 320, 392),
    src('TMT Bar 8mm', 1.5, 68000),
    src('Teplon Tape', 40, 12),
    src('Angle Cock', 0, 850),          // book says nil
  ]

  it('a store count walks only what the book says is there', () => {
    expect(buildSheet(rows, 'location').map(r => r.itemName))
      .toEqual(['OPC 53 Cement', 'Teplon Tape', 'TMT Bar 8mm'])
  })

  it('a full count includes the nil lines — that is the missed IN entry it catches', () => {
    expect(buildSheet(rows, 'full').map(r => r.itemName)).toContain('Angle Cock')
  })

  it('a spot check takes the biggest by VALUE, not by quantity', () => {
    // 1.5 MT of TMT (₹1.02L) beats 40 rolls of tape (₹480), though tape has the
    // bigger number on it.
    const top2 = buildSheet(rows, 'spot_top').slice(0, 4).map(r => r.itemName)
    expect(top2).toContain('TMT Bar 8mm')
    expect(top2).toContain('OPC 53 Cement')
  })

  it(`a spot check never walks more than ${SPOT_TOP_N} items`, () => {
    const many = Array.from({ length: 60 }, (_, i) => src(`Item ${i}`, i + 1, 100))
    expect(buildSheet(many, 'spot_top')).toHaveLength(SPOT_TOP_N)
  })

  it('falls back to quantity when no rates are known yet, rather than an arbitrary order', () => {
    const noRates = [src('A', 5), src('B', 900), src('C', 20)]
    expect(buildSheet(noRates, 'spot_top').map(r => r.itemName)).toEqual(['A', 'B', 'C'])  // name order out
    // …but B (the biggest) survived the top-N cut:
    const big = Array.from({ length: 25 }, (_, i) => src(`I${i}`, i))
    expect(buildSheet(big, 'spot_top').some(r => r.itemName === 'I24')).toBe(true)
    expect(buildSheet(big, 'spot_top').some(r => r.itemName === 'I1')).toBe(false)
  })

  it('leaves the sheet in human alphabetical order so he walks the shelf in a line', () => {
    // localeCompare, not code-point order: "Teplon" belongs before "TMT", which
    // a plain .sort() gets wrong because 'M' sorts before 'e'.
    const names = buildSheet(rows, 'location').map(r => r.itemName)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(names).not.toEqual([...names].sort())
  })
})

describe('a difference', () => {
  it('is a difference only once it has actually been counted', () => {
    expect(hasDiff(line({ itemId: 'a', bookQty: 320 }))).toBe(false)               // not reached
    expect(hasDiff(line({ itemId: 'a', bookQty: 320, countedQty: 320 }))).toBe(false)
    expect(hasDiff(line({ itemId: 'a', bookQty: 320, countedQty: 291 }))).toBe(true)
  })

  it('is not what a skipped line is — that is covered by its skip reason', () => {
    const skipped = line({ itemId: 'a', bookQty: 320, skipped: true, skipReason: 'Locked godown' })
    expect(hasDiff(skipped)).toBe(false)
    expect(needsReason(skipped)).toBe(false)
    expect(isReached(skipped)).toBe(true)
  })

  it('must say why', () => {
    const short = line({ itemId: 'a', bookQty: 320, countedQty: 291 })
    expect(needsReason(short)).toBe(true)
    expect(needsReason({ ...short, reason: 'Wastage at site' })).toBe(false)
    expect(needsReason({ ...short, reason: '   ' })).toBe(true)   // blank is not a reason
  })

  it('counts a genuine zero as counted, not as skipped', () => {
    const nil = line({ itemId: 'a', bookQty: 8, countedQty: 0, reason: 'Not traced' })
    expect(isReached(nil)).toBe(true)
    expect(hasDiff(nil)).toBe(true)
    expect(summarize([nil]).shortQty).toBe(8)
  })
})

describe('summarize', () => {
  const lines = [
    line({ itemId: 'cement', bookQty: 320, countedQty: 291, reason: 'Wastage at site', rate: 392 }),
    line({ itemId: 'tape',   bookQty: 40,  countedQty: 40,  rate: 12 }),
    line({ itemId: 'bricks', bookQty: 100, countedQty: 120, reason: 'Entry missed', rate: 9 }),
    line({ itemId: 'sand',   bookQty: 12,  skipped: true, skipReason: 'Godown locked' }),
    line({ itemId: 'steel',  bookQty: 2 }),                                    // not reached
  ]

  it('separates counted, tallied, skipped and not-yet-reached', () => {
    const s = summarize(lines)
    expect(s).toMatchObject({ total: 5, counted: 3, tallied: 1, skipped: 1, notReached: 1 })
  })

  it('keeps short and excess apart — netting them off hides both', () => {
    const s = summarize(lines)
    expect(s).toMatchObject({ shortLines: 1, shortQty: 29, excessLines: 1, excessQty: 20 })
  })

  it('values the shortage at the last known rate', () => {
    expect(summarize(lines).shortValue).toBe(29 * 392)
    expect(summarize(lines).excessValue).toBe(20 * 9)
    expect(summarize(lines).valuePartial).toBe(false)
  })

  it('flags the ₹ figure as understated when a short item has no rate', () => {
    const s = summarize([line({ itemId: 'x', bookQty: 10, countedQty: 4, reason: 'Not traced' })])
    expect(s.shortQty).toBe(6)
    expect(s.shortValue).toBe(0)
    expect(s.valuePartial).toBe(true)
  })

  it('counts the differences still missing a reason', () => {
    const s = summarize([...lines, line({ itemId: 'y', bookQty: 5, countedQty: 3 })])
    expect(s.missingReasons).toBe(1)
  })
})

describe('submitBlocker', () => {
  const done = [line({ itemId: 'a', bookQty: 10, countedQty: 10 })]

  it('refuses a sheet with an uncounted item, and says how many', () => {
    expect(submitBlocker([...done, line({ itemId: 'b', bookQty: 4 })], 'w'))
      .toMatch(/1 item is still not counted/)
  })

  it('refuses a difference with no reason', () => {
    expect(submitBlocker([line({ itemId: 'a', bookQty: 10, countedQty: 7 })], 'w'))
      .toMatch(/no reason/)
  })

  it('refuses a count with no witness — a keeper alone is checking himself', () => {
    expect(submitBlocker(done, null)).toMatch(/needs a witness/)
  })

  it('refuses an empty sheet', () => {
    expect(submitBlocker([], 'w')).toMatch(/Nothing on this sheet/)
  })

  it('lets a complete, reasoned, witnessed count through', () => {
    expect(submitBlocker([
      ...done,
      line({ itemId: 'b', bookQty: 10, countedQty: 8, reason: 'Breakage' }),
      line({ itemId: 'c', bookQty: 3, skipped: true, skipReason: 'Godown locked' }),
    ], 'witness-id')).toBeNull()
  })
})

describe('adjustments', () => {
  it('posts only the real differences — a tallied or skipped line moves nothing', () => {
    const out = adjustments([
      line({ itemId: 'cement', bookQty: 320, countedQty: 291, reason: 'Wastage at site' }),
      line({ itemId: 'tape',   bookQty: 40,  countedQty: 40 }),
      line({ itemId: 'sand',   bookQty: 12,  skipped: true, skipReason: 'Locked' }),
      line({ itemId: 'steel',  bookQty: 2 }),
    ])
    expect(out).toEqual([
      { itemId: 'cement', diff: -29, countedQty: 291, reason: 'Wastage at site' },
    ])
  })

  it('carries the sign, so an excess adds stock and a shortage removes it', () => {
    const out = adjustments([
      line({ itemId: 'a', bookQty: 100, countedQty: 120, reason: 'Entry missed' }),
      line({ itemId: 'b', bookQty: 100, countedQty: 80,  reason: 'Not traced' }),
    ])
    expect(out.map(a => a.diff)).toEqual([20, -20])
  })
})
