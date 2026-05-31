// Parser for the SRMD PUR_PurchaseOrderReport_*.xlsx (flat layout).
//
// Each row is one (indent_line × PO) record. Multi-PO indent lines repeat
// the indent_no + material_name on subsequent rows. Multi-GRN per PO is
// handled the same way (same indent + material + PO repeats).
//
// Headers sit on row 7, data on row 8+.
//
//   Col 0   Sr. No.
//   Col 2   Project
//   Col 3   Sub Project
//   Col 6   Material Name
//   Col 7   Indent Desc
//   Col 8   Indent Date
//   Col 9   Indent No
//   Col 10  Indent QTY
//   Col 13  Vendor
//   Col 14  PO Date
//   Col 15  PO No.
//   Col 16  PO Qty.
//   Col 17  PO Rate
//   Col 22  PO Amount
//   Col 23  Order Qty.
//   Col 24  Received Qty
//   Col 26  Net Received Qty
//   Col 27  Balance Qty   ← pre-computed pending!
//   Col 28  Invoice Date
//   Col 30  Invoice No
//   Col 31  Invoice Qty.
//   Col 37  Invoice Amount

import * as XLSX from 'xlsx'
import type { LineRecord, PoEntry, GrnEntry, InvoiceEntry, LineStatus } from '../types'
import { simplifyBlock, extractDiscipline, cleanMaterial, daysSince, daysBetween, num, str } from '../shared'

const C = {
  SR_NO:        0,
  PROJECT:      2,
  SUB_PROJECT:  3,
  MATERIAL:     6,
  INDENT_DESC:  7,
  INDENT_DATE:  8,
  INDENT_NO:    9,
  INDENT_QTY:   10,
  VENDOR:       13,
  PO_DATE:      14,
  PO_NO:        15,
  PO_QTY:       16,
  PO_RATE:      17,
  PO_AMOUNT:    22,
  ORDER_QTY:    23,
  RECEIVED_QTY: 24,
  NET_RCVD:     26,
  BALANCE:      27,
  INVOICE_DATE: 28,
  INVOICE_NO:   30,
  INVOICE_QTY:  31,
  INVOICE_AMT:  37,
}

export function isFlat(raw: (string | number | null)[][]): boolean {
  const header = raw[7] ?? []
  return String(header[C.SR_NO] ?? '').toLowerCase().includes('sr')
      && String(header[C.INDENT_NO] ?? '').toLowerCase().includes('indent no')
}

