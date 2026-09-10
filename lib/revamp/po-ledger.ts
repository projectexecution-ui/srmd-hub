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

import { in4Query, in4Config } from '@/lib/in4/db'
import { In4NotConfigured } from '@/lib/in4/wo-print'
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

/** One purchase order's ledger, live. Null when IN4 has no such order.
 *  Throws In4NotConfigured when the deployment has no IN4 login. */
export async function loadPoLedger(poId: number): Promise<{ poId: number; ref: string; party: string | null; ordered: number; headerPaid: number; ledger: PoLedger } | null> {
  if (!in4Config()) throw new In4NotConfigured()
  const [hdr] = await in4Query<Record<string, unknown>>(`
    SELECT h.PO_ID, h.PO_NO, h.PO_VALUE, h.PAID_AMT, COALESCE(sp.PrintName, sp.NAME) supplier
    FROM BI.PURCHASE_ORDER_HEADER h
    LEFT JOIN PURCH_PURCHASE_ORDER p ON p.ID = h.PO_ID
    LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = p.SUPPLIER_ID
    WHERE h.PO_ID = ${poId}`)
  if (!hdr) return null

  const supabase = await createClient()
  const [grns, bills, adv] = await Promise.all([
    in4Query<Record<string, unknown>>(`
      SELECT d.GRN_ID, g.GRN_NO, g.GRN_DT, g.DELIVERY_CHALAN_NO, m.NAME material, u.NAME uom,
             d.RECIEVED_QTY, d.GRN_MATERIAL_COST
      FROM BI.FACT_PURCHASE_GRN_DETAILS d
      LEFT JOIN BI.DIM_PURCHASE_GRN_HEADER g ON g.GRN_ID = d.GRN_ID
      LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = d.MATERIAL_ID
      LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = d.UOM_ID
      -- A GRN line of nothing (0 qty, 0 value) is IN4's placeholder, not a receipt.
      WHERE d.PO_ID = ${poId} AND (d.RECIEVED_QTY <> 0 OR d.GRN_MATERIAL_COST <> 0)
      ORDER BY g.GRN_DT, d.GRN_ID, d.AUTO_ID`),
    in4Query<Record<string, unknown>>(`
      WITH g AS (SELECT DISTINCT GRN_ID FROM BI.FACT_PURCHASE_GRN_DETAILS WHERE PO_ID = ${poId})
      SELECT p.CERTIFICATE_ID, p.PO_ID bill_po_id, hh.PO_NO bill_po_no,
             MAX(d.CERTIFICATE_NO) cert_no, MAX(d.CERTIFICATE_DT) cert_dt,
             MAX(d.INVOICE_NO) invoice_no, MAX(d.INVOICE_DT) invoice_dt, MAX(d.STATUS_NAME) status_name,
             SUM(p.LANDED_COST) landed, SUM(p.CERTIFIED_AMT) certified, SUM(p.PAID_AMT) paid,
             SUM(p.TAX_DEDUCTION_AMT) tds, SUM(p.RETENTION_AMT) retention, SUM(p.ADV_RECOVERY_AMT) adv_recovery
      FROM BI.FACT_PURCHASE_SUPPLIER_PAY p
      JOIN g ON g.GRN_ID = p.GRN_ID
      LEFT JOIN BI.DIM_PURCHASE_SUPPLIER_PAY d ON d.AUTO_ID = p.AUTO_ID
      LEFT JOIN BI.PURCHASE_ORDER_HEADER hh ON hh.PO_ID = p.PO_ID
      GROUP BY p.CERTIFICATE_ID, p.PO_ID, hh.PO_NO`),
    supabase.from('in4_supplier_certificates')
      .select('certificate_id, certificate_no, status, landed_cost, paid, tax_deduction, retention, adv_recovery')
      .eq('kind', 'advance').eq('po_id', poId),
  ])

  const ledger = buildPoLedger(
    n(hdr.PO_VALUE), poId,
    grns.map(g => ({
      grnId: n(g.GRN_ID), grnNo: s(g.GRN_NO), date: iso(g.GRN_DT), challan: s(g.DELIVERY_CHALAN_NO),
      material: s(g.material), uom: s(g.uom), qty: n(g.RECIEVED_QTY), value: n(g.GRN_MATERIAL_COST),
    })),
    bills.map(b => ({
      certificateId: n(b.CERTIFICATE_ID), certificateNo: s(b.cert_no), certificateDate: iso(b.cert_dt),
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
  return { poId, ref: s(hdr.PO_NO) ?? `PO ${poId}`, party: s(hdr.supplier), ordered: n(hdr.PO_VALUE), headerPaid: n(hdr.PAID_AMT), ledger }
}
