// A purchase order's supplier ledger — the PO twin of loadWoLedger.
//
// Two lists, both live from IN4: what was RECEIVED against the order (its
// GRNs, with the running quantity and value) and what was BILLED and PAID for
// those receipts (supplier certificates, in date order, with the running
// "still to pay"). Advances come from the mirror, the same rows the tree uses.
//
// Bills are placed under the order by their GRN, never by the certificate's
// own PO_ID. IN4 let PO/SRASSK/NGH/2025-26/92's only bill (certificate 1223,
// GRN 1273) be booked under PO 93's certificate, so PO 92 showed nothing paid
// while PO 93 showed a payment it never ordered. The GRN says whose material
// it was; when the two disagree the row names where IN4 booked it.
//
// Money rule as everywhere in the tree: money out = payment + TDS (counted as
// paid) + advances as paid; retention is held separately; still to pay =
// Ordered (with GST) − money out − retention.

import { createClient } from '@/lib/supabase/server'
import { cleanBillNo } from '@/lib/revamp/orders-tree'

export interface PoGrnIn {
  grnId: number; grnNo: string | null; date: string | null; challan: string | null
  material: string | null; uom: string | null; qty: number; value: number
}
export interface PoGrnRow extends PoGrnIn { cumQty: number; cumValue: number }

export interface PoBillIn {
  certificateId: number; certificateNo: string | null; certificateDate: string | null
  invoiceNo: string | null; invoiceDate: string | null; status: string | null
  /** The PO the certificate itself was booked under, and its number. */
  billPoId: number; billPoNo: string | null
  landed: number; certified: number; paid: number; tds: number; retention: number; advanceRecovered: number
}

/** An advance certificate as the mirror holds it (in4_supplier_certificates,
 *  kind 'advance'). The mirror carries no date for it. */
export interface PoAdvanceIn {
  certificateId: number; certificateNo: string | null; status: number | null
  landed: number; paid: number; tds: number; retention: number; advanceRecovered: number
}

export interface PoLedgerRow {
  id: string
  /** ISO date (yyyy-mm-dd) or null. */
  date: string | null
  kind: 'bill' | 'advance'
  /** The supplier's invoice number as written, else IN4's certificate number. */
  ref: string
  certificateNo: string | null
  status: 'live' | 'cancelled' | 'rejected'
  statusName: string | null
  /** Set when IN4 booked this bill under another PO's number. */
  bookedUnder: string | null
  gross: number
  certified: number
  tds: number
  retention: number
  advanceRecovered: number
  paid: number
  paidOut: number
  stillToPay: number
}

export interface PoLedger {
  grns: PoGrnRow[]
  rows: PoLedgerRow[]
  totals: {
    receivedQty: number; receivedValue: number
    billed: number; paid: number; tds: number; retention: number
    advancePaid: number; advanceRecovered: number; paidOut: number
  }
}

const ADV_EXCLUDED = new Set([3, 6])

