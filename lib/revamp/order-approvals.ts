// Work orders and purchase orders waiting for approval in IN4, with what an
// approver needs beside every line: the rate against the last rate paid for
// the same thing — a PO line against the last PO for that material, a WO line
// against the last approved WO for the same BOQ item (matched by its name and
// unit; IN4 has no BOQ master, see masters-in4.ts). Live, SELECT only.
//
// Aksha, 10 Sep 2026: "For WO and PO … once Verified in IN4 then comes for
// approval to Atm Head — can we incorporate the last rate and change in rate
// … in the WO / PO section."
//
// Where the pieces are (verified 10 Sep 2026):
//   ENGG_WORK_ORDER (STATUS 1 Submitted · 113 Verify · 60 ReSubmit; SKILL_ID → category)
//   BI.DIM/FACT_ENGG_WORK_ORDER_BOQ   the WO's lines — filled while the WO is still at Verify
//   ENGG_WO_AUDIT_TRAIL               who did what (WO_ID, STATUS, MODIFIED_BY, MODIFIED_DT, REMARKS)
//   PURCH_PURCHASE_ORDER(_ITEMS/_AUDIT_TRAIL), BI.FACT_PURCHASE_ORDER_DETAILS (rate; rows exist at Verify too)
//   BOQ_SUBID on a WO line is the sub-category, not the item — so items match by name.

import { in4QueryCached, in4Config } from '@/lib/in4/db'
import { chainFrom, stageOf, STATUS_NAMES, PENDING_STATUS_IDS, type ChainStep, type AuditRaw } from './indents-tree'
import { buildPriceContext, type PoRateLine, type MaterialContext } from './approver'

export interface OrderLinePending {
  id: number
  /** Material name (PO) or BOQ sub-name (WO). */
  name: string
  description: string | null
  uom: string | null
  qty: number
  rate: number | null
  amount: number
  /** PO only: the indent line it serves. */
  indentQty: number | null
  indentRef: string | null
  /** The key the reference history is looked up by: material id (PO) or normalised BOQ name (WO). */
  refKey: string
}

export interface PendingOrder {
  kind: 'wo' | 'po'
  id: number; ref: string; statusId: number; status: string; stage: ChainStep['stage']
  date: string | null
  party: string | null
  projectId: number | null; project: string | null; subprojectId: number | null; subproject: string | null
  category: string | null
  /** IN4's category (skill) and sub-category ids — where the order sits in the orders tree. */
  categoryId: number | null
  subcategory: string | null
  subcategoryId: number | null
  description: string | null
  value: number
  raisedBy: string | null
  since: string | null
  chain: ChainStep[]
  lines: OrderLinePending[]
  /** Reference history per line key, judged from this document's own project. */
  refs: Map<string, MaterialContext>
  /** Whose turn it is in IN4: Verify → the Atm Head; Submitted → the verifier; ReSubmit → back with whoever raised it. */
  turn: 'approver' | 'verifier' | 'raiser'
}

export const turnOf = (statusId: number): PendingOrder['turn'] => (statusId === 113 || statusId === 117 ? 'approver' : statusId === 60 ? 'raiser' : 'verifier')
export const TURN_LABEL: Record<PendingOrder['turn'], string> = { approver: 'Atm Head', verifier: 'verifier', raiser: 'back with raiser' }

export interface OrderApprovals { orders: PendingOrder[]; in4: 'live' | 'not-configured' | 'unavailable'; error: string | null }

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  const t = d.toISOString()
  return t.startsWith('1900-01-01') ? null : t
}

/** "7. Protection Plaster", "Protection Plaster" and "protection plaster." are the same BOQ item; the unit must match too. */
export const stripBoqNumber = (name: string | null | undefined) => String(name ?? '').replace(/^\s*\d+\s*[.)\-:]\s*/, '').trim()
export const normaliseBoq = (name: string | null | undefined, uom?: string | null) =>
  `${stripBoqNumber(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()}|${String(uom ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`

