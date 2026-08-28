import { describe, it, expect } from 'vitest'
import { explainAdditions, solveLadder, ladderFor } from './additions'

// Every fixture below is a real sheet from the live database.

describe('solveLadder', () => {
  it('recovers 5% contingency + 18% GST (NGH-3901-Q01)', () => {
    expect(solveLadder(4138543.94, 5127656)).toEqual({ contingencyPct: 5, gstPct: 18 })
  })

  it('recovers GST alone when there is no contingency (WCE-201-Q01)', () => {
    expect(solveLadder(4000000, 4720000)).toEqual({ contingencyPct: 0, gstPct: 18 })
  })

  it('recovers 10% contingency (NGH-1102-Q01)', () => {
    expect(solveLadder(321000, 416658)).toEqual({ contingencyPct: 10, gstPct: 18 })
  })

  it('gives up rather than guess when nothing fits (A-404-B01: +8.6%)', () => {
    expect(solveLadder(1359826, 1477064)).toBeNull()
  })
})

describe('explainAdditions', () => {
  it('names both components on a template sheet', () => {
    const b = explainAdditions(4138543.94, 5127656)!
    expect(b.source).toBe('derived')
    expect(b.lines.map(l => l.label)).toEqual(['Contingency @ 5%', 'GST @ 18%'])
    // The two named lines must add up to the gap the footer shows.
    expect(Math.round(b.lines.reduce((s, l) => s + l.amount, 0))).toBe(Math.round(b.total))
    expect(b.note).toBeTruthy()
  })

  it('drops the contingency line when the sheet has none', () => {
    const b = explainAdditions(4000000, 4720000)!
    expect(b.lines).toEqual([{ label: 'GST @ 18%', amount: 720000 }])
  })

  it('prefers the percentages saved with the sheet over solving', () => {
    const b = explainAdditions(1000000, 1239000, {
      contingencyPct: 5, contingencyAmt: 50000, gstPct: 18, gstAmt: 189000,
    })!
    expect(b.source).toBe('sheet')
    expect(b.note).toBeNull()
    expect(b.lines).toEqual([
      { label: 'Contingency @ 5%', amount: 50000 },
      { label: 'GST @ 18%', amount: 189000 },
    ])
  })

  it('falls back to solving when the saved ladder no longer reconciles', () => {
    // Rows were edited after upload, so the stored amounts are stale.
    const b = explainAdditions(4000000, 4720000, {
      contingencyPct: 5, contingencyAmt: 11, gstPct: 18, gstAmt: 22,
    })!
    expect(b.source).toBe('derived')
  })

  it('says "not itemised" rather than invent a split', () => {
    const b = explainAdditions(1359826, 1477064)!
    expect(b.source).toBe('unnamed')
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0].amount).toBe(117238)
  })

  it('calls an overrun what it is, not an addition (A-1205-B01)', () => {
    const b = explainAdditions(37147173, 4330201)!
    expect(b.source).toBe('overrun')
    expect(b.total).toBeLessThan(0)
    expect(b.lines[0].label).not.toMatch(/GST|contingency/i)
  })

  it('shows nothing when the rows already add up', () => {
    expect(explainAdditions(500000, 500000)).toBeNull()
    expect(explainAdditions(500000, 500000.4)).toBeNull()
  })
})

describe('ladderFor', () => {
  it('compounds GST on subtotal + contingency, as the template does', () => {
    const l = ladderFor(1000000, 5, 18)
    expect(l.contingency).toBe(50000)
    expect(l.gst).toBe(189000)      // 18% of 10,50,000 — not of 10,00,000
    expect(l.grandTotal).toBe(1239000)
  })
})
