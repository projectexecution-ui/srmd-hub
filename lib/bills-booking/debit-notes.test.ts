import { describe, it, expect } from 'vitest'
import { buildDebitNotes } from './debit-notes'

/** Real IN4 debit notes, read 11 Oct 2026 — WO 1942 (P2ST): WDN…/30 ₹32,147
 *  recovered in full on ENP/SRASSK/P2ST/2026-27/240 (bill SR-26-27-70), and
 *  WDN…/34 ₹4,05,511 raised 1 Oct and not yet recovered from any bill. */
const notes = [
  { id: 214, display_no: 'WDNSRASSK/P2ST/2026-27/30', amount: 32147, status_name: 'Processed', note_type: 'Direct Debit', reason: 'Settlement', remarks: 'Basic Rate Diff of cement', note_date: '2026-09-09' },
  { id: 219, display_no: 'WDNSRASSK/P2ST/2026-27/34', amount: 405511, status_name: 'Processed', note_type: 'Direct Debit', reason: 'Settlement', remarks: 'Basic rate diffrence of Cement & Steel', note_date: '2026-10-01' },
  { id: 300, display_no: 'WDN/CANCELLED', amount: 99999, status_name: 'Cancelled', note_type: null, reason: null, remarks: null, note_date: '2026-08-01' },
]
const recoveries = [{ debit_note_id: 214, certificate_id: 3133, deducted_amt: 32147 }]
const certs = [{ certificate_id: 3133, display_no: 'ENP/SRASSK/P2ST/2026-27/240', invoice_no: 'SR-26-27-70' }]

describe('debit notes on a work order', () => {
  const d = buildDebitNotes(notes, recoveries, certs)

  it('leaves a cancelled note out — it was never owed', () => {
    expect(d.notes.map(n => n.id)).toEqual([214, 219])
  })

  it('shows what each recovered, on which bill, and what is still open', () => {
    const [cement, steel] = d.notes
    expect(cement.recovered).toBe(32147)
    expect(cement.balance).toBe(0)
    expect(cement.recoveredOn).toEqual([{ certNo: 'ENP/SRASSK/P2ST/2026-27/240', billNo: 'SR-26-27-70', amount: 32147 }])
    expect(steel.recovered).toBe(0)
    expect(steel.balance).toBe(405511)
  })

  it('totals raised, recovered and still to recover', () => {
    expect(d.raised).toBe(437658)
    expect(d.recovered).toBe(32147)
    expect(d.open).toBe(405511)
  })

  it('marks a note IN4 has not approved yet', () => {
    const v = buildDebitNotes([{ ...notes[0], status_name: 'Verify' }], [], [])
    expect(v.notes[0].pending).toBe(true)
  })
})
