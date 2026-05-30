/**
 * Parser for the ERP PURCHINDENT_TO_ISSUE_RPT Excel export.
 * Adapted into the hub from procurement-tracker module.
 * Compatible with SRASSK/SRET procurement report structure.
 */

import * as XLSX from 'xlsx'

export type IndentStatus =
  | 'PO Done & GRN Received'
  | 'PO Raised – GRN Pending'
  | 'Indent Only – No PO'

export interface IndentRecord {
  indentNo: string
  indentDate: string
  subProject: string
  block: string
  discipline: string
  material: string
  indentQty: number | string
  uom: string
  hasPO: boolean
  poNos: string
  /** Number of distinct POs raised against this indent. */
  poCount: number
  supplier: string
  /** Number of distinct suppliers across the POs. */
  vendorCount: number
  hasGRN: boolean
  grnNos: string
  grnQty: number
  grnValue: number
  /** Best-effort PO value: sum(po_qty × grn_rate) when GRN rate is known; else 0. */
  poValue: number
  /** Days since indent_date (null when date unparseable). */
  ageDays: number | null
  status: IndentStatus
}

export interface VendorRollup {
  name: string
  indents: number
  poValue: number
  pendingGrnValue: number
}

export interface ProjectSummary {
  projectName: string
  total: number
  poDoneGrnReceived: number
  poRaisedGrnPending: number
  indentOnlyNoPo: number
  totalGrnValue: number
  /** Sum of poValue across records. */
  totalPoValue: number
  /** Sum of (poValue − grnValue) for indents that have a PO but no full GRN. */
  pendingGrnValue: number
  /** Oldest indent that hasn't gotten a PO yet (or null when none). */
  oldestPendingPo: IndentRecord | null
  /** Indent with the biggest pending-GRN value (or null when none). */
  biggestPendingGrn: IndentRecord | null
  byDiscipline: Record<string, { total: number; done: number; pending: number; noPo: number }>
  topVendors: VendorRollup[]
  records: IndentRecord[]
}

function simplifyBlock(sp: string): string {
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
  return sp.slice(0, 25)
}

function extractDiscipline(material: string): string {
  const m = String(material)
  const match = m.match(/^(\d{2})\s*(?:\([AM]\))?\s*([^-]+)/)
  if (match) return match[0].replace(/\([AM]\)\s*/g, '').trim().slice(0, 35)
  return 'Other'
}

function cleanMaterial(raw: string): string {
  const parts = String(raw).split('-')
  if (parts.length >= 3) return parts.slice(2).join('-').trim()
  if (parts.length === 2) return parts[1].trim()
  return String(raw).slice(0, 80)
}

