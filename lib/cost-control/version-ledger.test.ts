import { describe, it, expect } from 'vitest'
import {
  chainCumulative,
  chainReleasedSoFar,
  matchBoqRows,
  summarizeMatch,
  normalizeKey,
  isRealVersion,
  basisCounts,
  type LedgerVersion,
  type BoqItem,
} from './version-ledger'

const v = (o: Partial<LedgerVersion> & { id: string; version_no: number }): LedgerVersion => ({
  status: 'approved', total_amount: 0, approved_for_erp_amt: 0, summary_notes: null, archived_at: null, ...o,
})

describe('chainCumulative', () => {
  it('baseline = immediately-prior approved version total; thisAsk = the delta', () => {
    const sibs = [
      v({ id: 'a', version_no: 1, total_amount: 1_000_000, status: 'approved' }),
      v({ id: 'b', version_no: 2, total_amount: 1_400_000, status: 'approved' }),
      // v3 restates the whole BOQ at 1.65 Cr; baseline is v2's approved total.
      v({ id: 'c', version_no: 3, total_amount: 1_650_000, status: 'submitted' }),
    ]
    const r = chainCumulative(sibs, 'c')
    expect(r.alreadyApproved).toBe(1_400_000)  // v2's total, NOT v1+v2 summed
    expect(r.cumulative).toBe(1_650_000)
    expect(r.thisAsk).toBe(250_000)
    expect(r.priorCount).toBe(2)
  })

  it('uses the approved TOTAL, not the released tranche', () => {
    const sibs = [
      // partially released to ERP (400k) but the whole 1.4 Cr BOQ was approved.
      v({ id: 'b', version_no: 1, total_amount: 1_400_000, approved_for_erp_amt: 400_000, status: 'partially_approved' }),
      v({ id: 'c', version_no: 2, total_amount: 1_650_000, status: 'submitted' }),
    ]
    const r = chainCumulative(sibs, 'c')
    expect(r.alreadyApproved).toBe(1_400_000)
    expect(r.thisAsk).toBe(250_000)
  })

  it('ignores a prior that is not yet approved (still draft/submitted)', () => {
    const sibs = [
      v({ id: 'a', version_no: 1, total_amount: 900_000, status: 'submitted' }),  // not approved
      v({ id: 'b', version_no: 2, total_amount: 950_000, status: 'draft' }),
    ]
    const r = chainCumulative(sibs, 'b')
    expect(r.alreadyApproved).toBe(0)
    expect(r.thisAsk).toBe(950_000)
  })

  it('v1 has no priors — thisAsk equals the full total', () => {
    const sibs = [v({ id: 'a', version_no: 1, total_amount: 500_000 })]
    const r = chainCumulative(sibs, 'a')
    expect(r.alreadyApproved).toBe(0)
    expect(r.cumulative).toBe(500_000)
    expect(r.thisAsk).toBe(500_000)
  })

  it('excludes [IB] baseline, cancelled and archived priors', () => {
    const sibs = [
      v({ id: 'ib', version_no: 1, total_amount: 9_999, status: 'approved', summary_notes: '[IB] baseline' }),
      v({ id: 'x', version_no: 2, total_amount: 5_000, status: 'cancelled' }),
      v({ id: 'y', version_no: 3, total_amount: 7_000, status: 'approved', archived_at: '2026-01-01' }),
      v({ id: 'ok', version_no: 4, total_amount: 100_000, status: 'approved' }),
      v({ id: 'cur', version_no: 5, total_amount: 120_000, status: 'submitted' }),
    ]
    const r = chainCumulative(sibs, 'cur')
    expect(r.alreadyApproved).toBe(100_000) // only 'ok'
    expect(r.thisAsk).toBe(20_000)
  })
})

