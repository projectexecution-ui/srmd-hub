// Parser for the IN4 PURCHINDENT_TO_ISSUE_RPT.xlsx (banded layout).
//
// Each indent occupies a band of rows:
//   Indent header (col 3 = IND/…)
//   Material row (col 6 = name, col 7 = indent qty, col 9 = UOM)
//     1..N PO rows (col 12 supplier, col 13 PO/…, col 15 date, col 17 qty)
//     0..N GRN rows (col 18 GRN/…, col 19 date, col 20 qty, col 21 rate, col 22 value)
//   (next material row...)
//
// Stateful walker — emits one LineRecord per (indent, material).

import * as XLSX from 'xlsx'
import type { LineRecord, PoEntry, GrnEntry, LineStatus, SourceRow } from '../types'
import { simplifyBlock, extractDiscipline, cleanMaterial, daysSince, daysBetween, num, str, projectFromIndentNo } from '../shared'

// Column indices (0-based) verified against real PURCHINDENT_TO_ISSUE_RPT exports.
const C = {
  WO_CAT:     0,
  CONTRACTOR: 1,
  WO_NO:      2,
  INDENT_NO:  3,
  INDENT_TY:  4,
  INDENT_DT:  5,
  MATERIAL:   6,
  INDENT_QTY: 7,
  UOM:        9,
  SUPPLIER:   12,
  PO_NO:      13,
  PO_CCY:     14,   // "Base Currency" — IN4 fills "INR" here even when the
                    // rest of the PO row cells are blank (sparse continuation).
  PO_DATE:    15,
  PO_QTY:     17,
  GRN_NO:     18,
  GRN_DATE:   19,
  GRN_QTY:    20,
  GRN_RATE:   21,
  GRN_VALUE:  22,
}

export function isBanded(raw: (string | number | null)[][]): boolean {
  // Header band sits on row 4 (index 4). Identify by exact column headers.
  const header = raw[4] ?? []
  return String(header[C.WO_CAT] ?? '').toLowerCase().includes('wo category')
      && String(header[C.INDENT_NO] ?? '').toLowerCase().includes('indent no')
}

