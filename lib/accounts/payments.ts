// The Accounts tab's payment ledger — pure.
//
// Aksha, 11 Sep 2026 (mind-map, "Accounts"): every payment made on a project,
// date-wise, rolled up FY-wise and month-wise; reconciled with the Trust's
// books; and party ledgers in Tally format. Two rules she set:
//   • the DATE of a payment is the Trust's BANK date once the Trust has
//     confirmed it; until then IN4's bill date stands in, marked as such;
//   • figures are TRUE by default — IN4's duplicate certificates are folded
//     to one and flagged — with a toggle to see IN4 exactly as it is.
//
// Money comes from the IN4 certificate mirrors (in4_wo_certificates,
// in4_supplier_certificates). Nothing here writes anywhere.

export type Source = 'wo' | 'supplier'

export interface WoCertRow {
  certificate_id: number; kind: string | null; certificate_type: string | null; status: number | null
  contractor_id: number | null; contractor_name: string | null
  wo_id: number | null; wo_no: string | null
  invoice_no: string | null; invoice_date: string | null; creation_dt: string | null
  gross_bill_amt: number | null; deductions: number | null; recoveries: number | null
  retention_amt: number | null; paid_amt: number | null; outstanding_amt: number | null
}
export interface SupCertRow {
  certificate_id: number; kind: string | null; certificate_no: string | null; status: number | null
  supplier_id: number | null; supplier_name: string | null; po_id: number | null; category: string | null
  /** From IN4's DIM_PURCHASE_SUPPLIER_PAY since 11 Sep 2026; null on advances and until the next sync. */
  certificate_date?: string | null; invoice_date?: string | null
  certified_amt: number | null; landed_cost: number | null; tax_deduction: number | null
  adv_recovery: number | null; debit_note_adj: number | null; retention: number | null
  payable: number | null; paid: number | null; outstanding: number | null
}
export type ConfirmationStatus = 'confirmed' | 'not_found' | 'differs' | 'explained'
export interface Confirmation {
  source: Source; certificate_id: number
  bank_date: string | null; bank_ref: string | null; amount_in_books: number | null
  status: ConfirmationStatus; remark: string | null
}

export interface Payment {
  /** CT Hub ID — what the Trust's file carries back. WO-4471, SUP-118. */
  id: string
  source: Source
  certificateId: number
  party: string
  partyId: number | null
  /** The work order number, or "PO #id" when IN4's mirror has no number. */
  against: string | null
  billNo: string | null
  /** Running · Final · Advance · Misc · Retention · Supplier · Supplier advance … */
  kind: string
  /** IN4's date — the bill or certificate date. Null for supplier payments (IN4 keeps none). */
  billDate: string | null
  /** The Trust's bank date, once confirmed. */
  bankDate: string | null
  /** The date the list sorts and groups by: bank date if known, else bill date. */
  date: string | null
  gross: number
  /** TDS and other cuts plus advance / debit-note recoveries. */
  deductions: number
  retention: number
  paid: number
  outstanding: number
  confirmation: Confirmation | null
  /** Set on IN4 rows folded into another because they are the same bill twice. */
  duplicateOf: string | null
  /** IN4 status 6. Left out of the true figures; visible with the raw toggle. */
  cancelled: boolean
}

/** IN4's cancelled status — the same value lib/in4/contractor.ts and supplier.ts drop from the reports. */
export const CANCELLED_STATUS = 6

export interface DuplicateGroup { kept: Payment; dropped: Payment[] }

export interface PaymentsBook {
  /** Money out only (paid > 0), newest first, duplicates folded unless raw. */
  payments: Payment[]
  /** Every certificate after folding, paid or not — the ledgers read these. */
  bills: Payment[]
  duplicates: DuplicateGroup[]
  totals: { paid: number; contractorPaid: number; supplierPaid: number; confirmedPaid: number; awaitingPaid: number; undatedPaid: number; count: number }
  /** Cancelled certificates IN4 still lists (status 6). Out of the true figures. */
  cancelled: number
}

