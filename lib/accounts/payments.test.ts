import { describe, it, expect } from 'vitest'
import {
  buildPayments, foldDuplicates, fyOf, fyMonths, rollupByFy, rollupByMonth, buildPartyLedger, tallyBalance, parsePaymentId, paymentId,
  type WoCertRow, type SupCertRow, type Confirmation,
} from './payments'

// Desai Construction on NGH B, straight from in4_wo_certificates on 11 Sep 2026.
const wo = (o: Partial<WoCertRow> & { certificate_id: number }): WoCertRow => ({
  kind: 'certificate', certificate_type: 'Running', status: 1, contractor_id: 77, contractor_name: 'Desai Construction Pvt Ltd.',
  wo_id: 270, wo_no: 'WO/SRASSK/NGH/2024-25/270', invoice_no: null, invoice_date: null, creation_dt: null,
  gross_bill_amt: 0, deductions: 0, recoveries: 0, retention_amt: 0, paid_amt: 0, outstanding_amt: 0, ...o,
})
const DESAI: WoCertRow[] = [
  wo({ certificate_id: 1, certificate_type: 'Advance', kind: 'advance', invoice_no: 'SRASSK-GHB/PI-1', invoice_date: '2025-01-15', gross_bill_amt: 5900000, paid_amt: 5900000 }),
  wo({ certificate_id: 2, invoice_no: 'SRASSK-GHB/10', invoice_date: '2026-02-02', gross_bill_amt: 3639030, recoveries: 736350, paid_amt: 2902680, outstanding_amt: 0 }),
  wo({ certificate_id: 3, status: 6, invoice_no: 'SRASSK-GHB/10', invoice_date: '2026-02-02', gross_bill_amt: 3639030, recoveries: 736350, paid_amt: 0, outstanding_amt: 2902680 }), // IN4's cancelled twin
  wo({ certificate_id: 4, invoice_no: 'SRASSK-GHB-12', invoice_date: '2026-05-20', gross_bill_amt: 6388031, recoveries: 541359, retention_amt: 1909487, paid_amt: 3937185 }),
]
const KASTURI = wo({ certificate_id: 9, contractor_id: 88, contractor_name: 'Kasturi Projects Pvt Ltd', wo_id: 271, wo_no: 'WO/SRASSK/NGH/2025-26/271', invoice_no: 'KP362SERT20', invoice_date: '2026-08-06', gross_bill_amt: 727237, retention_amt: 61630, paid_amt: 653282 })
const SUP: SupCertRow[] = [
  { certificate_id: 501, kind: 'payment', certificate_no: '1187', status: 15, supplier_id: 5, supplier_name: 'Ambuja Cement', po_id: 3301, category: 'Cement', certified_amt: 120000, landed_cost: 141600, tax_deduction: 0, adv_recovery: 0, debit_note_adj: 0, retention: 0, payable: 141600, paid: 141600, outstanding: 0 },
]
// A genuine repeat, as IN4 has for Sankalp Interino: the same advance twice, both live, both paid.
const TWICE: WoCertRow[] = [
  wo({ certificate_id: 203, contractor_id: 55, contractor_name: 'Sankalp Interino', wo_id: 210, wo_no: 'WO/SRASSK/OSH/2025-26/210', certificate_type: 'Advance', kind: 'advance', invoice_no: '15 (1)', invoice_date: '2025-10-06', gross_bill_amt: 25665, paid_amt: 25665 }),
  wo({ certificate_id: 212, contractor_id: 55, contractor_name: 'Sankalp Interino', wo_id: 210, wo_no: 'WO/SRASSK/OSH/2025-26/210', certificate_type: 'Advance', kind: 'advance', invoice_no: '15 (1)', invoice_date: '2025-10-06', gross_bill_amt: 25665, paid_amt: 25665 }),
]