describe('chainReleasedSoFar (Trustee release baseline)', () => {
  it('is 0 when nothing has ever been released', () => {
    const sibs = [
      v({ id: 'a', version_no: 1, total_amount: 500_000, status: 'submitted' }),
      v({ id: 'b', version_no: 2, total_amount: 600_000, status: 'atm_approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(0)
  })

  it('FULL prior release → baseline = the prior version full total', () => {
    // v8 fully released ₹9,95,600; v9 pending. Balance = 10,50,600 − 9,95,600.
    const sibs = [
      v({ id: 'v8', version_no: 8, total_amount: 995_600, approved_for_erp_amt: 995_600, status: 'approved' }),
      v({ id: 'v9', version_no: 9, total_amount: 1_050_600, approved_for_erp_amt: 0, status: 'atm_approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(995_600)
    const m = chainCumulative(sibs, 'v9')
    expect(m.balanceToRelease).toBe(55_000)
  })

  it('PARTIAL prior release → baseline = the amount ACTUALLY released, carrying the remainder forward', () => {
    // v8 total ₹9,95,600 but only ₹9,40,000 released (₹55,600 held back);
    // v9 cumulative ₹10,50,600. Balance = 10,50,600 − 9,40,000 = 1,10,600
    // = the un-released ₹55,600 of v8 + the ₹55,000 new scope of v9.
    const sibs = [
      v({ id: 'v8', version_no: 8, total_amount: 995_600, approved_for_erp_amt: 940_000, status: 'partially_approved' }),
      v({ id: 'v9', version_no: 9, total_amount: 1_050_600, approved_for_erp_amt: 0, status: 'atm_approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(940_000)
    const m = chainCumulative(sibs, 'v9')
    expect(m.releasedSoFar).toBe(940_000)
    expect(m.balanceToRelease).toBe(110_600)
  })

  it('is monotonic — takes the MAX across the chain, not the latest row', () => {
    // Rows out of order, and an earlier version released more than a later one.
    const sibs = [
      v({ id: 'v3', version_no: 3, approved_for_erp_amt: 300_000, status: 'partially_approved' }),
      v({ id: 'v1', version_no: 1, approved_for_erp_amt: 620_000, status: 'approved' }),
      v({ id: 'v2', version_no: 2, approved_for_erp_amt: 500_000, status: 'approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(620_000)
  })

  it('current version already partly released on ITSELF → its own tranche is the baseline', () => {
    // Single-version sheet, partially released ₹5,00,000 of ₹6,51,920.50.
    const sibs = [
      v({ id: 'only', version_no: 1, total_amount: 651_920.5, approved_for_erp_amt: 500_000, status: 'partially_approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(500_000)
    const m = chainCumulative(sibs, 'only')
    expect(m.balanceToRelease).toBeCloseTo(151_920.5, 2)
  })

  it('scope reduced in a revision never claws back money already out — balance floors at 0', () => {
    const sibs = [
      v({ id: 'v1', version_no: 1, total_amount: 996_000, approved_for_erp_amt: 996_000, status: 'approved' }),
      v({ id: 'v2', version_no: 2, total_amount: 900_000, approved_for_erp_amt: 0, status: 'atm_approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(996_000)
    expect(chainCumulative(sibs, 'v2').balanceToRelease).toBe(0)
  })

  it('excludes [IB] baseline, cancelled and archived versions', () => {
    const sibs = [
      v({ id: 'ib', version_no: 1, approved_for_erp_amt: 9_000_000, status: 'approved', summary_notes: '[IB] baseline' }),
      v({ id: 'x', version_no: 2, approved_for_erp_amt: 8_000_000, status: 'cancelled' }),
      v({ id: 'y', version_no: 3, approved_for_erp_amt: 7_000_000, status: 'approved', archived_at: '2026-01-01' }),
      v({ id: 'ok', version_no: 4, approved_for_erp_amt: 100_000, status: 'approved' }),
    ]
    expect(chainReleasedSoFar(sibs)).toBe(100_000)
  })
})

describe('normalizeKey', () => {
  it('lowercases, strips punctuation, collapses spaces', () => {
    expect(normalizeKey('  RCC   M25 (footings)! ')).toBe('rcc m25 footings')
  })
})

describe('matchBoqRows', () => {
  const prior: BoqItem[] = [
    { description: 'RCC footings', unit: 'Cum', qty: 96, rate: 7700, amount: 739200, material: 6800, installation: 900, ml: null },
    { description: 'RCC slabs', unit: 'Cum', qty: 165, rate: 7900, amount: 1303500, ml: 7900 },
    { description: 'Old railing', unit: 'Rmt', qty: 40, rate: 1200, amount: 48000 },
  ]

  it('detects a continuing row with a qty increase and no rate change', () => {
    const cur: BoqItem[] = [
      { description: 'RCC footings', unit: 'Cum', qty: 110, rate: 7700, amount: 847000, material: 6800, installation: 900, ml: null },
    ]
    const rows = matchBoqRows(cur, prior)
    const f = rows.find(r => r.key === 'rcc footings')!
    expect(f.isNew).toBe(false)
    expect(f.approvedQty).toBe(96)
    expect(f.newQty).toBe(110)
    expect(f.qtyDelta).toBe(14)
    expect(f.rateChanged).toBe(false)
  })

  it('detects a rate change and names the moved component', () => {
    const cur: BoqItem[] = [
      { description: 'RCC footings', unit: 'Cum', qty: 96, rate: 8000, amount: 768000, material: 7100, installation: 900, ml: null },
    ]
    const f = matchBoqRows(cur, prior).find(r => r.key === 'rcc footings')!
    expect(f.rateChanged).toBe(true)
    expect(f.rateOld).toBe(7700)
    expect(f.rateNew).toBe(8000)
    expect(f.rateChangeComponents).toContain('material')
    expect(f.rateChangeComponents).not.toContain('installation')
  })

  it('falls back to component "rate" when no breakdown is present', () => {
    const p: BoqItem[] = [{ description: 'Painting', qty: 100, rate: 50, amount: 5000 }]
    const c: BoqItem[] = [{ description: 'Painting', qty: 100, rate: 60, amount: 6000 }]
    const f = matchBoqRows(c, p)[0]
    expect(f.rateChanged).toBe(true)
    expect(f.rateChangeComponents).toEqual(['rate'])
  })

  it('flags a brand-new item', () => {
    const cur: BoqItem[] = [{ description: 'New waterproofing', unit: 'Sqm', qty: 200, rate: 850, amount: 170000 }]
    const f = matchBoqRows(cur, prior).find(r => r.key === 'new waterproofing')!
    expect(f.isNew).toBe(true)
    expect(f.approvedQty).toBeNull()
    expect(f.newQty).toBe(200)
  })

  it('flags a dropped approved item', () => {
    const cur: BoqItem[] = [{ description: 'RCC footings', qty: 96, rate: 7700, amount: 739200 }]
    const rows = matchBoqRows(cur, prior)
    const dropped = rows.filter(r => r.dropped).map(r => r.key)
    expect(dropped).toContain('rcc slabs')
    expect(dropped).toContain('old railing')
  })

  it('advises a possible double claim on a near-duplicate new row', () => {
    const cur: BoqItem[] = [
      { description: 'RCC footings work', qty: 50, rate: 7700, amount: 385000 }, // ~dup of "RCC footings"
    ]
    const f = matchBoqRows(cur, prior).find(r => r.isNew)!
    expect(f.possibleDoubleClaim).toBe(true)
  })

  it('orders rows continuing → new → dropped', () => {
    const cur: BoqItem[] = [
      { description: 'RCC footings', qty: 96, rate: 7700, amount: 739200 },  // continuing
      { description: 'Fresh item', qty: 1, rate: 1000, amount: 1000 },        // new
    ]
    const rows = matchBoqRows(cur, prior)
    const kinds = rows.map(r => (r.dropped ? 'd' : r.isNew ? 'n' : 'c'))
    // continuing first, then new, then dropped
    expect(kinds.indexOf('c')).toBeLessThan(kinds.indexOf('n'))
    expect(kinds.indexOf('n')).toBeLessThan(kinds.indexOf('d'))
  })
})

describe('summarizeMatch', () => {
  it('rolls up counts + totals', () => {
    const prior: BoqItem[] = [
      { description: 'A', qty: 10, rate: 100, amount: 1000 },
      { description: 'B', qty: 5, rate: 200, amount: 1000 },
    ]
    const cur: BoqItem[] = [
      { description: 'A', qty: 12, rate: 120, amount: 1440 },  // continuing + rate change
      { description: 'C', qty: 2, rate: 500, amount: 1000 },   // new
    ]
    const s = summarizeMatch(matchBoqRows(cur, prior))
    expect(s.continuingCount).toBe(1)
    expect(s.newCount).toBe(1)
    expect(s.droppedCount).toBe(1) // B
    expect(s.rateChangedCount).toBe(1)
    expect(s.newAskTotal).toBe(1440 + 1000)
  })
})

describe('isRealVersion', () => {
  it('rejects baseline / cancelled / archived', () => {
    expect(isRealVersion(v({ id: '1', version_no: 1, summary_notes: '[IB]x' }))).toBe(false)
    expect(isRealVersion(v({ id: '2', version_no: 1, status: 'cancelled' }))).toBe(false)
    expect(isRealVersion(v({ id: '3', version_no: 1, archived_at: '2026-01-01' }))).toBe(false)
    expect(isRealVersion(v({ id: '4', version_no: 1 }))).toBe(true)
  })
})

describe('take-off basis (S10)', () => {
  it('basisCounts treats a missing basis as measured (legacy rows)', () => {
    const c = basisCounts([
      { description: 'a', qty: 1, rate: 1, amount: 1, basis: 'measured' },
      { description: 'b', qty: 1, rate: 1, amount: 1, basis: 'estimated' },
      { description: 'c', qty: 1, rate: 1, amount: 1 }, // legacy → measured
    ])
    expect(c).toEqual({ measured: 2, estimated: 1, total: 3 })
  })

  it('matchBoqRows flags estimate→measured across a revision', () => {
    const prior = [{ description: 'Pipe Penetration', qty: 14, rate: 962, amount: 13468, basis: 'estimated' as const }]
    const current = [{ description: 'Pipe Penetration', qty: 16, rate: 962, amount: 15392, basis: 'measured' as const }]
    const rows = matchBoqRows(current, prior)
    expect(rows).toHaveLength(1)
    expect(rows[0].approvedBasis).toBe('estimated')
    expect(rows[0].newBasis).toBe('measured')
    expect(rows[0].basisPromoted).toBe(true)
  })

  it('summarizeMatch counts measured/estimate on the current version + promotions', () => {
    const prior = [{ description: 'X', qty: 10, rate: 100, amount: 1000, basis: 'estimated' as const }]
    const current = [
      { description: 'X', qty: 10, rate: 100, amount: 1000, basis: 'measured' as const },  // promoted
      { description: 'Y new', qty: 5, rate: 50, amount: 250, basis: 'estimated' as const }, // still estimate
    ]
    const s = summarizeMatch(matchBoqRows(current, prior))
    expect(s.measuredCount).toBe(1)
    expect(s.estimateCount).toBe(1)
    expect(s.promotedCount).toBe(1)
  })
})
