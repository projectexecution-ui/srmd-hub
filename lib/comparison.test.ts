import { describe, it, expect } from 'vitest'
import {
  buildQuoteMap, quoteLineAmount, computeItemBest, computeVendorTotals, computeRanking,
  type CmpItem, type CmpVendor, type CmpQuote,
} from './comparison'

// ============================================================================
// SCENARIO MATRIX — comparison-maker L1/L2 ranking (lib/comparison.ts).
// This decides which vendor is shown as cheapest (L1), so correctness here
// can drive a real purchasing decision. Grouped: valid / invalid / edge /
// extreme. Findings from the static-analysis pass are pinned as tests.
// ============================================================================

// ---- builders to keep cases readable --------------------------------------
const item = (id: string, quantity: number | null): CmpItem => ({ id, quantity })
const vendor = (id: string): CmpVendor => ({ id })
const quote = (
  item_id: string, vendor_id: string, rate: number | null,
  opts: { amount?: number | null; not_quoted?: boolean } = {},
): CmpQuote => ({
  item_id, vendor_id, rate,
  amount: opts.amount ?? (rate != null ? null : null),
  not_quoted: opts.not_quoted ?? false,
})

// ───────────────────────────────────────────────────────────────────────────
describe('quoteLineAmount', () => {
  describe('valid', () => {
    it('computes qty × rate — why: the line total every vendor column shows', () => {
      expect(quoteLineAmount(quote('i1', 'v1', 100), item('i1', 5))).toBe(500)
    })
  })
  describe('edge', () => {
    it('not_quoted flag → null even if a rate exists', () => {
      expect(quoteLineAmount(quote('i1', 'v1', 100, { not_quoted: true }), item('i1', 5))).toBeNull()
    })
    it('null rate → null', () => {
      expect(quoteLineAmount(quote('i1', 'v1', null), item('i1', 5))).toBeNull()
    })
    it('qty null but stored amount present → uses stored amount (only fallback)', () => {
      expect(quoteLineAmount(quote('i1', 'v1', 100, { amount: 999 }), item('i1', null))).toBe(999)
    })
    it('qty null and no stored amount → null (can not form qty×rate)', () => {
      expect(quoteLineAmount(quote('i1', 'v1', 100), item('i1', null))).toBeNull()
    })
  })
  describe('invalid / extreme', () => {
    it('NaN rate → null (never NaN into a total)', () => {
      expect(quoteLineAmount(quote('i1', 'v1', NaN), item('i1', 5))).toBeNull()
    })
    it('FIX (Finding E): live qty×rate is preferred over a STALE stored amount', () => {
      // Rate 100 was typed when qty was 5 → stored amount 500. Qty later
      // changed to 10. The live amount must be 1000, NOT the stale 500.
      const stale = quote('i1', 'v1', 100, { amount: 500 })
      expect(quoteLineAmount(stale, item('i1', 10))).toBe(1000)
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('computeItemBest (per-item L1 lowest rate)', () => {
  const items = [item('i1', 1)]
  const vendors = [vendor('v1'), vendor('v2'), vendor('v3')]

  describe('valid', () => {
    it('picks the lowest rate across vendors', () => {
      const m = buildQuoteMap([quote('i1', 'v1', 120), quote('i1', 'v2', 95), quote('i1', 'v3', 110)])
      expect(computeItemBest(items, vendors, m).get('i1')).toBe(95)
    })
  })
  describe('edge', () => {
    it('ignores not_quoted and null-rate vendors when finding the min', () => {
      const m = buildQuoteMap([
        quote('i1', 'v1', 120),
        quote('i1', 'v2', 50, { not_quoted: true }), // cheapest but not a real quote
        quote('i1', 'v3', null),
      ])
      expect(computeItemBest(items, vendors, m).get('i1')).toBe(120)
    })
    it('item with no usable quotes is absent from the map', () => {
      const m = buildQuoteMap([quote('i1', 'v1', null)])
      expect(computeItemBest(items, vendors, m).has('i1')).toBe(false)
    })
    it('ties: lowest value returned (both cells highlight via caller epsilon)', () => {
      const m = buildQuoteMap([quote('i1', 'v1', 100), quote('i1', 'v2', 100)])
      expect(computeItemBest(items, vendors, m).get('i1')).toBe(100)
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('computeVendorTotals', () => {
  const items = [item('i1', 2), item('i2', 3)]
  const vendors = [vendor('v1'), vendor('v2')]

  describe('valid', () => {
    it('sums qty×rate per vendor and counts quoted/missing', () => {
      const m = buildQuoteMap([
        quote('i1', 'v1', 100), quote('i2', 'v1', 50),   // 200 + 150 = 350
        quote('i1', 'v2', 80),                            // 160, missing i2
      ])
      const t = computeVendorTotals(items, vendors, m)
      expect(t.get('v1')).toEqual({ total: 350, missing: 0, quoted: 2 })
      expect(t.get('v2')).toEqual({ total: 160, missing: 1, quoted: 1 })
    })
  })

  describe('edge', () => {
    it('no quotes at all → total 0, all missing', () => {
      const t = computeVendorTotals(items, vendors, new Map())
      expect(t.get('v1')).toEqual({ total: 0, missing: 2, quoted: 0 })
    })
    it('not_quoted counts as missing, not quoted', () => {
      const m = buildQuoteMap([quote('i1', 'v1', 100, { not_quoted: true }), quote('i2', 'v1', 50)])
      expect(t_(m).get('v1')).toEqual({ total: 150, missing: 1, quoted: 1 })
    })
    function t_(m: Map<string, CmpQuote>) { return computeVendorTotals(items, vendors, m) }
  })

  describe('extreme', () => {
    it('FIX (Finding E): editing quantity changes the total (no stale snapshot)', () => {
      // Stored amounts from when qty was different; live compute must win.
      const m = buildQuoteMap([
        quote('i1', 'v1', 100, { amount: 100 }), // stale (qty now 2 → 200)
        quote('i2', 'v1', 50, { amount: 50 }),   // stale (qty now 3 → 150)
      ])
      expect(computeVendorTotals(items, vendors, m).get('v1')!.total).toBe(350)
    })
    it('very large rate × qty does not overflow to a wrong number', () => {
      const big = computeVendorTotals([item('i1', 1e6)], [vendor('v1')], buildQuoteMap([quote('i1', 'v1', 1e6)]))
      expect(big.get('v1')!.total).toBe(1e12)
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('computeRanking (L1/L2/L3)', () => {
  const vendors = [vendor('v1'), vendor('v2'), vendor('v3')]
  const totals = (m: Record<string, number>) =>
    new Map(Object.entries(m).map(([id, total]) => [id, { total, missing: 0, quoted: 1 }]))

  describe('valid', () => {
    it('cheapest total = L1, next = L2, etc.', () => {
      const r = computeRanking(vendors, totals({ v1: 300, v2: 100, v3: 200 }))
      expect(r.get('v2')).toBe(1)
      expect(r.get('v3')).toBe(2)
      expect(r.get('v1')).toBe(3)
    })
  })

  describe('edge', () => {
    it('single ranked vendor is L1', () => {
      expect(computeRanking([vendor('v1')], totals({ v1: 500 })).get('v1')).toBe(1)
    })
    it('Finding C: a vendor with total 0 is UNRANKED (absent)', () => {
      const r = computeRanking(vendors, totals({ v1: 0, v2: 100, v3: 200 }))
      expect(r.has('v1')).toBe(false)
      expect(r.get('v2')).toBe(1)
    })
    it('Finding B: tied totals get DISTINCT sequential ranks (stable, input order)', () => {
      const r = computeRanking(vendors, totals({ v1: 100, v2: 100, v3: 100 }))
      expect(r.get('v1')).toBe(1)
      expect(r.get('v2')).toBe(2)
      expect(r.get('v3')).toBe(3)
    })
    it('empty input → empty ranking', () => {
      expect(computeRanking([], new Map()).size).toBe(0)
    })
  })

  describe('extreme — Finding A (documented risk)', () => {
    it('an INCOMPLETE vendor can be ranked L1 over a fully-quoted one', () => {
      // v1 quoted just one cheap item (total 50, missing 1); v2 fully quoted
      // everything (total 350, missing 0). Current logic crowns v1 L1.
      const t = new Map([
        ['v1', { total: 50, missing: 1, quoted: 1 }],
        ['v2', { total: 350, missing: 0, quoted: 2 }],
      ])
      const r = computeRanking([vendor('v1'), vendor('v2')], t)
      expect(r.get('v1')).toBe(1)  // ← misleading; caller must show "missing"
      expect(r.get('v2')).toBe(2)
    })
  })
})
