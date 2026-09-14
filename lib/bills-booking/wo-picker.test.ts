import { describe, it, expect } from 'vitest'
import { buildPickList } from './wo-picker'

const contractors = new Map([[5, 'Amin Developers'], [3, 'Desai Construction Pvt Ltd.']])

const wo = (o: Partial<Parameters<typeof buildPickList>[0][number]> = {}) => ({
  wo_id: 2149, display_no: 'WO/SRASSK/SQ/2026-27/105', contractor_id: 5,
  wo_value: 3_832_500, wo_gross_value: 4_522_350, wo_retention_amt: 0, status_name: 'Approved', ...o,
})
const cert = (o: Partial<Parameters<typeof buildPickList>[1][number]> = {}) => ({
  wo_id: 2149, project_id: 5, subproject_id: 5, status_name: 'Approved',
  gross_bill_amt: 1_317_650, retention_amt: 55_833, certified_amt: 1_116_653,
  invoice_no: 'SR-26-27-67', creation_dt: '2026-09-12', ...o,
})

describe('work-order picker', () => {
  it('fills contractor, ordered value, billed and balance from IN4', () => {
    const [p] = buildPickList([wo()], [cert()], contractors)
    expect(p.contractor).toBe('Amin Developers')
    expect(p.orderedGross).toBe(4_522_350)
    expect(p.billedGross).toBe(1_317_650)
    expect(p.balance).toBe(3_204_700)
    expect(p.projectId).toBe(5)
  })

  it('reads the trust out of the work-order number', () => {
    expect(buildPickList([wo()], [], contractors)[0].trust).toBe('SRASSK')
    expect(buildPickList([wo({ display_no: 'WO/SRET/RU/2026-27/1' })], [], contractors)[0].trust).toBe('SRET')
  })

  it('derives the retention rate from what IN4 actually deducted', () => {
    // 55,833 on 1,116,653 certified = 5.0%
    expect(buildPickList([wo()], [cert()], contractors)[0].retentionPct).toBe(5)
    // a work order that holds none says so, rather than assuming a house rule
    expect(buildPickList([wo()], [cert({ retention_amt: 0 })], contractors)[0].retentionPct).toBe(0)
    // and with no bills yet there is nothing to derive from
    expect(buildPickList([wo()], [], contractors)[0].retentionPct).toBeNull()
  })

  it('counts the bills so far and carries the last bill number', () => {
    const [p] = buildPickList([wo()], [
      cert({ invoice_no: 'RA-1', creation_dt: '2026-07-01' }),
      cert({ invoice_no: 'RA-2', creation_dt: '2026-08-01' }),
      cert({ invoice_no: 'RA-3', creation_dt: '2026-09-01' }),
    ], contractors)
    expect(p.bills).toBe(3)
    expect(p.lastBillNo).toBe('RA-3')        // latest by date, not by row order
  })

  it('ignores cancelled and reversed certificates in every figure', () => {
    const [p] = buildPickList([wo()], [
      cert({ gross_bill_amt: 100, certified_amt: 100, retention_amt: 5 }),
      cert({ gross_bill_amt: 9_000, certified_amt: 9_000, retention_amt: 0, status_name: 'Cancelled' }),
    ], contractors)
    expect(p.billedGross).toBe(100)
    expect(p.bills).toBe(1)
  })

  it('never reports a negative balance on an over-billed work order', () => {
    const [p] = buildPickList([wo({ wo_gross_value: 1000 })], [cert({ gross_bill_amt: 1500 })], contractors)
    expect(p.balance).toBe(0)
  })

  it('drops work orders with no number and puts the newest first', () => {
    const list = buildPickList([
      wo({ wo_id: 1, display_no: 'WO/SRASSK/A/1' }),
      wo({ wo_id: 9, display_no: 'WO/SRASSK/A/9' }),
      wo({ wo_id: 5, display_no: null }),
    ], [], contractors)
    expect(list.map(p => p.woId)).toEqual([9, 1])
  })

  it('leaves the contractor blank rather than guessing when the party is unknown', () => {
    expect(buildPickList([wo({ contractor_id: 999 })], [], contractors)[0].contractor).toBe('')
  })
})