const n = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const day = (v: string | null | undefined): string | null => (v ? String(v).slice(0, 10) : null)
const normBill = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export const paymentId = (source: Source, certificateId: number): string => `${source === 'wo' ? 'WO' : 'SUP'}-${certificateId}`
export function parsePaymentId(id: string): { source: Source; certificateId: number } | null {
  const m = /^(WO|SUP)-(\d+)$/i.exec(String(id ?? '').trim())
  if (!m) return null
  return { source: m[1].toUpperCase() === 'WO' ? 'wo' : 'supplier', certificateId: Number(m[2]) }
}

function fromWo(r: WoCertRow, conf: Confirmation | null): Payment {
  const billDate = day(r.invoice_date) ?? day(r.creation_dt)
  const bankDate = conf?.status === 'confirmed' || conf?.status === 'explained' ? day(conf.bank_date) : null
  return {
    id: paymentId('wo', r.certificate_id), source: 'wo', certificateId: r.certificate_id,
    party: r.contractor_name?.trim() || '(no party named in IN4)', partyId: r.contractor_id,
    against: r.wo_no?.trim() || null, billNo: r.invoice_no?.trim() || null,
    kind: r.certificate_type?.trim() || (r.kind === 'advance' ? 'Advance' : r.kind === 'misc' ? 'Misc' : 'Running'),
    billDate, bankDate, date: bankDate ?? billDate,
    gross: n(r.gross_bill_amt), deductions: n(r.deductions) + n(r.recoveries), retention: n(r.retention_amt),
    paid: n(r.paid_amt), outstanding: n(r.outstanding_amt), confirmation: conf, duplicateOf: null, cancelled: r.status === CANCELLED_STATUS,
  }
}
function fromSup(r: SupCertRow, conf: Confirmation | null): Payment {
  const bankDate = conf?.status === 'confirmed' || conf?.status === 'explained' ? day(conf.bank_date) : null
  const billDate = day(r.invoice_date) ?? day(r.certificate_date)
  return {
    id: paymentId('supplier', r.certificate_id), source: 'supplier', certificateId: r.certificate_id,
    party: r.supplier_name?.trim() || '(no party named in IN4)', partyId: r.supplier_id,
    against: r.po_id ? `PO #${r.po_id}` : null, billNo: r.certificate_no?.trim() || null,
    kind: r.kind === 'advance' ? 'Supplier advance' : 'Supplier',
    billDate, bankDate, date: bankDate ?? billDate,
    gross: n(r.landed_cost) || n(r.certified_amt), deductions: n(r.tax_deduction) + n(r.adv_recovery) + n(r.debit_note_adj), retention: n(r.retention),
    paid: n(r.paid), outstanding: n(r.outstanding), confirmation: conf, duplicateOf: null, cancelled: r.status === CANCELLED_STATUS,
  }
}

/**
 * Most "duplicates" in IN4 are a cancelled certificate (status 6) beside the
 * one that replaced it — those are dropped before we get here. What remains
 * is the same bill genuinely listed twice (an advance recorded twice, a misc
 * bill re-entered): same party, same order, same bill number, same gross,
 * same kind of certificate. Keep the row that was paid (then the latest);
 * fold the rest and say so. An advance and a final bill sharing a number are
 * two different documents and are never folded.
 */
export function foldDuplicates(rows: Payment[]): { kept: Payment[]; groups: DuplicateGroup[] } {
  const byKey = new Map<string, Payment[]>()
  for (const p of rows) {
    const bill = normBill(p.billNo)
    if (!bill) { byKey.set(`solo:${p.id}`, [p]); continue }
    const family = /advance/i.test(p.kind) ? 'advance' : /misc/i.test(p.kind) ? 'misc' : 'bill'
    const key = `${p.source}|${p.partyId ?? p.party}|${p.against ?? ''}|${bill}|${Math.round(p.gross)}|${family}`
    byKey.set(key, [...(byKey.get(key) ?? []), p])
  }
  const kept: Payment[] = []
  const groups: DuplicateGroup[] = []
  for (const list of byKey.values()) {
    if (list.length === 1) { kept.push(list[0]); continue }
    const sorted = [...list].sort((a, b) => (b.paid - a.paid) || String(b.date ?? '').localeCompare(String(a.date ?? '')))
    const [keep, ...rest] = sorted
    for (const d of rest) d.duplicateOf = keep.id
    kept.push(keep)
    groups.push({ kept: keep, dropped: rest })
  }
  return { kept, groups }
}