export function parseFlat(buffer: ArrayBuffer): LineRecord[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  }) as (string | number | null)[][]

  // Group rows by (indent_no, material_name).
  const byKey = new Map<string, LineRecord>()
  let lineCounter = new Map<string, number>()

  for (let r = 8; r < raw.length; r++) {
    const row = raw[r]
    if (!row) continue
    const sr = row[C.SR_NO]
    // Real data rows have a numeric Sr. No. Sub-total / Grand-total rows
    // have it blank — skip them.
    if (sr == null || sr === '') continue
    const indentNo = str(row[C.INDENT_NO])
    const materialRaw = str(row[C.MATERIAL])
    if (!indentNo || !materialRaw) continue

    const key = `${indentNo}|${materialRaw}`
    let line = byKey.get(key)
    if (!line) {
      const idx = lineCounter.get(indentNo) ?? 0
      lineCounter.set(indentNo, idx + 1)
      const subProject = str(row[C.SUB_PROJECT]) || str(row[C.PROJECT])
      line = {
        id: `${indentNo}|${idx}`,
        indentNo,
        indentDate: str(row[C.INDENT_DATE]),
        subProject,
        block: simplifyBlock(subProject),
        project: (str(row[C.PROJECT]) || subProject || 'Unknown').trim(),
        discipline: extractDiscipline(materialRaw),
        material: cleanMaterial(materialRaw),
        indentQty: num(row[C.INDENT_QTY]),
        uom: '', // not in this report — leave blank
        pos: [],
        grns: [],
        invoices: [],
        orderedQty: 0,
        receivedQty: 0,
        pendingQty: 0,
        pendingValue: 0,
        grnValue: 0,
        invoiceQty: 0,
        invoiceAmount: 0,
        supplier: '',
        vendorCount: 0,
        oldestPoAgeDays: null,
        indentAgeDays: daysSince(str(row[C.INDENT_DATE])),
        avgGrnLagDays: null,
        status: 'no_po',
      }
      byKey.set(key, line)
    }

    // PO data on this row (may be blank if indent has no PO yet)
    const poNo = str(row[C.PO_NO])
    if (poNo) {
      // Dedupe POs by poNo within the line.
      const existingPo = line.pos.find(p => p.poNo === poNo)
      if (!existingPo) {
        const po: PoEntry = {
          poNo,
          poDate: str(row[C.PO_DATE]),
          supplier: str(row[C.VENDOR]),
          qty: num(row[C.PO_QTY]),
          rate: num(row[C.PO_RATE]),
          amount: num(row[C.PO_AMOUNT]),
          // Same DRAFT-PO/ semantic as the banded parser (see banded.ts).
          draft: poNo.startsWith('DRAFT-PO/'),
        }
        line.pos.push(po)
      }

      // GRN data — flat report doesn't carry a GRN number, but Received
      // Qty + Net Received Qty are populated when a GRN exists. Treat
      // each row's received qty as one GRN entry only if it's the FIRST
      // time we see this PO (rows for the same PO can repeat).
      // For simplicity, capture per-row received qty into a synthetic GRN.
      const netRcvd = num(row[C.NET_RCVD]) || num(row[C.RECEIVED_QTY])
      if (netRcvd > 0 && !line.grns.find(g => g.grnNo === poNo)) {
        const grn: GrnEntry = {
          grnNo: poNo, // flat report has no GRN no; use PO no as a tag
          grnDate: str(row[C.PO_DATE]), // closest proxy — no separate GRN date in flat layout
          qty: netRcvd,
          rate: num(row[C.PO_RATE]),
          value: netRcvd * num(row[C.PO_RATE]),
          lagDays: 0, // unknown — flat report doesn't carry GRN date
        }
        line.grns.push(grn)
      }
    }

    // Invoice data
    const invNo = str(row[C.INVOICE_NO])
    const invDate = str(row[C.INVOICE_DATE])
    if (invNo && !line.invoices.find(i => i.invoiceNo === invNo)) {
      const inv: InvoiceEntry = {
        invoiceNo: invNo,
        invoiceDate: invDate,
        qty: num(row[C.INVOICE_QTY]),
        amount: num(row[C.INVOICE_AMT]),
      }
      line.invoices.push(inv)
      line.invoiceQty += inv.qty
      line.invoiceAmount += inv.amount
      // Compute lag if we can: GRN-date proxy is PO date, so lag = inv_date - po_date.
      const po = line.pos.find(p => p.poNo === str(row[C.PO_NO]))
      if (po) {
        const lag = daysBetween(po.poDate, invDate)
        // Update GRN lag too if present
        const grn = line.grns.find(g => g.grnNo === po.poNo)
        if (grn && lag != null) grn.lagDays = lag
      }
    }
  }

  // Compute aggregates per line
  const lines: LineRecord[] = []
  for (const line of byKey.values()) {
    const vendorSet = new Set<string>()
    let oldestPoAgeDays: number | null = null
    let firstPoRate = 0
    let orderedQty = 0
    let receivedQty = 0
    let grnValue = 0
    const lags: number[] = []
    for (const po of line.pos) {
      if (po.supplier) vendorSet.add(po.supplier)
      const age = daysSince(po.poDate)
      if (age != null) oldestPoAgeDays = Math.max(oldestPoAgeDays ?? -Infinity, age)
      if (!firstPoRate && po.rate) firstPoRate = po.rate
      orderedQty += po.qty
    }
    for (const g of line.grns) {
      receivedQty += g.qty
      grnValue += g.value
      if (g.lagDays != null) lags.push(g.lagDays)
    }
    const pendingQty = Math.max(orderedQty - receivedQty, 0)
    let status: LineStatus
    if (line.pos.length === 0) status = 'no_po'
    else if (receivedQty <= 0) status = 'pending'
    else if (receivedQty < orderedQty) status = 'partial'
    else status = 'received'

    line.orderedQty = orderedQty
    line.receivedQty = receivedQty
    line.pendingQty = pendingQty
    line.grnValue = grnValue
    line.pendingValue = pendingQty * (firstPoRate || 0)
    line.supplier = line.pos[0]?.supplier ?? ''
    line.vendorCount = vendorSet.size
    line.oldestPoAgeDays = oldestPoAgeDays === -Infinity ? null : oldestPoAgeDays
    line.avgGrnLagDays = lags.length > 0 ? Math.round(lags.reduce((s, x) => s + x, 0) / lags.length) : null
    line.status = status
    lines.push(line)
  }
  return lines
}
