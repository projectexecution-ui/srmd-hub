// Shared types for the procurement tracker library.
//
// The library supports TWO IN4 procurement report formats:
//   - "banded" → PURCHINDENT_TO_ISSUE_RPT.xlsx
//        company-wide, multi-project, banded layout, NO invoice data.
//   - "flat"   → PUR_PurchaseOrderReport_*.xlsx
//        usually per-project, flat layout, HAS invoice data + a
//        pre-computed Balance Qty column.
//
// Both parsers emit the same shape. UI components branch on the optional
// invoice fields when rendering invoice-aware sections.

export type ReportFormat = 'banded' | 'flat'

export type LineStatus =
  | 'no_po'      // Material requested, no PO raised yet
  | 'pending'    // PO raised, zero received
  | 'partial'    // PO raised, partial GRN
  | 'received'   // GRN qty meets or exceeds ordered qty

/** Indent-level status — derived from the indent's line statuses. */
export type IndentStatus =
  | 'PO Done & GRN Received'
  | 'PO Raised – GRN Pending'
  | 'Indent Only – No PO'

export interface PoEntry {
  poNo: string
  poDate: string
  supplier: string
  qty: number
  rate: number
  /** Sum of GRN rows attached to this PO (when known). */
  grnQty?: number
  amount?: number
}

export interface GrnEntry {
  grnNo: string
  grnDate: string
  qty: number
  rate: number
  value: number
  /** Days between this GRN date and the PO date it sits under. */
  lagDays?: number | null
}

export interface InvoiceEntry {
  invoiceNo: string
  invoiceDate: string
  qty: number
  amount: number
}

export interface LineRecord {
  /** Stable id = indentNo + '|' + index of material under the indent */
  id: string
  indentNo: string
  indentDate: string
  subProject: string
  block: string
  project: string
  discipline: string
  material: string
  indentQty: number
  uom: string
  pos: PoEntry[]
  grns: GrnEntry[]
  /** Present when the source report carries invoice data (flat format). */
  invoices: InvoiceEntry[]
  orderedQty: number
  receivedQty: number
  /** max(orderedQty - receivedQty, 0) */
  pendingQty: number
  /** Best-effort value of what's still owed: pendingQty × first-PO rate */
  pendingValue: number
  /** Sum of GRN values actually recorded */
  grnValue: number
  /** Sum of invoice qty across the line's invoice rows (flat only). */
  invoiceQty: number
  /** Sum of invoice amounts (flat only). */
  invoiceAmount: number
  /** First supplier across the line's POs (canonical for grouping) */
  supplier: string
  /** Distinct supplier count across the line's POs */
  vendorCount: number
  /** Oldest PO age in days (null if no PO) */
  oldestPoAgeDays: number | null
  /** Age since indent_date in days */
  indentAgeDays: number | null
  /** Average GRN lag in days (avg over GRNs that have a date) — null if no GRN. */
  avgGrnLagDays: number | null
  status: LineStatus
}

export interface IndentRollup {
  indentNo: string
  indentDate: string
  block: string
  project: string
  subProject: string
  /** Materials in this indent, in document order */
  lineIds: string[]
  totalLines: number
  linesWithPo: number
  linesReceived: number
  linesPartial: number
  linesPending: number    // PO raised, zero received
  linesNoPo: number
  /** Number of lines with at least one invoice row (flat only — always 0 for banded). */
  linesInvoiced: number
  /** Sum of pendingValue across the indent's lines */
  pendingValue: number
  /** Sum of grnValue (cash that's already crossed the gate) */
  grnValue: number
  /** Sum of invoiceAmount (flat only) */
  invoiceAmount: number
  /** Worst (largest) indentAgeDays from member lines */
  worstAgeDays: number | null
  suppliers: string[]
  poNos: string[]
  /** Indent-level status — derived from its lines for use in the table */
  status: IndentStatus
}

export interface VendorRollup {
  name: string
  /** Number of lines this vendor appears on. */
  indents: number
  /** Total PO value awarded to this vendor. */
  poValue: number
  /** Sum of pendingValue across lines where this vendor is the supplier. */
  pendingValue: number
  /** Count of lines with pendingQty > 0. */
  pendingLines: number
  /** Pending lines where oldestPoAgeDays >= 7. */
  overdueLines: number
  /** Lines fully received (used for lag computation). */
  receivedLines: number
  /** Average lag (days) between PO and GRN across this vendor's received lines. Null if no completed lines. */
  avgLagDays: number | null
  /** Share of received lines whose lag was ≤ 14 days (0..100). Null if no completed lines. */
  onTimePct: number | null
  /** Sum of invoiceAmount (flat only). */
  invoiceAmount: number
}

export interface ProjectSummary {
  projectName: string
  total: number
  poDoneGrnReceived: number
  poRaisedGrnPending: number
  indentOnlyNoPo: number
  totalGrnValue: number
  totalPoValue: number
  /** Sum of line pendingValue */
  pendingValue: number
  /** Count of LineRecord where pendingQty > 0 — the "items pending receipt" number */
  pendingLineCount: number
  /** Sum of invoiceAmount (flat only — always 0 for banded). */
  totalInvoiceAmount: number
  /** Sum of (grnValue - invoiceAmount) for lines that have GRN but not full invoice (flat only). */
  pendingInvoiceValue: number
  oldestPendingPo: IndentRollup | null
  biggestPendingLine: LineRecord | null
  biggestPendingInvoice: LineRecord | null
  worstVendor: VendorRollup | null
  byDiscipline: Record<string, { total: number; done: number; pending: number; noPo: number }>
  topVendors: VendorRollup[]
  lines: LineRecord[]
  indents: IndentRollup[]
}

export interface ParseResult {
  format: ReportFormat
  fileName?: string
  projects: ProjectSummary[]
}

// ─── Snapshot diff types (for daily tracking) ─────────────────────

export interface IndentStatusSnapshot {
  indentNo: string
  status: IndentStatus
  pendingValue: number
}

export interface StoredSnapshot {
  format: ReportFormat
  fileName: string
  savedAt: string                          // ISO datetime
  pendingLineCount: number
  totalGrnValue: number
  pendingValue: number
  indentStatuses: IndentStatusSnapshot[]   // for the diff against the next upload
  /**
   * Full parsed projects. Persisted so the dashboard can rehydrate
   * after a reload without forcing the user to re-upload. Omitted
   * (undefined) when a quota error fell us back to metadata-only.
   */
  projects?: ProjectSummary[]
}

export interface SnapshotDiff {
  prevSavedAt: string
  prevFileName: string
  changedIndents: Set<string>
  newlyGrnDone: number
  newlyInProgress: number
  newlyOverdue: number
  newlyComplete: number
}

/** Ring buffer of last N upload metrics — drives the trend ribbon. */
export interface TrendPoint {
  savedAt: string
  pendingLineCount: number
  pendingValue: number
}