export function buildPayments(
  wo: readonly WoCertRow[], sup: readonly SupCertRow[], confirmations: readonly Confirmation[],
  opts: { raw?: boolean } = {},
): PaymentsBook {
  const conf = new Map(confirmations.map(c => [paymentId(c.source, c.certificate_id), c]))
  const all = [
    ...wo.map(r => fromWo(r, conf.get(paymentId('wo', r.certificate_id)) ?? null)),
    ...sup.map(r => fromSup(r, conf.get(paymentId('supplier', r.certificate_id)) ?? null)),
  ]
  // True figures: cancelled certificates out, genuine repeats folded. Raw: IN4 as it is.
  const live = all.filter(p => !p.cancelled)
  const folded = foldDuplicates(live)
  const bills = opts.raw ? all : folded.kept
  const payments = bills.filter(p => p.paid > 0).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || b.paid - a.paid)
  const sum = (xs: Payment[], f: (p: Payment) => number) => xs.reduce((s, p) => s + f(p), 0)
  const confirmed = payments.filter(p => p.bankDate)
  return {
    payments, bills, duplicates: folded.groups, cancelled: all.length - live.length,
    totals: {
      paid: sum(payments, p => p.paid),
      contractorPaid: sum(payments.filter(p => p.source === 'wo'), p => p.paid),
      supplierPaid: sum(payments.filter(p => p.source === 'supplier'), p => p.paid),
      confirmedPaid: sum(confirmed, p => p.paid),
      awaitingPaid: sum(payments.filter(p => !p.bankDate), p => p.paid),
      undatedPaid: sum(payments.filter(p => !p.date), p => p.paid),
      count: payments.length,
    },
  }
}

/* ── FY and month roll-ups (Indian FY, April to March) ─────────────────────── */

/** '2026-27' for any date from 1 Apr 2026 to 31 Mar 2027; null when undated. */
export function fyOf(date: string | null): string | null {
  if (!date) return null
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7))
  if (!y || !m) return null
  const start = m >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
export const fyStartDate = (fy: string): string => `${fy.slice(0, 4)}-04-01`
export const fyEndDate = (fy: string): string => `${Number(fy.slice(0, 4)) + 1}-03-31`
/** The twelve month keys of an FY, April first. */
export function fyMonths(fy: string): string[] {
  const y = Number(fy.slice(0, 4))
  return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; const yy = m >= 4 ? y : y + 1; return `${yy}-${String(m).padStart(2, '0')}` })
}

export interface FyRow { fy: string | null; count: number; paid: number; confirmedPaid: number }
export function rollupByFy(payments: readonly Payment[]): FyRow[] {
  const m = new Map<string | null, FyRow>()
  for (const p of payments) {
    const fy = fyOf(p.date)
    const r = m.get(fy) ?? { fy, count: 0, paid: 0, confirmedPaid: 0 }
    r.count++; r.paid += p.paid; if (p.bankDate) r.confirmedPaid += p.paid
    m.set(fy, r)
  }
  // Newest FY first; "date unknown" last.
  return [...m.values()].sort((a, b) => (a.fy === null ? 1 : b.fy === null ? -1 : b.fy.localeCompare(a.fy)))
}
export interface MonthRow { month: string; count: number; paid: number; running: number }
export function rollupByMonth(payments: readonly Payment[], fy: string): MonthRow[] {
  const rows = fyMonths(fy).map(month => ({ month, count: 0, paid: 0, running: 0 }))
  const idx = new Map(rows.map((r, i) => [r.month, i]))
  for (const p of payments) {
    const key = p.date?.slice(0, 7)
    const i = key ? idx.get(key) : undefined
    if (i === undefined) continue
    rows[i].count++; rows[i].paid += p.paid
  }
  let run = 0
  for (const r of rows) { run += r.paid; r.running = run }
  return rows
}