describe('payments: what money left, folded to the truth', () => {
  it('lists only money out, newest first, with IN4 dates until the Trust confirms', () => {
    const book = buildPayments([...DESAI, KASTURI], SUP, [])
    expect(book.payments.map(p => p.id)).toEqual(['WO-9', 'WO-4', 'WO-2', 'WO-1', 'SUP-501'])
    expect(book.payments[0].date).toBe('2026-08-06')
    expect(book.payments[0].bankDate).toBeNull()
    // A supplier payment the mirror has not dated yet sits under "date unknown"…
    expect(book.payments.at(-1)!.date).toBeNull()
    expect(book.totals.undatedPaid).toBe(141600)
    // …and takes IN4's invoice date once the feed has copied it.
    const dated = buildPayments([], [{ ...SUP[0], invoice_date: '2026-03-14', certificate_date: '2026-03-20' }], [])
    expect(dated.payments[0].date).toBe('2026-03-14')
    expect(dated.totals.undatedPaid).toBe(0)
  })

  it('leaves cancelled certificates out of the true figures and counts them; the raw toggle shows them', () => {
    const book = buildPayments(DESAI, [], [])
    expect(book.cancelled).toBe(1)
    expect(book.duplicates).toEqual([])
    expect(book.bills.map(b => b.id)).not.toContain('WO-3')
    const raw = buildPayments(DESAI, [], [], { raw: true })
    expect(raw.bills.find(b => b.id === 'WO-3')!.cancelled).toBe(true)
  })

  it('folds a bill IN4 genuinely lists twice to one, keeps the paid row, and says so', () => {
    const book = buildPayments(TWICE, [], [])
    expect(book.duplicates).toHaveLength(1)
    expect(book.duplicates[0].kept.id).toBe('WO-203')
    expect(book.duplicates[0].dropped.map(d => d.id)).toEqual(['WO-212'])
    expect(book.totals.paid).toBe(25665)
    expect(buildPayments(TWICE, [], [], { raw: true }).totals.paid).toBe(51330)
  })

  it('never folds an advance and a final bill that happen to share a number and amount', () => {
    const adv = wo({ certificate_id: 44, certificate_type: 'Advance', kind: 'advance', invoice_no: '0100', invoice_date: '2024-07-05', gross_bill_amt: 1593, paid_amt: 1593 })
    const fin = wo({ certificate_id: 717, certificate_type: 'Final', invoice_no: '0100', invoice_date: '2024-10-30', gross_bill_amt: 1593, paid_amt: 0 })
    expect(buildPayments([adv, fin], [], []).duplicates).toEqual([])
  })

  it('does not fold different bills that merely share a number with a different amount', () => {
    const a = wo({ certificate_id: 21, invoice_no: 'X/1', gross_bill_amt: 100, paid_amt: 100 })
    const b = wo({ certificate_id: 22, invoice_no: 'X/1', gross_bill_amt: 250, paid_amt: 250 })
    expect(foldDuplicates(buildPayments([a, b], [], [], { raw: true }).bills).groups).toEqual([])
  })

  it('switches a payment to the bank date once the Trust confirms it, and counts it as confirmed', () => {
    const conf: Confirmation[] = [{ source: 'wo', certificate_id: 4, bank_date: '2026-05-23', bank_ref: 'UTR 88123', amount_in_books: 3937185, status: 'confirmed', remark: null }]
    const book = buildPayments(DESAI, [], conf)
    const p = book.payments.find(x => x.id === 'WO-4')!
    expect(p.bankDate).toBe('2026-05-23'); expect(p.date).toBe('2026-05-23'); expect(p.billDate).toBe('2026-05-20')
    expect(book.totals.confirmedPaid).toBe(3937185)
    expect(book.totals.awaitingPaid).toBe(book.totals.paid - 3937185)
  })

  it('does not treat "not found" or "differs" as a confirmation', () => {
    const conf: Confirmation[] = [{ source: 'wo', certificate_id: 4, bank_date: '2026-05-23', bank_ref: null, amount_in_books: 3900000, status: 'differs', remark: 'TDS' }]
    expect(buildPayments(DESAI, [], conf).payments.find(x => x.id === 'WO-4')!.bankDate).toBeNull()
  })

  it('round-trips the CT Hub ID the Trust file carries', () => {
    expect(parsePaymentId(paymentId('wo', 4471))).toEqual({ source: 'wo', certificateId: 4471 })
    expect(parsePaymentId('sup-118 ')).toEqual({ source: 'supplier', certificateId: 118 })
    expect(parsePaymentId('nonsense')).toBeNull()
  })
})

describe('FY and month roll-ups', () => {
  it('uses the Indian FY, April to March', () => {
    expect(fyOf('2026-03-31')).toBe('2025-26')
    expect(fyOf('2026-04-01')).toBe('2026-27')
    expect(fyOf(null)).toBeNull()
    expect(fyMonths('2026-27')[0]).toBe('2026-04'); expect(fyMonths('2026-27')[11]).toBe('2027-03')
  })
  it('rolls up newest FY first with "date unknown" last', () => {
    const rows = rollupByFy(buildPayments([...DESAI, KASTURI], SUP, []).payments)
    expect(rows.map(r => r.fy)).toEqual(['2026-27', '2025-26', '2024-25', null])
    expect(rows[0].paid).toBe(653282 + 3937185)
    expect(rows[3].paid).toBe(141600)
  })
  it('fills every month of the FY with a running total', () => {
    const rows = rollupByMonth(buildPayments([...DESAI, KASTURI], [], []).payments, '2026-27')
    expect(rows).toHaveLength(12)
    expect(rows.find(r => r.month === '2026-05')!.paid).toBe(3937185)
    expect(rows.find(r => r.month === '2026-08')!.running).toBe(3937185 + 653282)
    expect(rows.find(r => r.month === '2027-03')!.running).toBe(3937185 + 653282)
  })
})

describe('party ledger in Tally format', () => {
  const book = buildPayments(DESAI, [], [])
  it('credits the bill, debits retention, recoveries and the payment, and returns the balance to what was owed', () => {
    const l = buildPartyLedger(book.bills, 'Desai Construction Pvt Ltd.', '2026-27', 1)
    // Opening = everything before 1 Apr 2026: advance −59,00,000 (Dr); bill 10: +36,39,030 −7,36,350 −29,02,680 = 0.
    expect(l.opening).toBe(-5900000)
    expect(l.lines.map(x => [x.vchType, x.debit || x.credit])).toEqual([
      ['Purchase', 6388031], ['Journal', 1909487], ['Journal', 541359], ['Payment', 3937185],
    ])
    expect(l.closing).toBe(-5900000) // bill 12 fully settled: gross = retention + recoveries + paid
    expect(l.lines.every(x => x.vchNo === 'SRASSK-GHB-12')).toBe(true)
    expect(l.duplicatesFolded).toBe(1)
    expect(l.totals.bills).toBe(6388031); expect(l.totals.paid).toBe(3937185); expect(l.totals.retention).toBe(1909487)
  })
  it('reads an advance as a debit that bills later absorb', () => {
    const l = buildPartyLedger(book.bills, 'Desai Construction Pvt Ltd.', null)
    expect(l.opening).toBe(0)
    expect(l.lines[0]).toMatchObject({ vchType: 'Payment', debit: 5900000, balance: -5900000 })
    expect(tallyBalance(l.lines[0].balance)).toBe('59,00,000 Dr')
    expect(tallyBalance(273236)).toBe('2,73,236 Cr')
    expect(tallyBalance(0)).toBe('0')
  })
})
