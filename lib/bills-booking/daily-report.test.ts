import { describe, it, expect } from 'vitest'
import { buildDailyReport, istDay, type ReportBillInput } from './daily-report'

const bill = (o: Partial<ReportBillInput>): ReportBillInput => ({
  id: 'b', serial: 'WCE-1', vendor: 'Desai Construction Pvt Ltd.', project: 'Welcome Centre Extension', billNo: 'SRASSK-MS-WC-03',
  trust: 'SRASSK', amount: 245897, events: [], mark: null, ...o,
})
// IST 13 Oct 2026, mid-afternoon, as UTC.
const at = (day: string, hhmm = '10:00') => `${day}T${hhmm}:00+05:30`

describe('the Daily Bills Report from Bills Approval', () => {
  it('lists what reached Paid that day, and what is at each trust that evening', () => {
    const r = buildDailyReport([
      bill({ id: 'p', events: [{ to: 'trust', at: at('2026-10-09'), amount: null }, { to: 'paid', at: at('2026-10-13', '16:00'), amount: 237000 }] }),
      bill({ id: 't1', events: [{ to: 'atm_in4', at: at('2026-10-05'), amount: null }, { to: 'trust', at: at('2026-10-06'), amount: null }] }),
      bill({ id: 't2', trust: 'SRET', vendor: 'Crony Electricals', amount: 1393480, events: [{ to: 'trust', at: at('2026-10-11'), amount: null }] }),
      bill({ id: 'early', events: [{ to: 'ct_billing', at: at('2026-10-12'), amount: null }] }),
    ], '2026-10-13')
    expect(r.paid.map(x => [x.id, x.amount])).toEqual([['p', 237000]])
    expect(r.groups.map(g => [g.trust, g.dateLabel, g.rows.map(x => x.id)])).toEqual([
      ['SRET', 'Courier', ['t2']],
      ['SRASSK', 'Submission', ['t1']],
    ])
    expect(r.groups[1].rows[0]).toMatchObject({ date: '2026-10-06', dateIsDefault: true, days: 7 })
    expect(r.atTrustTotal).toBe(1393480 + 245897)
  })

  it('uses the courier / submission date CT Billing typed, and its remark', () => {
    const r = buildDailyReport([
      bill({ events: [{ to: 'trust', at: at('2026-10-06') }].map(e => ({ ...e, amount: null })),
             mark: { sentDate: '2026-10-08', remark: 'Under A/c -Process', trust: null } }),
    ], '2026-10-13')
    expect(r.groups[0].rows[0]).toMatchObject({ date: '2026-10-08', dateIsDefault: false, days: 5, remark: 'Under A/c -Process' })
  })

  it('reads a past day as it was that evening, not as it is now', () => {
    const b = bill({ events: [{ to: 'trust', at: at('2026-10-06'), amount: null }, { to: 'paid', at: at('2026-10-13'), amount: 1 }] })
    expect(buildDailyReport([b], '2026-10-10').groups[0].rows[0].days).toBe(4)
    expect(buildDailyReport([b], '2026-10-05').groups).toEqual([])
  })

  it('puts a bill with no known trust under "Trust not set", until one is chosen', () => {
    const ev = [{ to: 'trust', at: at('2026-10-12'), amount: null }]
    expect(buildDailyReport([bill({ trust: null, events: ev })], '2026-10-13').groups[0].trust).toBe('—')
    expect(buildDailyReport([bill({ trust: null, events: ev, mark: { sentDate: null, remark: null, trust: 'SRAH' } })], '2026-10-13').groups[0].trust).toBe('SRAH')
  })

  it('takes the Indian calendar day, not the UTC one', () => {
    expect(istDay('2026-10-13T20:00:00Z')).toBe('2026-10-14')
  })
})
