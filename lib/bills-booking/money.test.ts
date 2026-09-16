import { describe, it, expect } from 'vitest'
import { moneyAtRest, restByDesk, ageBand, isUnpaidWo, type UnpaidCert } from './money'

const TODAY = new Date('2026-09-16T00:00:00Z').getTime()
const daysAgo = (n: number) => new Date(TODAY - n * 86_400_000).toISOString().slice(0, 10)

const cert = (o: Partial<UnpaidCert> = {}): UnpaidCert => ({
  kind: 'WO', on: daysAgo(3), gross: 100_000, paid: 0, status: 'Approved', project: 'NGH B', ...o,
})

describe('where the money stands', () => {
  /** The proposal page first said ₹23.97 Cr unpaid. 419 of those bills were
   *  ones IN4 marks Paid whose paid-amount column is empty in the mirror. Both
   *  columns are read now, and this is the test that keeps it that way. */
  it('does not count a bill IN4 has marked Paid, even with nothing in paid_amt', () => {
    expect(isUnpaidWo(cert({ status: 'Paid', paid: 0 }))).toBe(false)
    expect(isUnpaidWo(cert({ status: 'paid ', paid: 0 }))).toBe(false)
    expect(isUnpaidWo(cert({ status: 'Approved', paid: 50_000 }))).toBe(false)
    expect(isUnpaidWo(cert({ status: 'Approved', paid: 0 }))).toBe(true)
    expect(isUnpaidWo(cert({ status: 'Cancelled' }))).toBe(false)
  })

  it('keeps the supplier side apart from the contractor side', () => {
    const m = moneyAtRest([cert(), cert({ kind: 'PO', status: '15', gross: 40_000 })], TODAY)
    expect(m.wo.bills).toBe(1); expect(m.wo.value).toBe(100_000)
    expect(m.po.bills).toBe(1); expect(m.po.value).toBe(40_000)
  })

  it('bands by age, and names the ones over ninety days', () => {
    expect(ageBand(daysAgo(0), TODAY)).toBe('0–7 days')
    expect(ageBand(daysAgo(7), TODAY)).toBe('0–7 days')
    expect(ageBand(daysAgo(8), TODAY)).toBe('8–14 days')
    expect(ageBand(daysAgo(30), TODAY)).toBe('15–30 days')
    expect(ageBand(daysAgo(91), TODAY)).toBe('90+ days')
    // No date at all is treated as old, not as new — the pessimistic reading.
    expect(ageBand(null, TODAY)).toBe('90+ days')

    const m = moneyAtRest([cert({ on: daysAgo(100), gross: 5 }), cert({ on: daysAgo(2), gross: 1 })], TODAY)
    expect(m.wo.over90).toEqual({ bills: 1, value: 5 })
    expect(m.wo.byAge.find(b => b.key === '0–7 days')!.bills).toBe(1)
    // Every band is present even when empty, so the chart never has a gap
    // the eye reads as a missing row.
    expect(m.wo.byAge).toHaveLength(5)
  })

  it('folds everything past the top projects into one line', () => {
    const rows = Array.from({ length: 11 }, (_, i) => cert({ project: `P${i}`, gross: (11 - i) * 1000 }))
    const m = moneyAtRest(rows, TODAY)
    expect(m.wo.byProject).toHaveLength(9)
    expect(m.wo.byProject[0].label).toBe('P0')
    const other = m.wo.byProject[8]
    expect(other.label).toBe('3 other projects')
    expect(other.bills).toBe(3)
    expect(other.value).toBe(3000 + 2000 + 1000)
  })

  it('adds up by CT desk, leaving out examples and finished bills', () => {
    const d = restByDesk([
      { stage: 'disc_head', amount: 10, isExample: false },
      { stage: 'disc_head', amount: 20, isExample: false },
      { stage: 'disc_head', amount: 999, isExample: true },
      { stage: 'ct_head', amount: 5, isExample: false },
      { stage: 'paid', amount: 1000, isExample: false },
    ])
    expect(d.map(b => [b.label, b.bills, b.value])).toEqual([['CT Disc Head', 2, 30], ['CT Head', 1, 5]])
  })
})