/** Reference lines keyed by string (BOQ name or material id) → the per-key context, judged from one project. Pure. */
export function referencesFor(lines: readonly (PoRateLine & { key: string })[], keys: readonly string[], projectId: number | null): Map<string, MaterialContext> {
  const index = new Map<string, number>()
  for (const k of keys) if (!index.has(k)) index.set(k, index.size + 1)
  const mapped: PoRateLine[] = lines.filter(l => index.has(l.key)).map(l => ({ ...l, materialId: index.get(l.key) as number }))
  const ctx = buildPriceContext(mapped, projectId)
  const out = new Map<string, MaterialContext>()
  for (const [k, i] of index) { const c = ctx.get(i); if (c) out.set(k, c) }
  return out
}

const like = (v: string) => v.replace(/'/g, "''")

/** Every WO and PO at a pending status — for the given IN4 sub-projects, or all. */
export async function loadOrderApprovals(opts: { subprojectIds?: number[] } = {}): Promise<OrderApprovals> {
  if (!in4Config()) return { orders: [], in4: 'not-configured', error: null }
  if (opts.subprojectIds && opts.subprojectIds.length === 0) return { orders: [], in4: 'live', error: null }
  const scope = (col: string) => (opts.subprojectIds ? ` AND ${col} IN (${opts.subprojectIds.filter(Number.isInteger).join(',') || '-1'})` : '')
  const pendingList = [...PENDING_STATUS_IDS].join(',')
  try {
    const [wos, pos] = await Promise.all([
      in4QueryCached<Record<string, unknown>>(`
        SELECT w.ID, w.DISPLAY_NO, w.STATUS, w.CREATION_DT, w.WORK_DESCRIPTION, w.WORK_ORDER_VALUE, w.SUBPROJECT_ID, w.PROJECT_ID,
               pr.NAME project, sub.SUBPROJECT_NAME subproject, sp.FIRM_NAME party, sk.NAME category, w.SKILL_ID category_id,
               COALESCE(w.SUB_SKILL_ID, w.SUBSKILL_ID) subcategory_id, ssk.NAME subcategory
        FROM ENGG_WORK_ORDER w
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = w.PROJECT_ID
        LEFT JOIN ENGG_SUBPROJECT sub ON sub.ID = w.SUBPROJECT_ID
        LEFT JOIN ENGG_SERVICE_PROVIDER sp ON sp.ID = w.SERVICE_PROVIDER_ID
        LEFT JOIN ENGG_SKILLS_LOOKUP sk ON sk.ID = w.SKILL_ID
        LEFT JOIN ENGG_SKILLS_LOOKUP ssk ON ssk.ID = COALESCE(w.SUB_SKILL_ID, w.SUBSKILL_ID)
        WHERE w.STATUS IN (${pendingList})${scope('w.SUBPROJECT_ID')}
        ORDER BY w.CREATION_DT`),
      in4QueryCached<Record<string, unknown>>(`
        SELECT p.ID, p.DISPLAY_NO, p.STATUS, p.CREATED_DT, p.REMARKS, p.TOTAL_VALUE, p.SUBPROJECT_ID, p.PROJECT_ID, p.PAYMENT_TERMS,
               pr.NAME project, sub.SUBPROJECT_NAME subproject, COALESCE(sp.PrintName, sp.NAME) party
        FROM PURCH_PURCHASE_ORDER p
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = p.PROJECT_ID
        LEFT JOIN ENGG_SUBPROJECT sub ON sub.ID = p.SUBPROJECT_ID
        LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = p.SUPPLIER_ID
        WHERE p.STATUS IN (${pendingList})${scope('p.SUBPROJECT_ID')}
        ORDER BY p.CREATED_DT`),
    ])
    const woIds = wos.map(w => n(w.ID)), poIds = pos.map(p => n(p.ID))
    const [woLines, woAudit, poLines, poAudit] = await Promise.all([
      woIds.length ? in4QueryCached<Record<string, unknown>>(`
        SELECT d.ITEM_ID, d.WO_ID, d.WO_ITEM_NO, d.BOQ_SUBNAME, d.BOQ_DESCRIPTION, d.UOM, f.QUANTITY, f.RATE, f.AMT
        FROM BI.DIM_ENGG_WORK_ORDER_BOQ d JOIN BI.FACT_ENGG_WORK_ORDER_BOQ f ON f.ITEM_ID = d.ITEM_ID
        WHERE d.WO_ID IN (${woIds.join(',')}) ORDER BY d.WO_ID, d.ITEM_ID`) : Promise.resolve([]),
      woIds.length ? in4QueryCached<AuditRaw>(`
        SELECT a.WO_ID doc_id, a.STATUS, a.MODIFIED_DT, LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) who, a.REMARKS
        FROM ENGG_WO_AUDIT_TRAIL a LEFT JOIN HR_EMP_PROFILE e ON e.ID = a.MODIFIED_BY WHERE a.WO_ID IN (${woIds.join(',')})`) : Promise.resolve([]),
      poIds.length ? in4QueryCached<Record<string, unknown>>(`
        SELECT pi.ID, pi.PURCHASE_ORDER_ID po_id, pi.MATERIAL_ID, m.NAME material, u.NAME uom, pi.ORDER_QTY, f.NET_RATE, f.MATERIAL_VALUE, f.LANDED_COST,
               ii.ORDER_QTY indent_qty, i.DISPLAY_NO indent_no, sk.NAME category, ii.WORK_CATEGORY_ID category_id, ii.WORK_SUBCATEGORY_ID subcategory_id, ssk.NAME subcategory
        FROM PURCH_PURCHASE_ORDER_ITEMS pi
        LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = pi.MATERIAL_ID
        LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = m.UNIT_OF_MEASUREMENT
        LEFT JOIN BI.FACT_PURCHASE_ORDER_DETAILS f ON f.ITEM_ID = pi.ID
        LEFT JOIN PURCH_INDENT_ITEMS ii ON ii.ID = pi.INDENT_ITEM_ID
        LEFT JOIN PURCH_INDENT i ON i.ID = ii.INDENT_NO
        LEFT JOIN ENGG_SKILLS_LOOKUP sk ON sk.ID = ii.WORK_CATEGORY_ID
        LEFT JOIN ENGG_SKILLS_LOOKUP ssk ON ssk.ID = ii.WORK_SUBCATEGORY_ID
        WHERE pi.PURCHASE_ORDER_ID IN (${poIds.join(',')}) ORDER BY pi.PURCHASE_ORDER_ID, pi.ID`) : Promise.resolve([]),
      poIds.length ? in4QueryCached<AuditRaw>(`
        SELECT a.PURCHASE_ORDER_ID doc_id, a.STATUS, a.MODIFIED_DT, LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) who, a.REMARKS
        FROM PURCH_PURCHASE_ORDER_AUDIT_TRAIL a LEFT JOIN HR_EMP_PROFILE e ON e.ID = a.MODIFIED_BY WHERE a.PURCHASE_ORDER_ID IN (${poIds.join(',')})`) : Promise.resolve([]),
    ])

    // Reference history: prior approved WO lines with the same BOQ names; prior PO lines for the same materials (never the pending POs themselves).
    // Prior lines are fetched by the item's name with any "7." numbering stripped, so
    // "7. Protection Plaster" on this WO finds "Protection Plaster" on the last one.
    const boqNames = [...new Set(woLines.map(l => stripBoqNumber(s(l.BOQ_SUBNAME))).filter(x => x.length >= 3))]
    const materialIds = [...new Set(poLines.map(l => l.MATERIAL_ID).filter((x): x is number => x != null).map(Number))]
    const [woRefs, poRefs] = await Promise.all([
      boqNames.length ? in4QueryCached<Record<string, unknown>>(`
        SELECT d.BOQ_SUBNAME, d.UOM, d.WO_ID, w.DISPLAY_NO wo_no, w.CREATION_DT, sp.FIRM_NAME party, w.PROJECT_ID, pr.NAME project, f.QUANTITY, f.RATE, f.AMT
        FROM BI.DIM_ENGG_WORK_ORDER_BOQ d
        JOIN BI.FACT_ENGG_WORK_ORDER_BOQ f ON f.ITEM_ID = d.ITEM_ID
        JOIN ENGG_WORK_ORDER w ON w.ID = d.WO_ID
        LEFT JOIN ENGG_SERVICE_PROVIDER sp ON sp.ID = w.SERVICE_PROVIDER_ID
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = w.PROJECT_ID
        WHERE w.STATUS = 2 AND f.RATE > 0 AND (${boqNames.map(x => `d.BOQ_SUBNAME LIKE '%${like(x).replace(/[%_[]/g, ch => `[${ch}]`)}%'`).join(' OR ')})
        ORDER BY w.CREATION_DT DESC`) : Promise.resolve([]),
      materialIds.length ? in4QueryCached<Record<string, unknown>>(`
        SELECT f.MATERIAL_ID, f.PO_ID, h.PO_NO, h.PO_DT, COALESCE(sp.PrintName, sp.NAME) supplier, pr.NAME project, f.PROJECT_ID,
               f.BASE_PO_QTY qty, f.NET_RATE rate, f.MATERIAL_VALUE value, f.GRN_QTY grn_qty
        FROM BI.FACT_PURCHASE_ORDER_DETAILS f
        JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = f.PO_ID
        LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = f.SUPPLIER_ID
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = f.PROJECT_ID
        WHERE f.MATERIAL_ID IN (${materialIds.join(',')}) AND f.NET_RATE > 0 AND h.STATUS_ID = 2 AND f.PO_ID NOT IN (${poIds.join(',') || '-1'})
        ORDER BY h.PO_DT DESC`) : Promise.resolve([]),
    ])
    const woRefLines = woRefs.map(r => ({
      key: normaliseBoq(s(r.BOQ_SUBNAME), s(r.UOM)), materialId: 0, poId: n(r.WO_ID), poNo: s(r.wo_no), date: iso(r.CREATION_DT),
      supplier: s(r.party), project: s(r.project), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID), qty: n(r.QUANTITY), rate: n(r.RATE), value: n(r.AMT), grnQty: 0,
    }))
    const poRefLines = poRefs.map(r => ({
      key: `m${n(r.MATERIAL_ID)}`, materialId: 0, poId: n(r.PO_ID), poNo: s(r.PO_NO), date: iso(r.PO_DT),
      supplier: s(r.supplier), project: s(r.project), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID), qty: n(r.qty), rate: n(r.rate), value: n(r.value), grnQty: n(r.grn_qty),
    }))

    const orders: PendingOrder[] = []
    const statusName = (id: number) => STATUS_NAMES[id] ?? `Status ${id}`
    for (const w of wos) {
      const id = n(w.ID)
      const chain = chainFrom(woAudit.filter(a => a.doc_id === id))
      const lines: OrderLinePending[] = woLines.filter(l => n(l.WO_ID) === id).map(l => ({
        id: n(l.ITEM_ID), name: s(l.BOQ_SUBNAME) ?? '(unnamed item)', description: s(l.BOQ_DESCRIPTION), uom: s(l.UOM),
        qty: n(l.QUANTITY), rate: l.RATE == null ? null : n(l.RATE), amount: n(l.AMT), indentQty: null, indentRef: null,
        refKey: normaliseBoq(s(l.BOQ_SUBNAME), s(l.UOM)),
      }))
      const projectId = w.PROJECT_ID == null ? null : n(w.PROJECT_ID)
      orders.push({
        kind: 'wo', id, ref: s(w.DISPLAY_NO) ?? `WO ${id}`, statusId: n(w.STATUS), status: statusName(n(w.STATUS)), stage: stageOf(n(w.STATUS)),
        date: iso(w.CREATION_DT), party: s(w.party), projectId, project: s(w.project), subprojectId: w.SUBPROJECT_ID == null ? null : n(w.SUBPROJECT_ID), subproject: s(w.subproject),
        category: s(w.category), categoryId: w.category_id == null ? null : n(w.category_id), subcategory: s(w.subcategory), subcategoryId: w.subcategory_id == null ? null : n(w.subcategory_id),
        description: s(w.WORK_DESCRIPTION), value: n(w.WORK_ORDER_VALUE) || lines.reduce((t, l) => t + l.amount, 0),
        turn: turnOf(n(w.STATUS)), raisedBy: chain[0]?.by ?? null, since: chain[chain.length - 1]?.at ?? iso(w.CREATION_DT), chain, lines,
        refs: referencesFor(woRefLines, lines.map(l => l.refKey), projectId),
      })
    }
    for (const p of pos) {
      const id = n(p.ID)
      const chain = chainFrom(poAudit.filter(a => a.doc_id === id))
      const mine = poLines.filter(l => n(l.po_id) === id)
      const lines: OrderLinePending[] = mine.map(l => ({
        id: n(l.ID), name: s(l.material) ?? `Material ${l.MATERIAL_ID}`, description: null, uom: s(l.uom),
        qty: n(l.ORDER_QTY), rate: l.NET_RATE == null ? null : n(l.NET_RATE), amount: n(l.LANDED_COST) || n(l.MATERIAL_VALUE),
        indentQty: l.indent_qty == null ? null : n(l.indent_qty), indentRef: s(l.indent_no), refKey: `m${n(l.MATERIAL_ID)}`,
      }))
      const projectId = p.PROJECT_ID == null ? null : n(p.PROJECT_ID)
      orders.push({
        kind: 'po', id, ref: s(p.DISPLAY_NO) ?? `PO ${id}`, statusId: n(p.STATUS), status: statusName(n(p.STATUS)), stage: stageOf(n(p.STATUS)),
        date: iso(p.CREATED_DT), party: s(p.party), projectId, project: s(p.project), subprojectId: p.SUBPROJECT_ID == null ? null : n(p.SUBPROJECT_ID), subproject: s(p.subproject),
        category: s(mine[0]?.category), categoryId: mine[0]?.category_id == null ? null : n(mine[0].category_id), subcategory: s(mine[0]?.subcategory), subcategoryId: mine[0]?.subcategory_id == null ? null : n(mine[0].subcategory_id),
        description: [s(p.REMARKS), s(p.PAYMENT_TERMS) ? `terms: ${s(p.PAYMENT_TERMS)}` : null].filter(Boolean).join(' · ') || null,
        value: n(p.TOTAL_VALUE) || lines.reduce((t, l) => t + l.amount, 0),
        turn: turnOf(n(p.STATUS)), raisedBy: chain[0]?.by ?? null, since: chain[chain.length - 1]?.at ?? iso(p.CREATED_DT), chain, lines,
        refs: referencesFor(poRefLines, lines.map(l => l.refKey), projectId),
      })
    }
    // The Atm Head's own turn first, then the rest, oldest first within each.
    const rank = { approver: 0, verifier: 1, raiser: 2 }
    orders.sort((a, b) => rank[a.turn] - rank[b.turn] || String(a.since ?? '').localeCompare(String(b.since ?? '')))
    return { orders, in4: 'live', error: null }
  } catch (e) {
    return { orders: [], in4: 'unavailable', error: e instanceof Error ? e.message : String(e) }
  }
}
