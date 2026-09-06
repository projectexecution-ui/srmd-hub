// The Indent → PO tracker, built from IN4's own view instead of its Excel.
//
// PURCH_INDENT_TO_ISSUE is the view under IN4's "Indent to Issue" report — the
// same rows the PURCHINDENT_TO_ISSUE_RPT.xlsx export flattens into bands. So
// the walker in lib/procurement/parsers/banded.ts is not needed: each row
// already says which indent item, PO line and GRN it belongs to. What this file
// keeps identical is the OUTPUT — the same LineRecord the parser emits, with the
// same ids (indentNo|index), the same cleaned material and discipline strings
// (the Warehouse item catalogue is keyed on them), the same status rules — so
// everything downstream (rollups, the merged view, chase notes, the Warehouse
// PO sync, the reminder digest) keeps working without knowing the source moved.
//
// Two things get better on purpose:
//   • project = IN4's PROJECT_NAME, not a guess from the indent-number code.
//     The names agree for every project the code map knew; the codes it did
//     not know (ND, DA) now land on their real project.
//   • every PO carries IN4's own order rate, so nothing is "unpriced" any more
//     and the separate PO-report upload is no longer needed.

import type { LineRecord, PoEntry, GrnEntry, LineStatus, ProjectSummary, IndentStatusSnapshot, LineStatusSnapshot } from '@/lib/procurement/types'
import { simplifyBlock, extractDiscipline, cleanMaterial, daysSince, daysBetween } from '@/lib/procurement/shared'
import { buildProjectSummaries } from '@/lib/procurement/rollup'

/** One row of PURCH_INDENT_TO_ISSUE, IN4 column names lower-cased. Dates are
 *  ISO 'YYYY-MM-DD' strings or null. */
export interface In4IndentRow {
  project_id: number; project_name: string; subproject_id: number; subproject_name: string
  skill_id: number | null; wo_skill_name: string | null; wo_id: number | null; wo_no: string | null; contractor_name: string | null
  material_type: string; material_subtype: string; material_id: number; material_name: string
  indent_id: number; indent_no: string; indent_status: number; indent_date: string | null; indent_type: string | null
  indent_item_id: number; indent_qty: number; uom: string
  po_id: number | null; po_detail_id: number | null; po_no: string | null; po_supplier_id: number | null; po_supplier: string | null
  po_status: number | null; po_date: string | null; po_qty: number; po_rate: number
  grn_id: number | null; grn_no: string | null; grn_date: string | null; grn_status: number | null
  grn_qty: number; grn_rate: number; grn_value: number
  closed_for_po: boolean
}

/** The Excel writes "Jun 3, 2024"; that is what every saved line carries and
 *  what the screens print. Keep the same shape so old and new lines read alike. */
export function excelDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''))
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** The material cell the Excel shows: "<type> - <subtype>-<name>". The parser's
 *  cleanMaterial/extractDiscipline are then applied to it, so the strings the
 *  Warehouse catalogue matched on (wh_items.in4_name) come out byte-identical. */
export function excelMaterialCell(r: Pick<In4IndentRow, 'material_type' | 'material_subtype' | 'material_name'>): string {
  return `${r.material_type} - ${r.material_subtype}-${r.material_name}`
}

/** The site header the Excel puts in column 0: "<project> - <sub-project>". */
export function excelSiteHeader(r: Pick<In4IndentRow, 'project_name' | 'subproject_name'>): string {
  return `${r.project_name} - ${r.subproject_name}`
}

/** The mirror row for in4_indent_items — the same figures as the LineRecord,
 *  keyed by IN4's own item id so later features (stock reconciliation, the
 *  raise-PO nudge) can join on ids instead of names. */
export interface In4IndentItemRow {
  indent_item_id: number; indent_id: number; indent_no: string; indent_date: string | null; indent_status: number
  project_id: number; project_name: string; subproject_id: number; subproject_name: string
  wo_id: number | null; wo_no: string | null; skill_id: number | null; skill_name: string | null
  material_id: number; material_name: string; material_type: string; material_subtype: string; uom: string
  indent_qty: number; ordered_qty: number; received_qty: number; pending_qty: number; status: LineStatus
  pos: PoEntry[]; grns: GrnEntry[]
}

export function buildTrackerLines(rows: In4IndentRow[], now = Date.now()): LineRecord[] {
  return buildTracker(rows, now).lines
}

