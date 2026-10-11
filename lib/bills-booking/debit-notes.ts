// IN4's contractor debit notes on one work order, for the bill screen
// (Aksha, 11 Oct 2026: "there will be Debit note in IN4 which also comes - so
// how can u incorporate that" — then "Debit note is not necessary all bills
// have - so plan accordingly"). Nothing here when the order has none.
//
// Read from the mirror of ENGG_WO_DEBIT_NOTE (the order being debited is
// DEBIT_TO_WO_ID) and ENGG_WO_PAYMENT_DEBIT_NOTE_RECOVERY (which certificate
// recovered how much). Cancelled notes are left out — they were never owed.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface DebitNoteRow {
  id: number; display_no: string | null; amount: number; status_name: string | null
  note_type: string | null; reason: string | null; remarks: string | null; note_date: string | null
}
export interface DebitRecoveryRow { debit_note_id: number; certificate_id: number | null; deducted_amt: number }
export interface CertRef { certificate_id: number; display_no: string | null; invoice_no: string | null }

export interface DebitNote {
  id: number
  no: string
  date: string | null
  reason: string | null
  type: string | null
  remarks: string | null
  amount: number
  recovered: number
  balance: number
  /** Raised but not yet approved in IN4 (status Verify). */
  pending: boolean
  /** The bills that recovered it, in words: "ENP/… (bill SR-70) ₹32,147". */
  recoveredOn: Array<{ certNo: string | null; billNo: string | null; amount: number }>
}

export interface DebitNotes {
  notes: DebitNote[]
  raised: number
  recovered: number
  /** Still to be taken back from this contractor on this order. */
  open: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function buildDebitNotes(notes: DebitNoteRow[], recoveries: DebitRecoveryRow[], certs: CertRef[]): DebitNotes {
  const certBy = new Map(certs.map(c => [c.certificate_id, c]))
  const live = notes.filter(n => (n.status_name ?? '').toLowerCase() !== 'cancelled')
  const out: DebitNote[] = live.map(n => {
    const mine = recoveries.filter(r => r.debit_note_id === n.id && r.deducted_amt > 0)
    const recovered = r2(mine.reduce((s, r) => s + r.deducted_amt, 0))
    return {
      id: n.id,
      no: n.display_no ?? `Debit note ${n.id}`,
      date: n.note_date,
      reason: n.reason,
      type: n.note_type,
      remarks: n.remarks?.trim() || null,
      amount: r2(n.amount),
      recovered,
      balance: r2(Math.max(0, n.amount - recovered)),
      pending: (n.status_name ?? '').toLowerCase() === 'verify',
      recoveredOn: mine.map(r => {
        const c = r.certificate_id != null ? certBy.get(r.certificate_id) : undefined
        return { certNo: c?.display_no ?? null, billNo: c?.invoice_no ?? null, amount: r2(r.deducted_amt) }
      }),
    }
  })
  // Oldest first — the order they were raised in.
  out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id - b.id)
  return {
    notes: out,
    raised: r2(out.reduce((s, n) => s + n.amount, 0)),
    recovered: r2(out.reduce((s, n) => s + n.recovered, 0)),
    open: r2(out.reduce((s, n) => s + n.balance, 0)),
  }
}

/** Null when the order has no debit note — the screen then shows nothing. */
export async function loadDebitNotes(sb: SupabaseClient, woNo: string | null): Promise<DebitNotes | null> {
  if (!woNo?.trim()) return null
  const { data: wo } = await sb.from('in4_work_orders').select('wo_id').eq('display_no', woNo.trim()).maybeSingle()
  if (!wo) return null
  const { data: notes } = await sb.from('in4_wo_debit_notes')
    .select('id, display_no, amount, status_name, note_type, reason, remarks, note_date').eq('wo_id', wo.wo_id as number)
  if (!notes?.length) return null
  const ids = notes.map(n => n.id as number)
  const { data: rec } = await sb.from('in4_wo_debit_note_recoveries')
    .select('debit_note_id, certificate_id, deducted_amt').in('debit_note_id', ids)
  const certIds = [...new Set((rec ?? []).map(r => r.certificate_id).filter((v): v is number => typeof v === 'number'))]
  const { data: certs } = certIds.length
    ? await sb.from('in4_wo_certificates').select('certificate_id, display_no, invoice_no').in('certificate_id', certIds)
    : { data: [] }
  const built = buildDebitNotes(
    notes.map(n => ({ ...n, amount: Number(n.amount ?? 0) })) as DebitNoteRow[],
    (rec ?? []).map(r => ({ ...r, deducted_amt: Number(r.deducted_amt ?? 0) })) as DebitRecoveryRow[],
    (certs ?? []) as CertRef[],
  )
  return built.notes.length ? built : null
}

/** How much of THIS certificate's recoveries were debit notes — for the
 *  "How this bill adds up" line. 0 when none. */
export async function debitRecoveredOn(sb: SupabaseClient, certificateId: number | null): Promise<number> {
  if (certificateId == null) return 0
  const { data } = await sb.from('in4_wo_debit_note_recoveries').select('deducted_amt').eq('certificate_id', certificateId)
  return r2((data ?? []).reduce((s, r) => s + Number(r.deducted_amt ?? 0), 0))
}
