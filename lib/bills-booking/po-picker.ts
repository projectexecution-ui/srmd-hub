import { trustOf } from './daily'
import type { PickableOrder } from './orders'

/** The purchase orders you can bill against, assembled from IN4.
 *
 *  The work-order side of this lives in wo-picker.ts and reads exactly the same
 *  way. What is different about a purchase order is worth stating once:
 *
 *  1. A PO carries no sub-project of its own — only its LINES do. 1,402 of the
 *     1,451 POs are entirely within one sub-project; the 49 that are not get
 *     booked to the one carrying the most value, and the screen says how many
 *     it spans so nobody finds that out by accident.
 *
 *  2. The bills against it are in `in4_supplier_certificates`, one row per
 *     bill, which is the direct twin of `in4_wo_certificates`. Its money chain
 *     reconciles better than the work-order side does:
 *         landed − tax deducted − advance − debit notes − retention = payable
 *              on 1,334 of 1,376 (97%)
 *         payable − paid = outstanding
 *              on 1,376 of 1,376 (100%)
 *
 *  3. That table also holds ADVANCE certificates — 244 of them, ₹9.9 Cr. They
 *     are not bills and are excluded here: an advance is recovered out of later
 *     bills, so counting it as billed would show a PO as spent twice.
 *
 *  4. Not every PO can be billed against. IN4 only issues a real number once it
 *     is approved; everything else — draft, submitted, awaiting a budget
 *     revision — carries a placeholder "DRAFT-PO/…" number, and you cannot
 *     receive a supplier bill quoting a number that does not exist yet.
 *     Terminated and cancelled orders are numbered but dead.
 *
 *  Pure: the page fetches, this decides. */

/** Statuses that mean the order is over. Matched lowercased. */
const DEAD_PO = new Set(['cancelled', 'terminated'])
/** IN4's placeholder prefix for an order it has not numbered yet. */
const UNISSUED = 'draft-'
/** A certificate that never happened. */
const DEAD_CERT = new Set(['cancelled', 'reversed'])

export interface PoRow {
  po_id: number
  po_no: string | null
  supplier_id: number | null
  project_id: number | null
  po_value: number | null
  status: string | null
}

export interface PoItemRow {
  po_id: number
  subproject_id: number | null
  material_value: number | null
}

export interface SupplierCertRow {
  po_id: number | null
  /** `payment` is a bill. `advance` is not — see note 3 above. */
  kind: string | null
  certificate_no: string | null
  certificate_date: string | null
  status_name?: string | null
  category: string | null
  certified_amt: number | null
  landed_cost: number | null
  retention: number | null
}

export function buildPoList(
  pos: PoRow[], items: PoItemRow[], certs: SupplierCertRow[], suppliers: Map<number, string>,
): PickableOrder[] {
  // Where each PO books: the sub-project its lines put the most money into.
  const byPo = new Map<number, Map<number, number>>()
  for (const i of items) {
    if (i.subproject_id == null) continue
    let m = byPo.get(i.po_id)
    if (!m) { m = new Map(); byPo.set(i.po_id, m) }
    m.set(i.subproject_id, (m.get(i.subproject_id) ?? 0) + Number(i.material_value || 0))
  }

  const agg = new Map<number, {
    billed: number; certified: number; retention: number; bills: number
    lastNo: string | null; lastDate: string | null; lastCategory: string | null
    subFallback: number | null
  }>()

  for (const c of certs) {
    if (c.po_id == null) continue
    if ((c.kind ?? '').trim().toLowerCase() !== 'payment') continue
    if (DEAD_CERT.has((c.status_name ?? '').trim().toLowerCase())) continue
    let a = agg.get(c.po_id)
    if (!a) {
      a = { billed: 0, certified: 0, retention: 0, bills: 0, lastNo: null, lastDate: null, lastCategory: null, subFallback: null }
      agg.set(c.po_id, a)
    }
    a.billed += Number(c.landed_cost || 0)
    a.certified += Number(c.certified_amt || 0)
    a.retention += Number(c.retention || 0)
    a.bills++
    const on = c.certificate_date ?? ''
    if (!a.lastDate || on > a.lastDate) {
      a.lastDate = on
      a.lastNo = c.certificate_no ?? null
      a.lastCategory = c.category ?? null
    }
  }

  const out: PickableOrder[] = []
  for (const p of pos) {
    const no = p.po_no?.trim()
    if (!no) continue
    if (no.toLowerCase().startsWith(UNISSUED)) continue
    if (DEAD_PO.has((p.status ?? '').trim().toLowerCase())) continue

    const a = agg.get(p.po_id)
    const spread = byPo.get(p.po_id)
    // The sub-project carrying the most value. A tie falls to the lower id so
    // the same PO always lands in the same place.
    let sub: number | null = null
    let best = -1
    for (const [sid, val] of spread ?? []) {
      if (val > best || (val === best && sub != null && sid < sub)) { best = val; sub = sid }
    }

    const orderedGross = Number(p.po_value || 0)
    const billedGross = a?.billed ?? 0
    const pct = a && a.certified > 0 ? Math.round((a.retention / a.certified) * 1000) / 10 : null

    out.push({
      kind: 'PO',
      orderId: p.po_id,
      orderNo: no,
      projectId: p.project_id ?? null,
      subprojectId: sub,
      subprojectCount: spread?.size ?? 0,
      categoryId: null,
      // IN4 writes the skill on the bill, not the order: "12 (M) Finishes". A
      // bill spanning two skills lists both, comma separated — the first is the
      // one the money mostly sits under, and a guess between two is worse than
      // taking IN4's own first answer.
      categoryName: firstCategory(a?.lastCategory ?? null),
      // A purchase order has no scope field. Asked for rather than invented.
      workDescription: null,
      partyId: p.supplier_id,
      party: (p.supplier_id != null && suppliers.get(p.supplier_id)) || '',
      orderedGross,
      billedGross,
      balance: Math.max(0, orderedGross - billedGross),
      retentionPct: pct,
      trust: trustOf(no),
      bills: a?.bills ?? 0,
      lastBillNo: a?.lastNo ?? null,
      status: p.status,
    })
  }

  // Most recently raised first — the order somebody is billing against today is
  // almost never the oldest one on the project.
  out.sort((a, b) => b.orderId - a.orderId)
  return out
}

/** "03 (M) Civil,12 (M) Finishes" → "03 (M) Civil". */
function firstCategory(raw: string | null): string | null {
  const first = raw?.split(',')[0]?.trim()
  return first || null
}