export function buildTracker(rows: In4IndentRow[], now = Date.now()): { lines: LineRecord[]; items: In4IndentItemRow[] } {
  // Group by indent item, in document order (indent date, indent id, item id).
  const byItem = new Map<number, In4IndentRow[]>()
  for (const r of rows) {
    const list = byItem.get(r.indent_item_id)
    if (list) list.push(r); else byItem.set(r.indent_item_id, [r])
  }
  const items = [...byItem.values()].sort((a, b) =>
    (a[0].indent_date ?? '').localeCompare(b[0].indent_date ?? '') || a[0].indent_id - b[0].indent_id || a[0].indent_item_id - b[0].indent_item_id)

  const indexByIndent = new Map<string, number>()
  const lines: LineRecord[] = []
  const itemsOut: In4IndentItemRow[] = []
  const _daysSince = (iso: string | null) => (iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null)

  for (const group of items) {
    const first = group[0]
    const idx = indexByIndent.get(first.indent_no) ?? 0
    indexByIndent.set(first.indent_no, idx + 1)

    // POs: one entry per PO line, de-duplicated (the view repeats a PO row for
    // every GRN and issue under it).
    const pos: PoEntry[] = []
    const poByDetail = new Map<number, PoEntry>()
    const grns: GrnEntry[] = []
    const grnSeen = new Set<number>()
    for (const r of group) {
      if (r.po_detail_id != null && r.po_no) {
        let po = poByDetail.get(r.po_detail_id)
        if (!po) {
          po = {
            poNo: r.po_no, poDate: excelDate(r.po_date), supplier: r.po_supplier ?? '',
            qty: r.po_qty, rate: r.po_rate, amount: Math.round(r.po_qty * r.po_rate * 100) / 100,
            draft: r.po_no.startsWith('DRAFT-PO/'),
          }
          poByDetail.set(r.po_detail_id, po); pos.push(po)
        }
        if (r.grn_id != null && r.grn_no && !grnSeen.has(r.grn_id)) {
          grnSeen.add(r.grn_id)
          grns.push({
            grnNo: r.grn_no, grnDate: excelDate(r.grn_date), qty: r.grn_qty, rate: r.grn_rate, value: r.grn_value,
            lagDays: r.po_date && r.grn_date ? daysBetween(r.po_date, r.grn_date) : null,
          })
          po.grnQty = (po.grnQty ?? 0) + r.grn_qty
        }
      }
    }

    let orderedQty = 0, receivedQty = 0, grnValue = 0, firstPoRate = 0
    let oldestPoAge: number | null = null
    const vendors = new Set<string>()
    const lags: number[] = []
    for (const po of pos) {
      orderedQty += po.qty
      if (po.supplier) vendors.add(po.supplier)
      const age = daysSince(po.poDate)
      if (age != null) oldestPoAge = Math.max(oldestPoAge ?? -Infinity, age)
      if (!firstPoRate && po.rate) firstPoRate = po.rate
    }
    for (const g of grns) {
      receivedQty += g.qty; grnValue += g.value
      if (g.lagDays != null) lags.push(g.lagDays)
      if (!firstPoRate && g.rate) firstPoRate = g.rate
    }
    const pendingQty = Math.max(orderedQty - receivedQty, 0)
    let status: LineStatus
    if (pos.length === 0) status = 'no_po'
    else if (receivedQty <= 0) status = 'pending'
    else if (receivedQty < orderedQty) status = 'partial'
    else status = 'received'

    const materialCell = excelMaterialCell(first)
    const site = excelSiteHeader(first)
    lines.push({
      id: `${first.indent_no}|${idx}`,
      indentNo: first.indent_no,
      indentDate: excelDate(first.indent_date),
      subProject: site,
      block: simplifyBlock(site),
      project: first.project_name,
      discipline: extractDiscipline(materialCell),
      material: cleanMaterial(materialCell),
      indentQty: first.indent_qty,
      uom: first.uom,
      pos, grns, invoices: [],
      orderedQty, receivedQty, pendingQty,
      pendingValue: pendingQty * (firstPoRate || 0),
      grnValue,
      invoiceQty: 0, invoiceAmount: 0,
      supplier: pos[0]?.supplier ?? '',
      vendorCount: vendors.size,
      oldestPoAgeDays: oldestPoAge === -Infinity ? null : oldestPoAge,
      indentAgeDays: _daysSince(first.indent_date),
      avgGrnLagDays: lags.length ? Math.round(lags.reduce((s, x) => s + x, 0) / lags.length) : null,
      status,
    })
    itemsOut.push({
      indent_item_id: first.indent_item_id, indent_id: first.indent_id, indent_no: first.indent_no, indent_date: first.indent_date, indent_status: first.indent_status,
      project_id: first.project_id, project_name: first.project_name, subproject_id: first.subproject_id, subproject_name: first.subproject_name,
      wo_id: first.wo_id, wo_no: first.wo_no, skill_id: first.skill_id, skill_name: first.wo_skill_name,
      material_id: first.material_id, material_name: first.material_name, material_type: first.material_type, material_subtype: first.material_subtype, uom: first.uom,
      indent_qty: first.indent_qty, ordered_qty: orderedQty, received_qty: receivedQty, pending_qty: pendingQty, status,
      pos, grns,
    })
  }
  return { lines, items: itemsOut }
}

