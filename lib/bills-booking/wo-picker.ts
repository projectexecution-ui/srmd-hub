import type { SupabaseClient } from '@supabase/supabase-js'
import { trustOf } from './daily'
import { loadOutOfScope, rowOutOfScope } from './scope'
import { buildPoList, type PoRow, type PoItemRow, type SupplierCertRow } from './po-picker'
import type { PickableOrder } from './orders'

/** The orders you can bill against, assembled from IN4 so the entry form stops
 *  being a page of blank boxes.
 *
 *  Picking an order should fill the contractor or supplier, the ordered value,
 *  what has already been billed, the trust and the next RA number — because IN4
 *  knows every one of those and making somebody retype them is how the abstract
 *  number ends up wrong in Zoho. Only what IN4 genuinely cannot know is left to
 *  type.
 *
 *  Work orders are built here; purchase orders in po-picker.ts, which explains
 *  what is different about them. Both come out as `PickableOrder` so the form
 *  and the picker only ever branch on `kind`.
 *
 *  If there is no order at all, nothing here applies and every field stays
 *  editable. That case is a third of all bills and must not feel like an
 *  error. */

export type { PickableOrder } from './orders'

const DEAD = new Set(['cancelled', 'reversed'])

interface WoRow {
  wo_id: number; display_no: string | null; contractor_id: number | null
  wo_value: number | null; wo_gross_value: number | null; wo_retention_amt: number | null
  status_name: string | null
  subproject_id: number | null; category_id: number | null; work_description: string | null
}
interface CertRow {
  wo_id: number; project_id: number | null; subproject_id: number | null; status_name: string | null
  gross_bill_amt: number | null; retention_amt: number | null
  certified_amt: number | null; invoice_no: string | null; creation_dt: string | null
}

export function buildPickList(
  wos: WoRow[], certs: CertRow[], contractors: Map<number, string>,
): PickableOrder[] {
  const agg = new Map<number, {
    projectId: number | null; billed: number; certified: number; retention: number
    bills: number; lastNo: string | null; lastDate: string | null
  }>()

  for (const c of certs) {
    if (DEAD.has((c.status_name ?? '').trim().toLowerCase())) continue
    let a = agg.get(c.wo_id)
    if (!a) { a = { projectId: null, billed: 0, certified: 0, retention: 0, bills: 0, lastNo: null, lastDate: null }; agg.set(c.wo_id, a) }
    if (a.projectId == null && c.project_id != null) a.projectId = c.project_id
    a.billed += Number(c.gross_bill_amt || 0)
    a.certified += Number(c.certified_amt || 0)
    a.retention += Number(c.retention_amt || 0)
    a.bills++
    if (c.creation_dt && (!a.lastDate || c.creation_dt > a.lastDate)) {
      a.lastDate = c.creation_dt
      a.lastNo = c.invoice_no ?? null
    }
  }

  const out: PickableOrder[] = []
  for (const w of wos) {
    if (!w.display_no) continue
    const a = agg.get(w.wo_id)
    const orderedGross = Number(w.wo_gross_value || 0)
    const billedGross = a?.billed ?? 0
    // Derived from what IN4 actually deducted, not assumed: retention over the
    // basic certified value is the rate that has really been applied.
    const pct = a && a.certified > 0 ? Math.round((a.retention / a.certified) * 1000) / 10 : null
    out.push({
      kind: 'WO',
      orderId: w.wo_id,
      orderNo: w.display_no,
      projectId: a?.projectId ?? null,
      subprojectId: w.subproject_id ?? null,
      // A work order names exactly one sub-project, on the order itself.
      subprojectIds: w.subproject_id == null ? [] : [w.subproject_id],
      categoryId: w.category_id ?? null,
      categoryName: null,
      workDescription: w.work_description?.trim() || null,
      partyId: w.contractor_id,
      party: (w.contractor_id != null && contractors.get(w.contractor_id)) || '',
      orderedGross,
      billedGross,
      balance: Math.max(0, orderedGross - billedGross),
      retentionPct: pct,
      trust: trustOf(w.display_no),
      bills: a?.bills ?? 0,
      lastBillNo: a?.lastNo ?? null,
      status: w.status_name,
    })
  }

  // Most recently numbered first — the order somebody is billing against today
  // is almost never the oldest one on the project.
  out.sort((a, b) => b.orderId - a.orderId)
  return out
}

export interface PickData {
  wos: PickableOrder[]
  pos: PickableOrder[]
  projects: Array<{ id: number; name: string }>
}

export async function loadPickList(sb: SupabaseClient): Promise<PickData> {
  const pageAll = async <T,>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
      if (error) throw new Error(`${table}: ${error.message}`)
      const rows = (data ?? []) as unknown as T[]
      out.push(...rows)
      if (rows.length < 1000) return out
    }
  }

  const [wos, certs, parties, projects, pos, poItems, poCerts, materials] = await Promise.all([
    pageAll<WoRow>('in4_work_orders', 'wo_id, display_no, contractor_id, wo_value, wo_gross_value, wo_retention_amt, status_name, subproject_id, category_id, work_description'),
    pageAll<CertRow>('in4_wo_certificates', 'wo_id, project_id, subproject_id, status_name, gross_bill_amt, retention_amt, certified_amt, invoice_no, creation_dt'),
    pageAll<{ id: number; name: string; kind: string }>('in4_parties', 'id, name, kind'),
    pageAll<{ id: number; name: string }>('in4_projects', 'id, name'),
    pageAll<PoRow>('in4_purchase_orders', 'po_id, po_no, supplier_id, project_id, po_value, status'),
    // Where the PO books and what it is for — both live on its lines.
    pageAll<PoItemRow>('in4_po_items', 'po_id, subproject_id, material_id, material_value'),
    pageAll<SupplierCertRow>('in4_supplier_certificates', 'po_id, kind, certificate_no, certificate_date, category, certified_amt, landed_cost, retention'),
    // 4,097 rows, two small columns. A purchase order is a BOQ and its material
    // names are its scope — reading them is the difference between the form
    // filling that field and asking somebody to retype it.
    pageAll<{ id: number; name: string | null }>('in4_materials', 'id, name'),
  ])

  // in4_parties is keyed on (kind, id) — a supplier and a contractor can share
  // an id, so filtering by kind is not optional.
  const contractors = new Map(parties.filter(p => p.kind === 'contractor').map(p => [p.id, p.name]))
  const suppliers = new Map(parties.filter(p => p.kind === 'supplier').map(p => [p.id, p.name]))
  const matNames = new Map(materials.filter(m => m.name).map(m => [m.id, m.name as string]))
  // Billed-to-date and the RA count must not include design or consultancy
  // certificates, or the balance offered on a construction bill is wrong. The
  // orders themselves are filtered on the same list, so a Design order cannot
  // be picked at all — the section does not show that work anywhere.
  const excluded = await loadOutOfScope(sb)
  const inScope = certs.filter(c => !rowOutOfScope(excluded, c.subproject_id))
  const woInScope = wos.filter(w => !rowOutOfScope(excluded, w.subproject_id))

  return {
    wos: buildPickList(woInScope, inScope, contractors),
    // A PO has no sub-project until its lines are read, so it is filtered after
    // it is built rather than before.
    pos: buildPoList(pos, poItems, poCerts, suppliers, matNames)
      .filter(p => !rowOutOfScope(excluded, p.subprojectId)),
    projects,
  }
}
