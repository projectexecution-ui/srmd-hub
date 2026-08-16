import { describe, expect, it } from 'vitest'
import {
  ageBucket, daysBetween, seriesGaps, entrySeq, rateSpread, crossEntity,
  outstandingReturnables, poPending, CONTROL_REPORTS, reportMeta, DEFERRED_REPORTS,
  RATE_SPREAD_FLOOR, STALE_PO_DAYS,
} from './exceptions'
import type { ReturnableLine, PoLineState } from './exceptions'

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-08-01', '2026-08-13')).toBe(12)
    expect(daysBetween('2026-08-13', '2026-08-13')).toBe(0)
  })
  it('crosses month and year ends', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1)
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
  })
  it('goes negative for a future date rather than lying about it', () => {
    expect(daysBetween('2026-08-20', '2026-08-13')).toBe(-7)
  })
  it('is 0 for an unparseable date instead of NaN spreading through a report', () => {
    expect(daysBetween('not a date', '2026-08-13')).toBe(0)
  })
})

describe('ageBucket', () => {
  it('puts a line in the worst bucket it qualifies for', () => {
    expect(ageBucket(200)).toBe(180)
    expect(ageBucket(180)).toBe(180)
    expect(ageBucket(179)).toBe(90)
    expect(ageBucket(90)).toBe(90)
    expect(ageBucket(61)).toBe(60)
    expect(ageBucket(60)).toBe(60)
  })
  it('is not a finding below 60 days', () => {
    expect(ageBucket(59)).toBeNull()
    expect(ageBucket(0)).toBeNull()
  })
})

describe('seriesGaps', () => {
  it('finds the number that was handed out but has no entry', () => {
    expect(seriesGaps(5, [1, 2, 4, 5])).toEqual([3])
  })
  it('finds several, in order', () => {
    expect(seriesGaps(6, [2, 5])).toEqual([1, 3, 4, 6])
  })
  it('is empty when every number is accounted for — the normal day', () => {
    expect(seriesGaps(3, [1, 2, 3])).toEqual([])
    expect(seriesGaps(0, [])).toEqual([])
  })
  it('ignores numbers above the series high-water mark', () => {
    expect(seriesGaps(2, [1, 2, 9])).toEqual([])
  })
})

describe('entrySeq', () => {
  it('reads the sequence off a real entry number', () => {
    expect(entrySeq('In: 13Aug26/001')).toBe(1)
    expect(entrySeq('Out: 13Aug26/047')).toBe(47)
    expect(entrySeq('Tr: 01Apr26/123')).toBe(123)
  })
  it('is null for anything it cannot read, rather than guessing 0', () => {
    expect(entrySeq('In: 13Aug26')).toBeNull()
    expect(entrySeq('')).toBeNull()
  })
})

describe('rateSpread', () => {
  const obs = (rate: number, entity: string, day = '2026-08-01') =>
    ({ rate, entity, party: 'Ultratech', day })

  it('is not a variance when there is only one rate to compare', () => {
    expect(rateSpread([obs(392, 'SRASSK')])).toBeNull()
    expect(rateSpread([])).toBeNull()
  })
  it('is not a variance when every rate is the same', () => {
    expect(rateSpread([obs(392, 'SRASSK'), obs(392, 'SRET')])).toBeNull()
  })
  it('reports the cheapest and dearest, and the gap between them', () => {
    const s = rateSpread([obs(392, 'SRASSK'), obs(430, 'SRET'), obs(400, 'SRJT')])!
    expect(s.low).toBe(392)
    expect(s.high).toBe(430)
    expect(s.spread).toBe(38)
    expect(s.spreadPct).toBeCloseTo(38 / 392, 6)
    expect(s.cheapest.entity).toBe('SRASSK')
    expect(s.dearest.entity).toBe('SRET')
  })
  it('ignores lines with no rate rather than treating them as free', () => {
    const s = rateSpread([obs(392, 'SRASSK'), { rate: 0, entity: 'X', party: null, day: '2026-08-01' }])
    expect(s).toBeNull()   // only one real rate remains
  })
  it('has a floor so freight-sized differences do not bury the real ones', () => {
    const small = rateSpread([obs(100, 'A'), obs(103, 'B')])!
    expect(small.spreadPct < RATE_SPREAD_FLOOR).toBe(true)
    const real = rateSpread([obs(100, 'A'), obs(140, 'B')])!
    expect(real.spreadPct > RATE_SPREAD_FLOOR).toBe(true)
  })
})

