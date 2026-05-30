/**
 * Parser for the ERP PURCHINDENT_TO_ISSUE_RPT Excel export.
 *
 * IMPORTANT: This report is NOT a flat per-row layout. Each indent occupies
 * a BAND of rows:
 *
 *   ┌─ Indent header row     (col 3 = IND/…)
 *   ├─ Material row          (col 6 = material name, col 7 = indent qty, col 9 = UOM)
 *   │   ├─ PO row(s)         (col 12 supplier, col 13 PO/…, col 15 date, col 17 qty)
 *   │   └─ GRN row(s)        (col 18 GRN/…, col 19 date, col 20 qty, col 21 rate, col 22 value)
 *   ├─ Material row          (next material under same indent)
 *   │   └─ …
 *   └─ (next indent header)
 *
 * Roughly half of all indents in a real export are multi-material. The
 * previous parser used an indent-window approach and `break`ed after the
 * first material — silently discarding 80%+ of the data and making it
 * impossible to see line-level pending qty.
 *
 * This parser uses a stateful walker that emits one LineRecord per
 * (indent, material) and lets the UI compute pending qty per line.
 */

import * as XLSX from 'xlsx'

// ─── Types ────────────────────────────────────────────────────────

export type LineStatus =
  | 'no_po'      // Material requested, no PO raised yet
  | 'pending'    // PO raised, zero received
  | 'partial'    // PO raised, partial GRN
  | 'received'   // GRN qty meets or exceeds ordered qty

export interface PoEntry {
  poNo: string
  poDate: string
  supplier: string
  qty: number
  rate: number    // best-effort: GRN rate when known, else 0
}

export interface GrnEntry {
  grnNo: string
  grnDate: string
  qty: number
  rate: number
  value: number
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
  orderedQty: number
  receivedQty: number
  /** max(orderedQty - receivedQty, 0) */
  pendingQty: number
  /** Best-effort value of what's still owed: pendingQty × first-PO rate */
  pendingValue: number
  /** Sum of GRN values actually recorded */
  grnValue: number
  /** First supplier across the line's POs (canonical for grouping) */
  supplier: string
  /** Distinct supplier count across the line's POs */
  vendorCount: number
  /** Oldest PO age in days (null if no PO) */
  oldestPoAgeDays: number | null
  /** Age since indent_date in days */
  indentAgeDays: number | null
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
  /** Sum of pendingValue across the indent's lines */
  pendingValue: number
  /** Sum of grnValue (cash that's already crossed the gate) */
  grnValue: number
  /** Worst (largest) indentAgeDays from member lines */
  worstAgeDays: number | null
  suppliers: string[]
  poNos: string[]
  /** Indent-level status — derived from its lines for use in the table */
  status: IndentStatus
}

/** Legacy enum kept for the headline table — derived from the rollup. */
export type IndentStatus =
  | 'PO Done & GRN Received'
  | 'PO Raised – GRN Pending'
  | 'Indent Only – No PO'

export interface VendorRollup {
  name: string
  indents: number
  poValue: number
  pendingValue: number
  pendingLines: number
  /** Worst-offender flag: how many overdue-≥7d pending lines */
  overdueLines: number
}

export interface ProjectSummary {
  projectName: string
  /** Indents in this project */
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
  oldestPendingPo: IndentRollup | null
  /** Biggest single line that's still pending receipt */
  biggestPendingLine: LineRecord | null
  /** Worst-offender vendor by overdue line count */
  worstVendor: VendorRollup | null
  byDiscipline: Record<string, { total: number; done: number; pending: number; noPo: number }>
  topVendors: VendorRollup[]
  /** All lines across all indents in this project */
  lines: LineRecord[]
  /** Per-indent rollups */
  indents: IndentRollup[]
}

// ─── Helpers ──────────────────────────────────────────────────────