/* ── Party ledger, Tally format ────────────────────────────────────────────── */

export interface LedgerLine {
  date: string | null
  particulars: string
  vchType: 'Purchase' | 'Journal' | 'Payment' | 'Receipt'
  vchNo: string
  debit: number
  credit: number
  /** Running balance; positive = credit (payable to the party), negative = debit (party owes, e.g. an advance). */
  balance: number
  paymentId: string
  /** The Trust's bank date drove this line's date. */
  bankDated?: boolean
}
export interface PartyLedger {
  party: string
  fy: string | null
  opening: number
  lines: LedgerLine[]
  closing: number
  totals: { debit: number; credit: number; bills: number; paid: number; retention: number }
  duplicatesFolded: number
}

/**
 * The gross bill CREDITS the party; retention, recoveries, deductions and the
 * payment DEBIT it (build order §8). An advance is a payment with no bill, so
 * it debits the party and the balance goes Dr until bills absorb it. Vch No is
 * IN4's invoice number — what reconciles to the paper bill.
 */
export function buildPartyLedger(bills: readonly Payment[], party: string, fy: string | null, duplicatesFolded = 0): PartyLedger {
  const mine = bills.filter(b => b.party === party).sort((a, b) => String(a.date ?? '9999').localeCompare(String(b.date ?? '9999')) || a.certificateId - b.certificateId)
  const from = fy ? fyStartDate(fy) : null, to = fy ? fyEndDate(fy) : null
  const events: Array<Omit<LedgerLine, 'balance'>> = []
  for (const b of mine) {
    const vch = b.billNo ?? b.id
    const isAdvance = /advance/i.test(b.kind)
    const d = b.date
    if (!isAdvance && b.gross > 0) events.push({ date: d, particulars: `To Purchase — ${b.kind} bill${b.against ? `, ${b.against}` : ''}`, vchType: 'Purchase', vchNo: vch, debit: 0, credit: b.gross, paymentId: b.id })
    if (b.retention > 0) events.push({ date: d, particulars: 'By Retention held', vchType: 'Journal', vchNo: vch, debit: b.retention, credit: 0, paymentId: b.id })
    if (b.deductions > 0) events.push({ date: d, particulars: isAdvance ? 'By Tax deducted' : 'By Recoveries and deductions (TDS, advance, debit notes)', vchType: 'Journal', vchNo: vch, debit: b.deductions, credit: 0, paymentId: b.id })
    if (b.paid > 0) events.push({ date: d, particulars: isAdvance ? `By Bank — advance${b.against ? `, ${b.against}` : ''}` : 'By Bank — payment against bill', vchType: 'Payment', vchNo: vch, debit: b.paid, credit: 0, paymentId: b.id, bankDated: !!b.bankDate })
  }
  let balance = 0
  const before = events.filter(e => from && (e.date ?? '') < from)
  for (const e of before) balance += e.credit - e.debit
  const opening = balance
  const inRange = events.filter(e => !from || ((e.date ?? '9999') >= from && (e.date ?? '') <= (to ?? '9999')))
  const lines: LedgerLine[] = inRange.map(e => { balance += e.credit - e.debit; return { ...e, balance } })
  const inBills = mine.filter(b => !from || ((b.date ?? '9999') >= from && (b.date ?? '') <= (to ?? '9999')))
  return {
    party, fy, opening, lines, closing: balance,
    totals: {
      debit: lines.reduce((s, l) => s + l.debit, 0), credit: lines.reduce((s, l) => s + l.credit, 0),
      bills: inBills.reduce((s, b) => s + (/advance/i.test(b.kind) ? 0 : b.gross), 0), paid: inBills.reduce((s, b) => s + b.paid, 0), retention: inBills.reduce((s, b) => s + b.retention, 0),
    },
    duplicatesFolded,
  }
}

/** "2,73,236 Cr" / "59,00,000 Dr" — Tally's way of showing a balance. */
export function tallyBalance(v: number): string {
  const a = Math.round(Math.abs(v)).toLocaleString('en-IN')
  return v === 0 ? '0' : `${a} ${v > 0 ? 'Cr' : 'Dr'}`
}
