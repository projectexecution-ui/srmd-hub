import { describe, it, expect } from 'vitest'
import { rollCerts, retentionLane, closureLane, type LaneWo, type LaneCert } from './lanes'

const NOW = new Date('2026-09-13T00:00:00Z').getTime()
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString().slice(0, 10)

const wo = (o: Partial<LaneWo>): LaneWo => ({
  wo_id: 1, display_no: 'WO/SRASSK/SQ/2023-24/7', contractor_id: 5,
  wo_gross_value: 2_93_92_432, status_name: 'Approved', ...o,
})
const cert = (o: Partial<LaneCert>): LaneCert => ({
  wo_id: 1, project_id: 5, certificate_type: 'Running', status_name: 'Paid',
  gross_bill_amt: 100_000, retention_amt: 5_000, creation_dt: ago(400), ...o,
})

describe('lane roll-up', () => {
  it('nets retention released against retention deducted', () => {
    const r = rollCerts([
      cert({ retention_amt: 5_000 }),
      cert({ retention_amt: 3_000 }),
      cert({ certificate_type: 'Retention', gross_bill_amt: 6_000, retention_amt: 0 }),
    ]).get(1)!
    expect(r.retentionDeducted).toBe(8_000)
    expect(r.retentionReleased).toBe(6_000)
  })

  it('drops cancelled and reversed from both sides', () => {
    const r = rollCerts([
      cert({ retention_amt: 5_000 }),
      cert({ retention_amt: 9_000, status_name: 'Cancelled' }),
      cert({ certificate_type: 'Retention', gross_bill_amt: 4_000, status_name: 'Reversed' }),
    ]).get(1)!
    expect(r.retentionDeducted).toBe(5_000)
    expect(r.retentionReleased).toBe(0)
  })

  it('keeps the latest bill date and counts final certificates', () => {
    const r = rollCerts([
      cert({ creation_dt: ago(400) }),
      cert({ creation_dt: ago(20) }),
      cert({ certificate_type: 'Final', creation_dt: ago(100) }),
    ]).get(1)!
    expect(r.lastBill).toBe(ago(20))
    expect(r.finals).toBe(1)
  })
})

describe('retention lane', () => {
  it('lists only work orders still holding money, biggest first', () => {
    const wos = [wo({ wo_id: 1 }), wo({ wo_id: 2 }), wo({ wo_id: 3 })]
    const rolls = rollCerts([
      cert({ wo_id: 1, retention_amt: 12_01_094 }),
      cert({ wo_id: 2, retention_amt: 8_250 }),
      // fully released — should not appear at all
      cert({ wo_id: 3, retention_amt: 5_000 }),
      cert({ wo_id: 3, certificate_type: 'Retention', gross_bill_amt: 5_000, retention_amt: 0 }),
    ])
    const { rows, totals } = retentionLane(wos, rolls, NOW)
    expect(rows.map(r => r.woId)).toEqual([1, 2])
    expect(totals).toEqual({ wos: 2, held: 12_09_344 })
  })

  it('separates the quiet money from retention correctly held on live work', () => {
    const wos = [wo({ wo_id: 1 }), wo({ wo_id: 2 })]
    const rolls = rollCerts([
      cert({ wo_id: 1, retention_amt: 100, creation_dt: ago(400) }),   // quiet
      cert({ wo_id: 2, retention_amt: 900, creation_dt: ago(10) }),    // live
    ])
    const { shown, active, totals } = retentionLane(wos, rolls, NOW)
    expect(shown).toEqual({ wos: 1, held: 100 })
    expect(active).toEqual({ wos: 1, held: 900 })
    expect(totals.held).toBe(1000)
  })

  it('buckets by how long the work order has been silent', () => {
    const wos = [wo({ wo_id: 1 }), wo({ wo_id: 2 }), wo({ wo_id: 3 })]
    const rolls = rollCerts([
      cert({ wo_id: 1, retention_amt: 10, creation_dt: ago(1200) }),
      cert({ wo_id: 2, retention_amt: 20, creation_dt: ago(200) }),
      cert({ wo_id: 3, retention_amt: 30, creation_dt: ago(5) }),
    ])
    const { buckets } = retentionLane(wos, rolls, NOW)
    expect(buckets.map(b => b.band)).toEqual(['Over 2 years', '6 to 12 months', 'Under 3 months'])
  })
})

describe('closure lane', () => {
  const base = () => {
    const wos = [
      wo({ wo_id: 1, wo_gross_value: 5_09_91_364 }),
      wo({ wo_id: 2, wo_gross_value: 1_00_000 }),
      wo({ wo_id: 3, wo_gross_value: 1_00_000 }),
      wo({ wo_id: 4, wo_gross_value: 1_00_000 }),
    ]
    const rolls = rollCerts([
      cert({ wo_id: 1, gross_bill_amt: 2_86_48_704, retention_amt: 0, creation_dt: ago(333) }),
      cert({ wo_id: 2, gross_bill_amt: 90_000, retention_amt: 0, creation_dt: ago(300) }),   // ₹10,000 left
      // has a final bill — closed, so not a candidate
      cert({ wo_id: 3, gross_bill_amt: 50_000, retention_amt: 0, creation_dt: ago(300) }),
      cert({ wo_id: 3, certificate_type: 'Final', gross_bill_amt: 50_000, retention_amt: 0, creation_dt: ago(299) }),
      // billed last week — still running
      cert({ wo_id: 4, gross_bill_amt: 10_000, retention_amt: 0, creation_dt: ago(7) }),
    ])
    return { wos, rolls }
  }

  it('takes only work orders with no final bill that have gone quiet', () => {
    const { wos, rolls } = base()
    const { rows, totals } = closureLane(wos, rolls, 0, NOW)
    expect(rows.map(r => r.woId)).toEqual([1, 2])
    expect(totals.wos).toBe(2)
  })

  it('counts unbilled balance and held retention together as money at stake', () => {
    const wos = [wo({ wo_id: 1, wo_gross_value: 1_00_000 })]
    const rolls = rollCerts([cert({ wo_id: 1, gross_bill_amt: 60_000, retention_amt: 4_000, creation_dt: ago(300) })])
    const { rows } = closureLane(wos, rolls, 0, NOW)
    expect(rows[0]).toMatchObject({ neverBilled: 40_000, retentionHeld: 4_000, atStake: 44_000 })
  })

  it('hides small change under the floor but still reports what it hid', () => {
    const { wos, rolls } = base()
    const { rows, shown, hidden, totals } = closureLane(wos, rolls, 25_000, NOW)
    expect(rows.map(r => r.woId)).toEqual([1])          // WO 2 is only ₹10,000
    expect(hidden).toEqual({ wos: 1, atStake: 10_000 })
    expect(shown.atStake + hidden.atStake).toBe(totals.atStake)
  })

  it('never reports a negative balance when a work order was over-billed', () => {
    const wos = [wo({ wo_id: 1, wo_gross_value: 1_00_000 })]
    const rolls = rollCerts([cert({ wo_id: 1, gross_bill_amt: 1_50_000, retention_amt: 0, creation_dt: ago(300) })])
    const { rows } = closureLane(wos, rolls, 0, NOW)
    expect(rows[0].neverBilled).toBe(0)
  })
})