function simplifyBlock(sp: string): string {
  if (!sp) return ''
  if (sp.includes('New Guest House B')) return 'NGH – Block B'
  if (sp.includes('New Guest House A')) return 'NGH – Block A'
  if (sp.includes('New Guest House C')) return 'NGH – Block C'
  if (sp.includes('Infra Work')) return 'NGH – Infra'
  if (sp.includes('Design')) return 'NGH – Design'
  if (sp.includes('Common')) return 'NGH – Common'
  if (sp.includes('SRAH')) return 'SRAH'
  if (sp.includes('Raj Uphaar') || sp.includes('RU')) return 'Raj Uphaar'
  if (sp.includes('Admin Block')) return 'Admin Block'
  if (sp.includes('Prem Parking')) return 'Prem Parking'
  if (sp.includes('CFB')) return 'CFB'
  if (sp.includes('Staff Facilities')) return 'Staff Facilities'
  return sp.slice(0, 28)
}

function extractDiscipline(material: string): string {
  const m = String(material || '')
  const match = m.match(/^(\d{2})\s*(?:\([AM]\))?\s*([^-]+)/)
  if (match) return match[0].replace(/\([AM]\)\s*/g, '').trim().slice(0, 35)
  return 'Other'
}

function cleanMaterial(raw: string): string {
  if (!raw) return ''
  // "13 (A) Interiors - 1302 (A) Loose Furniture-Cupboard Metal" → "Cupboard Metal"
  const parts = String(raw).split('-')
  if (parts.length >= 3) return parts.slice(2).join('-').trim()
  if (parts.length === 2) return parts[1].trim()
  return String(raw).slice(0, 80)
}

function daysSince(raw: string): number | null {
  if (!raw) return null
  // Try ISO first, then dd/mm/yyyy, then "Mar 1, 2024" — the IN4 export uses
  // long-form date strings like "Mar 2, 2024" so we let Date parse it.
  let d: Date | null = null
  const isoMatch = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    d = new Date(raw)
  } else {
    const dmy = String(raw).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (dmy) {
      const day = Number(dmy[1]), mon = Number(dmy[2]) - 1
      let year = Number(dmy[3]); if (year < 100) year += 2000
      d = new Date(year, mon, day)
    } else {
      const parsed = new Date(String(raw))
      if (!isNaN(parsed.getTime())) d = parsed
    }
  }
  if (!d || isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim())

// ─── Parser ───────────────────────────────────────────────────────