/** The blob procurement_tracker_state holds — the same shape the upload route
 *  writes (app/api/procurement-tracker/analyse/route.ts). */
export interface TrackerStoredState {
  format: 'banded' | 'flat'
  fileName: string
  savedAt: string
  projects: ProjectSummary[]
  pendingLineCount: number
  totalGrnValue: number
  pendingValue: number
  indentStatuses: IndentStatusSnapshot[]
  lineStatuses: LineStatusSnapshot[]
}

export function buildTrackerState(lines: LineRecord[], fileName: string, savedAt: string): TrackerStoredState {
  const projects = buildProjectSummaries(lines)
  const allIndents = projects.flatMap(p => p.indents)
  return {
    format: 'banded',
    fileName,
    savedAt,
    projects,
    pendingLineCount: projects.reduce((s, p) => s + p.pendingLineCount, 0),
    totalGrnValue: projects.reduce((s, p) => s + p.totalGrnValue, 0),
    pendingValue: projects.reduce((s, p) => s + p.pendingValue, 0),
    indentStatuses: allIndents.map(i => ({ indentNo: i.indentNo, status: i.status, pendingValue: i.pendingValue })),
    lineStatuses: lines.map(l => ({ id: l.id, status: l.status, pendingQty: l.pendingQty })),
  }
}

/** How IN4-now compares with the last upload, per project: line counts and
 *  the three headline figures. Used for the shadow verdict on /admin/in4. */
export interface TrackerComparison {
  comparedAt: string
  uploadSavedAt: string | null
  totals: { hubLines: number; in4Lines: number; hubPending: number; in4Pending: number; hubPendingValue: number; in4PendingValue: number; hubGrnValue: number; in4GrnValue: number }
  projects: Array<{ project: string; hubLines: number; in4Lines: number; hubPending: number; in4Pending: number; hubPendingValue: number; in4PendingValue: number }>
}

export function compareTracker(hub: TrackerStoredState | null, in4: TrackerStoredState): TrackerComparison {
  const byName = new Map<string, { hubLines: number; in4Lines: number; hubPending: number; in4Pending: number; hubPendingValue: number; in4PendingValue: number }>()
  const slot = (name: string) => { let s = byName.get(name); if (!s) { s = { hubLines: 0, in4Lines: 0, hubPending: 0, in4Pending: 0, hubPendingValue: 0, in4PendingValue: 0 }; byName.set(name, s) } return s }
  for (const p of hub?.projects ?? []) { const s = slot(p.projectName); s.hubLines += p.lines.length; s.hubPending += p.pendingLineCount; s.hubPendingValue += p.pendingValue }
  for (const p of in4.projects) { const s = slot(p.projectName); s.in4Lines += p.lines.length; s.in4Pending += p.pendingLineCount; s.in4PendingValue += p.pendingValue }
  const projects = [...byName.entries()].map(([project, s]) => ({ project, ...s })).sort((a, b) => (b.in4Lines + b.hubLines) - (a.in4Lines + a.hubLines))
  return {
    comparedAt: new Date().toISOString(),
    uploadSavedAt: hub?.savedAt ?? null,
    totals: {
      hubLines: hub?.lineStatuses.length ?? 0, in4Lines: in4.lineStatuses.length,
      hubPending: hub?.pendingLineCount ?? 0, in4Pending: in4.pendingLineCount,
      hubPendingValue: hub?.pendingValue ?? 0, in4PendingValue: in4.pendingValue,
      hubGrnValue: hub?.totalGrnValue ?? 0, in4GrnValue: in4.totalGrnValue,
    },
    projects,
  }
}