export function parseBanded(buffer: ArrayBuffer): LineRecord[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  }) as (string | number | null)[][]

  // Col 0 ("WO Category") interleaves TWO kinds of headers in the same
  // column:
  //   - PROJECT / SITE headers, e.g. "Staff Facilities Block - Staff
  //     Facilities Block - Execution", "New Guest House A - …"
  //   - TRADE CATEGORY headers, e.g. "13 Interiors", "07 Electrical
  //     Works" (always start with a 2-digit code).
  // Aksha thinks of "project" as the SITE, not the trade. So we have to
  // forward-fill these two kinds separately. Trade-category-shaped
  // values update `lastTrade`, everything else updates `lastSite`. Each
  // row then knows both its site and its trade — and crucially, a row
  // appearing right after a "13 Interiors" header still inherits the
  // most recent SITE (not "13 Interiors" — that was the bug behind
  // Aksha's chip-grid screenshot).
  const TRADE_RX = /^\d{2}\s/   // matches "07 Electrical Works", "13 Interiors", etc.
  let lastSite = ''
  let lastTrade = ''
  const projectFill: string[] = new Array(raw.length).fill('')
  const tradeFill: string[] = new Array(raw.length).fill('')
  for (let i = 0; i < raw.length; i++) {
    const cell = raw[i]?.[C.WO_CAT]
    if (cell != null && String(cell).trim()) {
      const v = String(cell).trim()
      if (TRADE_RX.test(v)) lastTrade = v
      else lastSite = v
    }
    projectFill[i] = lastSite
    tradeFill[i] = lastTrade
  }

  const lines: LineRecord[] = []
  let currentIndentNo = ''
  let currentIndentDate = ''
  let currentSubProject = ''
  let currentMaterial: LineRecord | null = null
  let currentPo: PoEntry | null = null
  /**
   * Most recent fully-exported PO row on the current indent. When
   * IN4 emits a sparse "INR-only" continuation row (currency cell
   * populated but PO no / supplier / qty all blank), we infer the
   * PO from this — IN4's export silently shares one PO across
   * several materials of the same indent without re-listing the
   * PO data on each material's row.
   * Reset to null whenever a new IND/ row appears.
   */
  let lastFullPoOnIndent: PoEntry | null = null
  const materialIndexByIndent = new Map<string, number>()
  /**
   * The "indent header" SourceRow captured the last time we saw an
   * IND/ row. Cached so every material started under that indent can
   * carry it as the first entry in its sourceRows[] (lets the inspector
   * show the indent line even though the parser handles it as a
   * separate row).
   */
  let lastIndentSourceRow: SourceRow | null = null

  function makeSourceRow(rowIndex: number, role: SourceRow['role'], row: (string | number | null)[]): SourceRow {
    // Labelled subset of the row — only the columns the parser uses,
    // keeps the inspector readable. Order roughly matches IN4's
    // header band (indent metadata → material → PO → GRN).
    return {
      rowIndex,
      role,
      cells: [
        { label: 'WO Category', value: row[C.WO_CAT] ?? null },
        { label: 'Contractor',  value: row[C.CONTRACTOR] ?? null },
        { label: 'WO No',       value: row[C.WO_NO] ?? null },
        { label: 'Indent No',   value: row[C.INDENT_NO] ?? null },
        { label: 'Indent Type', value: row[C.INDENT_TY] ?? null },
        { label: 'Indent Date', value: row[C.INDENT_DT] ?? null },
        { label: 'Material',    value: row[C.MATERIAL] ?? null },
        { label: 'Qty',         value: row[C.INDENT_QTY] ?? null },
        { label: 'UOM',         value: row[C.UOM] ?? null },
        { label: 'Supplier',    value: row[C.SUPPLIER] ?? null },
        { label: 'PO No',       value: row[C.PO_NO] ?? null },
        { label: 'PO Date',     value: row[C.PO_DATE] ?? null },
        { label: 'PO Qty',      value: row[C.PO_QTY] ?? null },
        { label: 'GRN No',      value: row[C.GRN_NO] ?? null },
        { label: 'GRN Date',    value: row[C.GRN_DATE] ?? null },
        { label: 'GRN Qty',     value: row[C.GRN_QTY] ?? null },
        { label: 'GRN Rate',    value: row[C.GRN_RATE] ?? null },
        { label: 'GRN Value',   value: row[C.GRN_VALUE] ?? null },
      ].filter(c => c.value != null && c.value !== ''),
    }
  }

  function flushMaterial() {
    if (!currentMaterial) return
    let orderedQty = 0
    let receivedQty = 0
    let grnValue = 0
    const vendorSet = new Set<string>()
    let oldestPoAgeDays: number | null = null
    let firstPoRate = 0
    const lags: number[] = []
    for (const po of currentMaterial.pos) {
      orderedQty += po.qty
      if (po.supplier) vendorSet.add(po.supplier)
      const age = daysSince(po.poDate)
      if (age != null) oldestPoAgeDays = Math.max(oldestPoAgeDays ?? -Infinity, age)
      if (!firstPoRate && po.rate) firstPoRate = po.rate
    }
    for (const g of currentMaterial.grns) {
      receivedQty += g.qty
      grnValue += g.value
      if (g.lagDays != null) lags.push(g.lagDays)
      if (!firstPoRate && g.rate) firstPoRate = g.rate
    }
    const pendingQty = Math.max(orderedQty - receivedQty, 0)
    let status: LineStatus
    if (currentMaterial.pos.length === 0) status = 'no_po'
    else if (receivedQty <= 0) status = 'pending'
    else if (receivedQty < orderedQty) status = 'partial'
    else status = 'received'

    currentMaterial.orderedQty = orderedQty
    currentMaterial.receivedQty = receivedQty
    currentMaterial.pendingQty = pendingQty
    currentMaterial.grnValue = grnValue
    currentMaterial.pendingValue = pendingQty * (firstPoRate || 0)
    currentMaterial.supplier = currentMaterial.pos[0]?.supplier ?? ''
    currentMaterial.vendorCount = vendorSet.size
    currentMaterial.oldestPoAgeDays = oldestPoAgeDays === -Infinity ? null : oldestPoAgeDays
    currentMaterial.avgGrnLagDays = lags.length > 0
      ? Math.round(lags.reduce((s, x) => s + x, 0) / lags.length)
      : null
    currentMaterial.status = status
    lines.push(currentMaterial)
    currentMaterial = null
    currentPo = null
  }

  for (let r = 0; r < raw.length; r++) {
    const row = raw[r]
    if (!row) continue

    const indentCell = str(row[C.INDENT_NO])
    const materialCell = str(row[C.MATERIAL])
    const poCell = str(row[C.PO_NO])
    const grnCell = str(row[C.GRN_NO])

    // ① New indent header
    if (indentCell.startsWith('IND/')) {
      flushMaterial()
      currentIndentNo = indentCell
      currentIndentDate = str(row[C.INDENT_DT])
      currentSubProject = projectFill[r] || ''
      materialIndexByIndent.set(currentIndentNo, 0)
      lastIndentSourceRow = makeSourceRow(r, 'indent', row)
      lastFullPoOnIndent = null
      continue
    }

    // ② New material line under the current indent
    if (materialCell && currentIndentNo) {
      flushMaterial()
      const idx = materialIndexByIndent.get(currentIndentNo) ?? 0
      materialIndexByIndent.set(currentIndentNo, idx + 1)
      // Project name comes from the INDENT NUMBER'S code (NGH, RU,
      // SQ, …) — that's IN4's actual project signal. The col 0 site
      // header is only used as a fallback for malformed indent
      // numbers, because forward-filling it across rare cross-project
      // indents leaks the wrong name (e.g. an "ND" office-supplies
      // indent inheriting "New Guest House").
      const projectFromCode = projectFromIndentNo(currentIndentNo)
      const projectName = projectFromCode
        ?? (currentSubProject.split(' - ')[0] || currentSubProject || 'Unknown').trim()
      currentMaterial = {
        id: `${currentIndentNo}|${idx}`,
        indentNo: currentIndentNo,
        indentDate: currentIndentDate,
        subProject: currentSubProject,
        block: simplifyBlock(currentSubProject),
        project: projectName,
        discipline: extractDiscipline(materialCell),
        material: cleanMaterial(materialCell),
        indentQty: num(row[C.INDENT_QTY]),
        uom: str(row[C.UOM]),
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
        indentAgeDays: daysSince(currentIndentDate),
        avgGrnLagDays: null,
        status: 'no_po',
        sourceRows: lastIndentSourceRow
          ? [lastIndentSourceRow, makeSourceRow(r, 'material', row)]
          : [makeSourceRow(r, 'material', row)],
      }
      currentPo = null
      continue
    }

    // ③ PO row. IN4 uses TWO prefixes in this column:
    //    "PO/…"        — finalised PO sent to supplier
    //    "DRAFT-PO/…"  — purchase team raised it, not yet approved
    // Both count as "PO exists" for the purposes of the Indents
    // Needing PO view — the material is no longer in limbo. We mark
    // draft POs with .draft = true so the UI can surface that nuance.
    const isPo = poCell.startsWith('PO/') || poCell.startsWith('DRAFT-PO/')
    if (isPo && currentMaterial) {
      const po: PoEntry = {
        poNo: poCell,
        poDate: str(row[C.PO_DATE]),
        supplier: str(row[C.SUPPLIER]),
        qty: num(row[C.PO_QTY]),
        rate: num(row[C.GRN_RATE]),
        draft: poCell.startsWith('DRAFT-PO/'),
      }
      currentMaterial.pos.push(po)
      currentPo = po
      lastFullPoOnIndent = po
      currentMaterial.sourceRows?.push(makeSourceRow(r, 'po', row))
      continue
    }

    // ③.5 Sparse "INR-only" continuation row. IN4's export sometimes
    // drops the PO no/supplier/date/qty when one PO covers several
    // materials in the same indent, leaving only the currency
    // marker. Without this branch the material is wrongly flagged
    // "needs PO" (Aksha's Gabion Box bug — IND/SRASSK/P2I/2026-27/8,
    // rows 18218 + 18222). Detection: currency populated, every
    // other identifier column blank, AND we have a real PO from
    // earlier in the same indent to clone.
    const currencyCell = str(row[C.PO_CCY])
    const sparseRow =
      currencyCell === 'INR' &&
      !poCell &&
      !grnCell &&
      !materialCell &&
      !indentCell &&
      !str(row[C.SUPPLIER]) &&
      !str(row[C.PO_DATE]) &&
      !num(row[C.PO_QTY])
    if (sparseRow && currentMaterial && currentMaterial.pos.length === 0 && lastFullPoOnIndent) {
      const inferred: PoEntry = {
        poNo: lastFullPoOnIndent.poNo,
        poDate: lastFullPoOnIndent.poDate,
        supplier: lastFullPoOnIndent.supplier,
        // We don't know the actual PO qty for this material — use
        // its indent qty as a best-effort estimate. Real qty can be
        // verified via the source-rows inspector.
        qty: currentMaterial.indentQty,
        rate: lastFullPoOnIndent.rate,
        draft: lastFullPoOnIndent.draft,
        inferred: true,
      }
      currentMaterial.pos.push(inferred)
      currentPo = inferred
      currentMaterial.sourceRows?.push(makeSourceRow(r, 'po', row))
      continue
    }

    // ④ GRN row
    if (grnCell.startsWith('GRN/') && currentMaterial) {
      const grnDate = str(row[C.GRN_DATE])
      const grn: GrnEntry = {
        grnNo: grnCell,
        grnDate,
        qty: num(row[C.GRN_QTY]),
        rate: num(row[C.GRN_RATE]),
        value: num(row[C.GRN_VALUE]),
        lagDays: currentPo ? daysBetween(currentPo.poDate, grnDate) : null,
      }
      currentMaterial.grns.push(grn)
      if (currentPo && !currentPo.rate && grn.rate) currentPo.rate = grn.rate
      currentMaterial.sourceRows?.push(makeSourceRow(r, 'grn', row))
      continue
    }
  }
  flushMaterial()
  return lines
}