export function parseProcurementReport(buffer: ArrayBuffer): ProjectSummary[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  }) as (string | number | null)[][]

  // Column indices (0-based) — verified against the user's real export.
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
    PO_DATE:    15,
    PO_QTY:     17,
    GRN_NO:     18,
    GRN_DATE:   19,
    GRN_QTY:    20,
    GRN_RATE:   21,
    GRN_VALUE:  22,
  }

  // Forward-fill the WO_CATEGORY column — it's only set on the indent's
  // first row but defines which top-level project this band belongs to.
  let lastProject = ''
  const projectFill: string[] = new Array(raw.length).fill('')
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]?.[C.WO_CAT]
    if (p != null && String(p).trim()) lastProject = String(p).trim()
    projectFill[i] = lastProject
  }

  // ─── Stateful line walker ──────────────────────────────────────
  // We track the current indent, current material line, and (within a
  // material line) the most recent PO so GRN rows attach to the right PO.
  const lines: LineRecord[] = []
  let currentIndentNo = ''
  let currentIndentDate = ''
  let currentSubProject = ''
  let currentMaterial: LineRecord | null = null
  let currentPo: PoEntry | null = null
  // Track material index inside an indent for stable line ids.
  const materialIndexByIndent = new Map<string, number>()

  function flushMaterial() {
    if (!currentMaterial) return
    // Compute aggregates now that we know all POs + GRNs against this line.
    let orderedQty = 0
    let receivedQty = 0
    let grnValue = 0
    const vendorSet = new Set<string>()
    let oldestPoAgeDays: number | null = null
    let firstPoRate = 0
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
      continue
    }

    // ② New material line under the current indent
    if (materialCell && currentIndentNo) {
      flushMaterial()
      const idx = materialIndexByIndent.get(currentIndentNo) ?? 0
      materialIndexByIndent.set(currentIndentNo, idx + 1)
      currentMaterial = {
        id: `${currentIndentNo}|${idx}`,
        indentNo: currentIndentNo,
        indentDate: currentIndentDate,
        subProject: currentSubProject,
        block: simplifyBlock(currentSubProject),
        project: (currentSubProject.split(' - ')[0] || currentSubProject || 'Unknown').trim(),
        discipline: extractDiscipline(materialCell),
        material: cleanMaterial(materialCell),
        indentQty: num(row[C.INDENT_QTY]),
        uom: str(row[C.UOM]),
        pos: [],
        grns: [],
        orderedQty: 0,
        receivedQty: 0,
        pendingQty: 0,
        pendingValue: 0,
        grnValue: 0,
        supplier: '',
        vendorCount: 0,
        oldestPoAgeDays: null,
        indentAgeDays: daysSince(currentIndentDate),
        status: 'no_po',
      }
      currentPo = null
      continue
    }

    // ③ PO row attached to current material
    if (poCell.startsWith('PO/') && currentMaterial) {
      const po: PoEntry = {
        poNo: poCell,
        poDate: str(row[C.PO_DATE]),
        supplier: str(row[C.SUPPLIER]),
        qty: num(row[C.PO_QTY]),
        rate: num(row[C.GRN_RATE]), // best-effort; updated by GRN rows
      }
      currentMaterial.pos.push(po)
      currentPo = po
      continue
    }

    // ④ GRN row attached to current PO (or fall back to last PO of material)
    if (grnCell.startsWith('GRN/') && currentMaterial) {
      const grn: GrnEntry = {
        grnNo: grnCell,
        grnDate: str(row[C.GRN_DATE]),
        qty: num(row[C.GRN_QTY]),
        rate: num(row[C.GRN_RATE]),
        value: num(row[C.GRN_VALUE]),
      }
      currentMaterial.grns.push(grn)
      // Update the PO rate to the most-recent GRN rate (more accurate than 0).
      if (currentPo && !currentPo.rate && grn.rate) currentPo.rate = grn.rate
      continue
    }

    // Other rows (sub-totals, blank separators, etc.) — ignore.
  }
  flushMaterial()

  // ─── Build per-indent rollups ───────────────────────────────────
  const byIndent = new Map<string, IndentRollup>()
  const lineById = new Map<string, LineRecord>()
  for (const ln of lines) {
    lineById.set(ln.id, ln)
    let rollup = byIndent.get(ln.indentNo)
    if (!rollup) {
      rollup = {
        indentNo: ln.indentNo,
        indentDate: ln.indentDate,
        block: ln.block,
        project: ln.project,
        subProject: ln.subProject,
        lineIds: [],
        totalLines: 0,
        linesWithPo: 0,
        linesReceived: 0,
        linesPartial: 0,
        linesPending: 0,
        linesNoPo: 0,
        pendingValue: 0,
        grnValue: 0,
        worstAgeDays: ln.indentAgeDays,
        suppliers: [],
        poNos: [],
        status: 'Indent Only – No PO',
      }
      byIndent.set(ln.indentNo, rollup)
    }
    rollup.lineIds.push(ln.id)
    rollup.totalLines++
    if (ln.pos.length > 0) rollup.linesWithPo++
    if (ln.status === 'received') rollup.linesReceived++
    else if (ln.status === 'partial') rollup.linesPartial++
    else if (ln.status === 'pending') rollup.linesPending++
    else rollup.linesNoPo++
    rollup.pendingValue += ln.pendingValue
    rollup.grnValue += ln.grnValue
    rollup.worstAgeDays = Math.max(rollup.worstAgeDays ?? -Infinity, ln.indentAgeDays ?? -Infinity)
    for (const po of ln.pos) {
      if (po.supplier && !rollup.suppliers.includes(po.supplier)) rollup.suppliers.push(po.supplier)
      if (po.poNo && !rollup.poNos.includes(po.poNo)) rollup.poNos.push(po.poNo)
    }
  }
  // Indent status — same buckets as before, derived from line counts.
  for (const rollup of byIndent.values()) {
    if (rollup.linesWithPo === 0) rollup.status = 'Indent Only – No PO'
    else if (rollup.linesReceived === rollup.totalLines) rollup.status = 'PO Done & GRN Received'
    else rollup.status = 'PO Raised – GRN Pending'
    if (rollup.worstAgeDays === -Infinity) rollup.worstAgeDays = null
  }

  // ─── Build per-project summaries ────────────────────────────────
  const byProject = new Map<string, ProjectSummary>()
  for (const rollup of byIndent.values()) {
    const key = rollup.project || 'Unknown'
    let p = byProject.get(key)
    if (!p) {
      p = {
        projectName: key,
        total: 0,
        poDoneGrnReceived: 0,
        poRaisedGrnPending: 0,
        indentOnlyNoPo: 0,
        totalGrnValue: 0,
        totalPoValue: 0,
        pendingValue: 0,
        pendingLineCount: 0,
        oldestPendingPo: null,
        biggestPendingLine: null,
        worstVendor: null,
        byDiscipline: {},
        topVendors: [],
        lines: [],
        indents: [],
      }
      byProject.set(key, p)
    }
    p.total++
    if (rollup.status === 'PO Done & GRN Received') p.poDoneGrnReceived++
    else if (rollup.status === 'PO Raised – GRN Pending') p.poRaisedGrnPending++
    else p.indentOnlyNoPo++
    p.indents.push(rollup)
  }

  for (const p of byProject.values()) {
    // Attach lines belonging to this project.
    for (const rollup of p.indents) {
      for (const id of rollup.lineIds) {
        const ln = lineById.get(id)
        if (ln) p.lines.push(ln)
      }
    }

    let totalPo = 0
    for (const ln of p.lines) {
      p.totalGrnValue += ln.grnValue
      p.pendingValue += ln.pendingValue
      if (ln.pendingQty > 0) p.pendingLineCount++
      // Best-effort total PO value: orderedQty × first PO rate
      const rate = ln.pos[0]?.rate ?? 0
      if (ln.orderedQty && rate) totalPo += ln.orderedQty * rate
      const d = ln.discipline
      if (!p.byDiscipline[d]) p.byDiscipline[d] = { total: 0, done: 0, pending: 0, noPo: 0 }
      p.byDiscipline[d].total++
      if (ln.status === 'received')        p.byDiscipline[d].done++
      else if (ln.status === 'no_po')      p.byDiscipline[d].noPo++
      else                                 p.byDiscipline[d].pending++
    }
    p.totalPoValue = totalPo

    // Action picks
    p.oldestPendingPo = p.indents
      .filter(r => r.linesNoPo > 0 && r.worstAgeDays != null)
      .sort((a, b) => (b.worstAgeDays ?? 0) - (a.worstAgeDays ?? 0))[0] ?? null

    p.biggestPendingLine = p.lines
      .filter(ln => ln.pendingQty > 0 && ln.pendingValue > 0)
      .sort((a, b) => b.pendingValue - a.pendingValue)[0] ?? null

    // Vendor rollup
    const vendorMap = new Map<string, VendorRollup>()
    for (const ln of p.lines) {
      for (const po of ln.pos) {
        if (!po.supplier) continue
        let v = vendorMap.get(po.supplier)
        if (!v) {
          v = { name: po.supplier, indents: 0, poValue: 0, pendingValue: 0, pendingLines: 0, overdueLines: 0 }
          vendorMap.set(po.supplier, v)
        }
        v.poValue += po.qty * (po.rate || 0)
      }
      // Per-line vendor effects (so we don't multiply counts by # of POs)
      if (ln.supplier) {
        const v = vendorMap.get(ln.supplier)
        if (v) {
          v.indents++ // counts lines, not indents — name is kept for backward compat with UI
          if (ln.pendingQty > 0) {
            v.pendingLines++
            v.pendingValue += ln.pendingValue
            if ((ln.oldestPoAgeDays ?? 0) >= 7) v.overdueLines++
          }
        }
      }
    }
    p.topVendors = Array.from(vendorMap.values())
      .sort((a, b) => (b.pendingValue + b.poValue * 0.05) - (a.pendingValue + a.poValue * 0.05))
      .slice(0, 8)
    p.worstVendor = Array.from(vendorMap.values())
      .filter(v => v.overdueLines > 0)
      .sort((a, b) => b.overdueLines - a.overdueLines || b.pendingValue - a.pendingValue)[0] ?? null
  }

  return Array.from(byProject.values()).sort((a, b) => b.total - a.total)
}
