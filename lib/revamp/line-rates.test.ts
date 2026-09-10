import { describe, it, expect } from 'vitest'
import { toLineRate, nameTokens, rankSuggestions, lineKey, type RateSuggestion } from './line-rates'
import type { MaterialContext, LastPurchase } from './approver'

const last = (rate: number, over: Partial<LastPurchase> = {}): LastPurchase =>
  ({ rate, date: '2026-01-01', supplier: 'ACME', project: 'NGH B', poNo: 'PO/1', qty: 10, ...over })

const ctx = (over: Partial<MaterialContext>): MaterialContext => ({
  materialId: 1, last: null, lastHere: null,
  onProject: { orderedQty: 0, receivedQty: 0, spend: 0, pos: 0 },
  purchases: 0, suppliers: 0, minRate: null, maxRate: null, ...over,
})

describe('toLineRate', () => {
  it('prefers this-project last rate and computes the change against the current rate', () => {
    const c = ctx({ last: last(90), lastHere: last(100), purchases: 4, suppliers: 2, minRate: 90, maxRate: 110,
      onProject: { orderedQty: 5, receivedQty: 5, spend: 500, pos: 1 } })
    const r = toLineRate({ key: 'k', itemId: 7, name: 'Tile', uom: 'SqFt', rate: 110 }, c, [{ name: 'x', uom: null, lastRate: 1, date: null, supplier: null }])
    expect(r.where).toBe('here')
    expect(r.lastHere?.rate).toBe(100)
    expect(r.deltaPct).toBeCloseTo(10, 5) // 110 vs 100
    expect(r.timesBought).toBe(4)
    expect(r.suppliers).toBe(2)
    expect(r.onProjectSpend).toBe(500)
    expect(r.suggestions).toEqual([]) // dropped: there IS real history
  })

  it('falls back to the trust-wide last rate when the project has none', () => {
    const c = ctx({ last: last(90), purchases: 1 })
    const r = toLineRate({ key: 'k', itemId: null, name: 'Tile', uom: 'SqFt', rate: 81 }, c, [])
    expect(r.where).toBe('elsewhere')
    expect(r.deltaPct).toBeCloseTo(-10, 5) // 81 vs 90 = cheaper
  })

  it('says never-bought and keeps suggestions when there is no history', () => {
    const suggestions: RateSuggestion[] = [{ name: 'Near tile', uom: 'SqFt', lastRate: 55, date: '2025-01-01', supplier: 'ACME' }]
    const r = toLineRate({ key: 'k', itemId: null, name: 'Weird tile', uom: 'SqFt', rate: 60 }, undefined, suggestions)
    expect(r.last).toBeNull()
    expect(r.lastHere).toBeNull()
    expect(r.where).toBeNull()
    expect(r.deltaPct).toBeNull()
    expect(r.timesBought).toBe(0)
    expect(r.suggestions).toEqual(suggestions)
  })
})

describe('nameTokens', () => {
  it('keeps words of 4+ letters, lowercased, drops a leading number and short words', () => {
    expect(nameTokens('7. M/W Pumice Full Body 600x1200 mm')).toEqual(['pumice', 'full', 'body', '600x1200'])
  })
})

describe('rankSuggestions', () => {
  const cand = (name: string, date: string, lastRate = 50): RateSuggestion & { tokens: string[] } =>
    ({ name, uom: 'SqFt', lastRate, date, supplier: 'ACME', tokens: nameTokens(name) })

  it('ranks by shared-token count, then recency, and caps at three', () => {
    const out = rankSuggestions('Vitrified Tile Oasis Granite Sahara', [
      cand('Vitrified Tile Oasis Granite', '2024-01-01'),   // 4 shared
      cand('Vitrified Tile Oasis Sahara', '2026-01-01'),    // 4 shared, newer
      cand('Vitrified Tile Plain', '2025-01-01'),           // 2 shared
      cand('Cement Bag', '2026-05-01'),                     // 0 shared → dropped
      cand('Oasis Granite Slab', '2023-01-01'),             // 2 shared
    ])
    expect(out).toHaveLength(3)
    expect(out[0].name).toBe('Vitrified Tile Oasis Sahara') // most overlap + newest
    expect(out.some(s => s.name === 'Cement Bag')).toBe(false)
  })

  it('returns nothing when the line name has no usable tokens', () => {
    expect(rankSuggestions('a b c', [cand('Anything Real', '2026-01-01')])).toEqual([])
  })
})

describe('lineKey', () => {
  it('is stable across "7." numbering and spacing so both sides match', () => {
    expect(lineKey('7. Protection Plaster', 'Sqm')).toBe(lineKey('protection   plaster', 'sqm'))
  })
})