describe('crossEntity', () => {
  it('ignores a project funded by one entity — that is normal, not a finding', () => {
    expect(crossEntity([
      { projectName: 'NGH A', entity: 'SRASSK', qtyLines: 4, amount: 50000 },
    ])).toEqual([])
  })

  it('flags a project charged to two entities and totals it', () => {
    const out = crossEntity([
      { projectName: 'NGH A', entity: 'SRASSK', qtyLines: 4, amount: 50000 },
      { projectName: 'NGH A', entity: 'SRET', qtyLines: 1, amount: 12000 },
      { projectName: 'RU B', entity: 'SRET', qtyLines: 2, amount: 9000 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].projectName).toBe('NGH A')
    expect(out[0].total).toBe(62000)
    expect(out[0].entities.map(e => e.entity)).toEqual(['SRASSK', 'SRET'])   // biggest first
  })

  it('puts the biggest settlement first', () => {
    const out = crossEntity([
      { projectName: 'Small', entity: 'A', qtyLines: 1, amount: 100 },
      { projectName: 'Small', entity: 'B', qtyLines: 1, amount: 100 },
      { projectName: 'Big', entity: 'A', qtyLines: 1, amount: 90000 },
      { projectName: 'Big', entity: 'B', qtyLines: 1, amount: 10000 },
    ])
    expect(out.map(o => o.projectName)).toEqual(['Big', 'Small'])
  })
})

describe('outstandingReturnables', () => {
  const line = (over: Partial<ReturnableLine> & { entryNo: string }): ReturnableLine => ({
    day: '2026-07-01', projectName: 'NGH A', engineerName: 'Milan',
    itemName: 'Scaffolding pipe', unit: 'Nos', qty: 100, returnedQty: 0, dueDate: null,
    ...over,
  })

  it('drops anything that has come back in full, however late', () => {
    expect(outstandingReturnables([line({ entryNo: 'A', qty: 50, returnedQty: 50 })], '2026-08-13')).toEqual([])
  })

  it('keeps a part return, counting only what is still out', () => {
    const [f] = outstandingReturnables([line({ entryNo: 'A', qty: 100, returnedQty: 60 })], '2026-08-13')
    expect(f.outstanding).toBe(40)
  })

  it('counts the days it has been out — "47 days, not returned"', () => {
    const [f] = outstandingReturnables([line({ entryNo: 'A', day: '2026-06-27' })], '2026-08-13')
    expect(f.daysOut).toBe(47)
  })

  it('measures overdue from the due date, not from when it went out', () => {
    const [f] = outstandingReturnables(
      [line({ entryNo: 'A', day: '2026-06-27', dueDate: '2026-08-01' })], '2026-08-13')
    expect(f.overdueDays).toBe(12)
  })

  it('is not overdue before its due date, but is still out', () => {
    const [f] = outstandingReturnables(
      [line({ entryNo: 'A', day: '2026-08-01', dueDate: '2026-09-30' })], '2026-08-13')
    expect(f.overdueDays).toBeNull()
    expect(f.daysOut).toBe(12)
  })

  it('puts the most overdue first, then the longest out', () => {
    const out = outstandingReturnables([
      line({ entryNo: 'mild', day: '2026-08-01', dueDate: '2026-08-10' }),
      line({ entryNo: 'bad', day: '2026-05-01', dueDate: '2026-06-01' }),
      line({ entryNo: 'none', day: '2026-01-01' }),
    ], '2026-08-13')
    expect(out.map(o => o.entryNo)).toEqual(['bad', 'mild', 'none'])
  })
})

describe('poPending', () => {
  const l = (over: Partial<PoLineState> & { poNo: string }): PoLineState => ({
    vendor: 'Ultratech', entity: 'SRASSK', itemName: 'OPC 53 Cement', unit: 'Bag',
    ordered: 5000, received: 3700, rate: 392, status: 'partly_received',
    lastDeliveryDay: '2026-08-13',
    ...over,
  })

  it('computes what is still to come and what it is worth', () => {
    const [p] = poPending([l({ poNo: 'PO-1' })], '2026-08-13')
    expect(p.pending).toBe(1300)
    expect(p.pendingValue).toBe(1300 * 392)
    expect(p.stale).toBe(false)
  })

  it('never shows a negative pending — an over-receipt is its own column', () => {
    const [p] = poPending([l({ poNo: 'PO-1', ordered: 120, received: 140 })], '2026-08-13')
    expect(p.pending).toBe(0)
    expect(p.overReceived).toBe(20)
  })

  it(`calls a line stale after ${STALE_PO_DAYS} days with nothing arriving`, () => {
    const [fresh] = poPending([l({ poNo: 'A', lastDeliveryDay: '2026-08-08' })], '2026-08-13')
    expect(fresh.daysSinceDelivery).toBe(5)
    expect(fresh.stale).toBe(false)
    const [stale] = poPending([l({ poNo: 'B', lastDeliveryDay: '2026-08-01' })], '2026-08-13')
    expect(stale.daysSinceDelivery).toBe(12)
    expect(stale.stale).toBe(true)
  })

  it('treats "never delivered anything" as stale — that is the worst case', () => {
    const [p] = poPending([l({ poNo: 'C', received: 0, lastDeliveryDay: null })], '2026-08-13')
    expect(p.daysSinceDelivery).toBeNull()
    expect(p.stale).toBe(true)
  })

  it('is not stale once the order is complete, however long ago', () => {
    const [p] = poPending(
      [l({ poNo: 'D', ordered: 100, received: 100, lastDeliveryDay: '2025-01-01' })], '2026-08-13')
    expect(p.pending).toBe(0)
    expect(p.stale).toBe(false)
  })

  it('leaves pendingValue null rather than 0 when no rate is known', () => {
    const [p] = poPending([l({ poNo: 'E', rate: null })], '2026-08-13')
    expect(p.pendingValue).toBeNull()
  })
})

describe('the report catalogue', () => {
  it('has a unique key per report', () => {
    const keys = CONTROL_REPORTS.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('finds a report by key, and refuses one that does not exist', () => {
    expect(reportMeta('dead-stock')?.title).toBe('Dead stock ageing')
    expect(reportMeta('nonsense')).toBeNull()
  })
  it('gives every report a question a human would actually ask', () => {
    for (const r of CONTROL_REPORTS) {
      expect(r.question.length).toBeGreaterThan(15)
      expect(r.blurb.length).toBeGreaterThan(10)
    }
  })
  it('says WHY each deferred report is deferred, so it is not silently dropped', () => {
    expect(DEFERRED_REPORTS).toHaveLength(2)
    for (const d of DEFERRED_REPORTS) expect(d.why.length).toBeGreaterThan(40)
  })
  it('covers the 14 from the review — 13 built plus 2 deferred, with 2 added since', () => {
    // "Differs from IN4" came out of following IN4's item as the base.
    // "Voided entries" moved from deferred to built once voiding existed: the
    // reason it was deferred — "nothing can be edited yet" — stopped being true.
    expect(CONTROL_REPORTS.length + DEFERRED_REPORTS.length).toBe(15)
    expect(CONTROL_REPORTS.some(r => r.key === 'differs-from-in4')).toBe(true)
    expect(CONTROL_REPORTS.some(r => r.key === 'voided')).toBe(true)
    expect(DEFERRED_REPORTS.some(d => d.title === 'Edit history')).toBe(false)
  })
})