/** Days since a date string like "12/05/2026" / "2026-05-12" / Excel serial. */
function daysSince(raw: string): number | null {
  if (!raw) return null
  // dd/mm/yyyy or dd-mm-yyyy (Indian convention)
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  let d: Date | null = null
  if (m) {
    const day = Number(m[1])
    const mon = Number(m[2]) - 1
    let year = Number(m[3])
    if (year < 100) year += 2000
    d = new Date(year, mon, day)
  } else {
    const parsed = new Date(raw)
    if (!isNaN(parsed.getTime())) d = parsed
  }
  if (!d || isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

export function parseProcurementReport(
  buffer: ArrayBuffer,
  filterProject?: string,
): ProjectSummary[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  }) as (string | number | null)[][]

  // Column indices (0-based) based on SRASSK report format
  const COL = {
    WO_CAT: 0,
    CONTRACTOR: 1,
    WO_NO: 2,
    INDENT_NO: 3,
    INDENT_TYPE: 4,
    INDENT_DATE: 5,
    MATERIAL: 6,
    INDENT_QTY: 7,
    UOM: 9,
    SUPPLIER: 12,
    PO_NO: 13,
    PO_QTY: 17,
    GRN_NO: 18,
    GRN_DATE: 19,
    GRN_QTY: 20,
    GRN_RATE: 21,
    GRN_VALUE: 22,
  }

  // Find all indent row indices
  const indentIndices: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]?.[COL.INDENT_NO]
    if (v && String(v).startsWith('IND/')) indentIndices.push(i)
  }

  // Forward-fill project + discipline from cols 0 and 1
  const projectFill: string[] = new Array(raw.length).fill('')
  const disciplineFill: string[] = new Array(raw.length).fill('')
  let lastProject = ''
  let lastDisc = ''
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]?.[COL.WO_CAT]
    if (p && String(p).trim()) lastProject = String(p).trim()
    projectFill[i] = lastProject

    const d = raw[i]?.[COL.CONTRACTOR]
    if (d && String(d).trim() && String(d) !== 'Internal Works') lastDisc = String(d).trim()
    disciplineFill[i] = lastDisc
  }

  const projectMap: Record<string, IndentRecord[]> = {}

  for (let ii = 0; ii < indentIndices.length; ii++) {
    const idx = indentIndices[ii]
    const nextIdx = ii + 1 < indentIndices.length ? indentIndices[ii + 1] : raw.length

    const indentNo = String(raw[idx][COL.INDENT_NO])
    const indentDate = String(raw[idx][COL.INDENT_DATE] ?? '')
    const subProject = projectFill[idx]

    if (filterProject && !subProject.toLowerCase().includes(filterProject.toLowerCase())) continue

    // Find material from col 6 in this window
    let material = ''
    let indentQty: number | string = ''
    let uom = ''
    for (let r = idx; r < nextIdx; r++) {
      if (raw[r]?.[COL.MATERIAL]) {
        material = String(raw[r][COL.MATERIAL])
        indentQty = (raw[r][COL.INDENT_QTY] as number) ?? ''
        uom = String(raw[r][COL.UOM] ?? '')
        break
      }
    }

    // PO info — dedupe and best-effort PO value via (po_qty × grn_rate)
    const poSet = new Set<string>()
    const vendorSet = new Set<string>()
    let supplier = ''
    let poValue = 0
    for (let r = idx; r < nextIdx; r++) {
      const po = raw[r]?.[COL.PO_NO]
      if (po && String(po).startsWith('PO/')) {
        poSet.add(String(po))
        const sup = raw[r][COL.SUPPLIER]
        if (sup) {
          const s = String(sup).trim()
          if (s) {
            vendorSet.add(s)
            if (!supplier) supplier = s
          }
        }
        // PO value estimate: most reports don't carry po_amount directly,
        // but po_qty × grn_rate is a close proxy where GRN exists. When
        // GRN isn't recorded yet, fall back to po_qty × 0 (i.e. unknown)
        // so we don't pretend to know the value.
        const poQty = Number(raw[r][COL.PO_QTY]) || 0
        const grnRate = Number(raw[r][COL.GRN_RATE]) || 0
        if (poQty && grnRate) poValue += poQty * grnRate
      }
    }
    const hasPO = poSet.size > 0
    const poRows = Array.from(poSet)

    // GRN info
    const grnSet = new Set<string>()
    let grnQty = 0
    let grnValue = 0
    for (let r = idx; r < nextIdx; r++) {
      const grn = raw[r]?.[COL.GRN_NO]
      if (grn && String(grn).startsWith('GRN/')) {
        grnSet.add(String(grn))
        grnQty += Number(raw[r][COL.GRN_QTY]) || 0
        grnValue += Number(raw[r][COL.GRN_VALUE]) || 0
      }
    }
    const grnRows = Array.from(grnSet)
    const hasGRN = grnRows.length > 0

    let status: IndentStatus = 'Indent Only – No PO'
    if (hasPO && hasGRN) status = 'PO Done & GRN Received'
    else if (hasPO && !hasGRN) status = 'PO Raised – GRN Pending'

    const record: IndentRecord = {
      indentNo,
      indentDate,
      subProject,
      block: simplifyBlock(subProject),
      discipline: extractDiscipline(material),
      material: cleanMaterial(material),
      indentQty,
      uom,
      hasPO,
      poNos: poRows.slice(0, 3).join(', '),
      poCount: poRows.length,
      supplier,
      vendorCount: vendorSet.size,
      hasGRN,
      grnNos: grnRows.slice(0, 3).join(', '),
      grnQty,
      grnValue,
      poValue,
      ageDays: daysSince(indentDate),
      status,
    }

    // Group by top-level project name (first segment before " - ")
    const topProject = subProject.split(' - ')[0].trim() || subProject
    if (!projectMap[topProject]) projectMap[topProject] = []
    projectMap[topProject].push(record)
  }

  // Build summaries
  const summaries: ProjectSummary[] = []
  for (const [projectName, records] of Object.entries(projectMap)) {
    const byDisc: ProjectSummary['byDiscipline'] = {}
    for (const r of records) {
      const d = r.discipline
      if (!byDisc[d]) byDisc[d] = { total: 0, done: 0, pending: 0, noPo: 0 }
      byDisc[d].total++
      if (r.status === 'PO Done & GRN Received') byDisc[d].done++
      else if (r.status === 'PO Raised – GRN Pending') byDisc[d].pending++
      else byDisc[d].noPo++
    }

    // Vendor rollup — sum poValue + pendingGrn per supplier
    const vendorMap = new Map<string, VendorRollup>()
    for (const r of records) {
      if (!r.supplier) continue
      let v = vendorMap.get(r.supplier)
      if (!v) {
        v = { name: r.supplier, indents: 0, poValue: 0, pendingGrnValue: 0 }
        vendorMap.set(r.supplier, v)
      }
      v.indents++
      v.poValue += r.poValue
      if (r.hasPO && !r.hasGRN) v.pendingGrnValue += r.poValue
    }
    const topVendors = Array.from(vendorMap.values())
      .sort((a, b) => (b.pendingGrnValue + b.poValue) - (a.pendingGrnValue + a.poValue))
      .slice(0, 8)

    const oldestPendingPo = records
      .filter(r => r.status === 'Indent Only – No PO' && r.ageDays != null)
      .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))[0] ?? null

    const biggestPendingGrn = records
      .filter(r => r.status === 'PO Raised – GRN Pending' && r.poValue > 0)
      .sort((a, b) => b.poValue - a.poValue)[0] ?? null

    summaries.push({
      projectName,
      total: records.length,
      poDoneGrnReceived: records.filter(r => r.status === 'PO Done & GRN Received').length,
      poRaisedGrnPending: records.filter(r => r.status === 'PO Raised – GRN Pending').length,
      indentOnlyNoPo: records.filter(r => r.status === 'Indent Only – No PO').length,
      totalGrnValue: records.reduce((s, r) => s + r.grnValue, 0),
      totalPoValue: records.reduce((s, r) => s + r.poValue, 0),
      pendingGrnValue: records
        .filter(r => r.status === 'PO Raised – GRN Pending')
        .reduce((s, r) => s + r.poValue, 0),
      oldestPendingPo,
      biggestPendingGrn,
      byDiscipline: byDisc,
      topVendors,
      records,
    })
  }

  return summaries.sort((a, b) => b.total - a.total)
}