/** Pure, so PO 92/93 is a test rather than a rediscovery. */
export function buildPoLedger(ordered: number, poId: number, grns: readonly PoGrnIn[], bills: readonly PoBillIn[], advances: readonly PoAdvanceIn[]): PoLedger {
  let cumQty = 0, cumValue = 0
  const grnRows: PoGrnRow[] = [...grns]
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || a.grnId - b.grnId)
    .map(g => { cumQty += g.qty; cumValue += g.value; return { ...g, cumQty, cumValue } })

  const t: PoLedger['totals'] = {
    receivedQty: cumQty, receivedValue: cumValue,
    billed: 0, paid: 0, tds: 0, retention: 0, advancePaid: 0, advanceRecovered: 0, paidOut: 0,
  }

  // Advances first (they precede the bills they are recovered from, and the
  // mirror holds no date for them), then bills by invoice date.
  const entries: Omit<PoLedgerRow, 'paidOut' | 'stillToPay'>[] = [
    ...advances.map(a => ({
      id: `adv:${a.certificateId}`, date: null, kind: 'advance' as const,
      ref: 'Advance', certificateNo: a.certificateNo,
      status: (a.status === 6 ? 'cancelled' : a.status === 3 ? 'rejected' : 'live') as PoLedgerRow['status'],
      statusName: null, bookedUnder: null,
      gross: a.landed || a.paid + a.tds, certified: a.landed || a.paid + a.tds,
      tds: a.tds, retention: a.retention, advanceRecovered: a.advanceRecovered, paid: a.paid,
    })),
    ...[...bills]
      .sort((a, b) => String(a.invoiceDate ?? a.certificateDate ?? '').localeCompare(String(b.invoiceDate ?? b.certificateDate ?? '')) || a.certificateId - b.certificateId)
      .map(b => ({
        id: `cert:${b.certificateId}`, date: b.invoiceDate ?? b.certificateDate, kind: 'bill' as const,
        ref: cleanBillNo(b.invoiceNo) ?? (b.certificateNo ? `Cert ${b.certificateNo}` : '—'),
        certificateNo: b.certificateNo,
        status: 'live' as const, statusName: b.status,
        bookedUnder: b.billPoId !== poId && b.billPoNo ? b.billPoNo : null,
        gross: b.landed, certified: b.certified, tds: b.tds, retention: b.retention,
        advanceRecovered: b.advanceRecovered, paid: b.paid,
      })),
  ]

  let paidOutRun = 0, retentionRun = 0
  const rows: PoLedgerRow[] = entries.map(e => {
    const live = e.status === 'live'
    const paidOut = live ? e.paid + e.tds : 0
    if (live) {
      paidOutRun += paidOut
      retentionRun += e.retention
      t.paidOut += paidOut; t.paid += e.paid; t.tds += e.tds; t.retention += e.retention
      t.advanceRecovered += e.advanceRecovered
      if (e.kind === 'advance') t.advancePaid += paidOut; else t.billed += e.gross
    }
    return { ...e, paidOut, stillToPay: ordered - paidOutRun - retentionRun }
  })
  return { grns: grnRows, rows, totals: t }
}

const iso = (v: unknown): string | null => {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  const s = d.toISOString().slice(0, 10)
  return s.startsWith('1900-01-01') ? null : s
}
const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())

/** One purchase order's ledger, from the mirror. Null when there is no such
  *  order. */
export async function loadPoLedger(poId: number): Promise<{ poId: number; ref: string; party: string | null; ordered: number; headerPaid: number; ledger: PoLedger } | null> {
  const supabase = await createClient()
  // Four reads, all local now, so they go together rather than in a chain.
  const [hdrRes, grnRes, billRes, adv] = await Promise.all([
    supabase.rpc('in4_po_ledger_header', { p_po_id: poId }),
    supabase.rpc('in4_po_ledger_grns', { p_po_id: poId }),
    supabase.rpc('in4_po_ledger_bills', { p_po_id: poId }),
    supabase.from('in4_supplier_certificates')
      .select('certificate_id, certificate_no, status, landed_cost, paid, tax_deduction, retention, adv_recovery')
      .eq('kind', 'advance').eq('po_id', poId),
  ])
  const hdr = ((hdrRes.data ?? []) as Array<Record<string, unknown>>)[0]
  if (!hdr) return null
  const grns = (grnRes.data ?? []) as Array<Record<string, unknown>>
  const bills = (billRes.data ?? []) as Array<Record<string, unknown>>

  const ledger = buildPoLedger(
    n(hdr.po_value), poId,
    grns.map(g => ({
      grnId: n(g.grn_id), grnNo: s(g.grn_no), date: iso(g.grn_dt), challan: s(g.challan),
      material: s(g.material), uom: s(g.uom), qty: n(g.qty), value: n(g.value),
    })),
    bills.map(b => ({
      certificateId: n(b.certificate_id), certificateNo: s(b.cert_no), certificateDate: iso(b.cert_dt),
      invoiceNo: s(b.invoice_no), invoiceDate: iso(b.invoice_dt), status: s(b.status_name),
      billPoId: n(b.bill_po_id), billPoNo: s(b.bill_po_no),
      landed: n(b.landed), certified: n(b.certified), paid: n(b.paid), tds: n(b.tds),
      retention: n(b.retention), advanceRecovered: n(b.adv_recovery),
    })),
    (adv.data ?? []).map(a => ({
      certificateId: n(a.certificate_id), certificateNo: s(a.certificate_no), status: a.status == null ? null : Number(a.status),
      landed: n(a.landed_cost), paid: n(a.paid), tds: n(a.tax_deduction), retention: n(a.retention), advanceRecovered: n(a.adv_recovery),
    })),
  )
  return { poId, ref: s(hdr.po_no) ?? `PO ${poId}`, party: s(hdr.supplier), ordered: n(hdr.po_value), headerPaid: n(hdr.paid_amt), ledger }
}
