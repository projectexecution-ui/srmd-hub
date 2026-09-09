// The Indents tab in the Internal Estimate's shape: category → sub-category →
// indent → items, with the COMPLETE cycle on every indent — Indent (Draft →
// Submitted → Verify → Approved, who and when, from IN4's own audit trail) →
// PO (number, status, its own audit trail) → GRN (received, when). Live from
// IN4; nothing is stored. Above the tree sit the approvals waiting in IN4.
//
// ── Where each piece is in IN4 (9 Sep 2026) ─────────────────────────────────
//   PURCH_INDENT                    the indent: number, date, status, WO, who raised it
//   PURCH_INDENT_AUDIT_TRAIL        every status change with user and time
//   PURCH_INDENT_ITEMS              lines: material, qty, unit, category, sub-category
//   PURCH_PURCHASE_ORDER_ITEMS      PO lines, each pointing at its indent line
//                                   (INDENT_ITEM_ID — set on all 4,944 lines)
//   BI.FACT_PURCHASE_ORDER_DETAILS  per PO line: qty, rate, value, landed cost, GRN qty
//   PURCH_PURCHASE_ORDER(_AUDIT_TRAIL) the PO and its status history
//   BI.FACT_PURCHASE_GRN_DETAILS    receipts per PO and material; DIM header for number/date
//   HR_EMP_PROFILE                  the people behind MODIFIED_BY / CREATED_BY
//
// Status ids (COMMON_STATUS_LOOKUP): 13 Draft · 1 Submitted · 113 Verify ·
// 2 Approved · 60 ReSubmit · 77 Amended & Submitted · 117 Amended & Verify ·
// 6 Cancelled · 66 Terminated · 65 Locked. The audit trail on IND/SRASSK/NGH/
// 2026-27/151 reads Draft 15:36 → Submitted 15:48 → Verify 15:48, all by the
// same engineer; IND …/149 then Approved by a different user 74 minutes later.
// That is the chain, and it is IN4's, not ours.
//
// Read-only. Approval itself happens in IN4; this shows what is waiting and
// tells the Atm Head (see lib/in4/approvals-watch.ts).

import { createClient } from '@/lib/supabase/server'
import { in4Query, in4Config } from '@/lib/in4/db'

/* ── Statuses ───────────────────────────────────────────────────────────── */

/** Statuses that mean "someone in IN4 has to act". */
export const PENDING_STATUS_IDS = new Set([1, 113, 60, 77, 117])
/** Statuses that take a document out of the cycle. */
export const CLOSED_STATUS_IDS = new Set([6, 66])
export const STATUS_NAMES: Record<number, string> = {
  13: 'Draft', 1: 'Submitted', 113: 'Verify', 2: 'Approved', 60: 'ReSubmit', 77: 'Amended & Submitted',
  117: 'Amended & Verify', 78: 'Amended & Approved', 76: 'Amended & Draft', 6: 'Cancelled', 66: 'Terminated', 65: 'Locked', 9: 'Verified',
}
export const stageOf = (statusId: number | null): 'draft' | 'submitted' | 'verify' | 'approved' | 'closed' | 'other' => {
  if (statusId == null) return 'other'
  if (statusId === 13 || statusId === 76) return 'draft'
  if (statusId === 1 || statusId === 77 || statusId === 60) return 'submitted'
  if (statusId === 113 || statusId === 117) return 'verify'
  if (statusId === 2 || statusId === 78 || statusId === 65 || statusId === 9) return 'approved'
  if (CLOSED_STATUS_IDS.has(statusId)) return 'closed'
  return 'other'
}

/* ── Raw rows (IN4 column names, as the SQL aliases them) ──────────────── */

export interface IndentRaw {
  ID: number; DISPLAY_NO: string | null; CREATION_DT: unknown; STATUS: number | null
  SUBPROJECT_ID: number | null; WORK_ORDER_ID: number | null; wo_no: string | null
  MATERIAL_TYPE: string | null; REMARKS: string | null; raised_by: string | null
  PROJECT_ID?: number | null; project?: string | null; subproject?: string | null
}
export interface IndentItemRaw {
  ID: number; indent_id: number; MATERIAL_ID: number | null; material: string | null
  ORDER_QTY: unknown; uom: string | null; WORK_CATEGORY_ID: number | null; WORK_SUBCATEGORY_ID: number | null
  /** IN4's own "no more PO against this line" flag (191 of 5,120 lines). */
  CLOSED_FOR_PO?: unknown
}

/** How long a step may wait before it is late — the same days the Indent → PO
 *  digest uses (raise a PO within 2 days of approval; chase a delivery after 7). */
export const SLA_DAYS = { 'indent approval': 2, 'raise PO': 2, 'PO approval': 2, 'delivery': 7 } as const
export interface PoLineRaw {
  po_item_id: number; INDENT_ITEM_ID: number; ORDER_QTY: unknown
  po_id: number; po_no: string | null; po_status: number | null; po_date: unknown; supplier: string | null
  NET_RATE: unknown; LANDED_COST: unknown; MATERIAL_VALUE: unknown; GRN_QTY: unknown
}
export interface GrnRaw {
  PO_ID: number; MATERIAL_ID: number | null; GRN_ID: number; GRN_NO: string | null; GRN_DT: unknown
  grn_status: string | null; RECIEVED_QTY: unknown; GRN_MATERIAL_COST: unknown
}
export interface AuditRaw { doc_id: number; STATUS: number | null; MODIFIED_DT: unknown; who: string | null; REMARKS: string | null }
export interface SkillName { id: number; name: string; code: string | null }

/* ── Built shapes ───────────────────────────────────────────────────────── */

export interface ChainStep { stage: 'draft' | 'submitted' | 'verify' | 'approved' | 'closed' | 'other'; status: string; at: string | null; by: string | null; remark: string | null }

export interface GrnRow { grnId: number; grnNo: string | null; date: string | null; status: string | null; qty: number; value: number }

export interface PoRow {
  poId: number; poNo: string | null; statusId: number | null; status: string; stage: ChainStep['stage']
  date: string | null; supplier: string | null
  /** For THIS indent line. */
  qty: number; rate: number | null; value: number; grnQty: number
  chain: ChainStep[]
  grns: GrnRow[]
}

export interface IndentItem {
  id: number; material: string; uom: string | null
  categoryId: number | null; subcategoryId: number | null
  qty: number
  poQty: number; poValue: number; receivedQty: number; receivedValue: number
  pos: PoRow[]
  /** What is still to be done on this line, in words. */
  next: 'indent approval' | 'raise PO' | 'PO approval' | 'delivery' | 'done' | 'closed'
  /** IN4 says no more PO will be raised against this line. */
  closedForPo: boolean
  /** Since when the line has been waiting for `next` (ISO), and for how many days. */
  waitingSince: string | null
  waitingDays: number | null
  /** Waiting longer than SLA_DAYS allows for that step. */
  late: boolean
}

export interface IndentRow {
  id: number; ref: string; date: string | null; statusId: number | null; status: string; stage: ChainStep['stage']
  projectId: number | null; project: string | null; subproject: string | null
  woNo: string | null; materialType: string | null; remarks: string | null; raisedBy: string | null
  chain: ChainStep[]
  items: IndentItem[]
  poValue: number; receivedValue: number
  awaitingPo: number; awaitingDelivery: number
  /** Distinct POs across the items, each with its stage — the cycle's middle. */
  pos: Array<{ poId: number; poNo: string | null; status: string; stage: ChainStep['stage']; date: string | null; supplier: string | null; value: number; grnQty: number; qty: number }>
}

export interface IndentsSubRow { id: string; name: string; code: string | null; indents: IndentRow[]; items: number; poValue: number; receivedValue: number; awaitingPo: number; awaitingDelivery: number }
export interface IndentsCatRow { id: string; name: string; code: string | null; subs: IndentsSubRow[]; indents: number; items: number; poValue: number; receivedValue: number; awaitingPo: number; awaitingDelivery: number }

export interface PendingApproval {
  kind: 'indent' | 'po'
  id: number; ref: string; status: string; stage: ChainStep['stage']
  since: string | null; by: string | null; what: string | null
  value: number | null
  /** The indent(s) a PO serves, or the WO an indent is for. */
  context: string | null
  /** IN4 project name — shown on the portal-wide list. */
  project?: string | null
}

export interface IndentsTree {
  cats: IndentsCatRow[]
  pending: PendingApproval[]
  totals: { indents: number; items: number; poValue: number; receivedValue: number; awaitingPo: number; awaitingDelivery: number; hidden: number }
  in4: 'live' | 'not-configured' | 'unavailable'
  linked: boolean
  error: string | null
}

const EMPTY: IndentsTree = { cats: [], pending: [], totals: { indents: 0, items: 0, poValue: 0, receivedValue: 0, awaitingPo: 0, awaitingDelivery: 0, hidden: 0 }, in4: 'unavailable', linked: false, error: null }

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  const t = d.toISOString()
  return t.startsWith('1900-01-01') ? null : t
}
const statusName = (id: number | null) => (id == null ? '—' : STATUS_NAMES[id] ?? `Status ${id}`)

/** Audit rows → ordered steps. Pure. */
export function chainFrom(rows: readonly AuditRaw[]): ChainStep[] {
  return [...rows]
    .sort((a, b) => String(iso(a.MODIFIED_DT) ?? '').localeCompare(String(iso(b.MODIFIED_DT) ?? '')))
    .map(r => ({ stage: stageOf(r.STATUS), status: statusName(r.STATUS), at: iso(r.MODIFIED_DT), by: s(r.who), remark: s(r.REMARKS) }))
}

/**
 * Everything into the tree. Pure, so the cycle logic — which line waits for
 * what — is tested on IND …/151 (at Verify, no PO) and PO 92/93 shapes rather
 * than eyeballed on a page.
 */
export function buildIndentsTree(
  indents: readonly IndentRaw[],
  items: readonly IndentItemRaw[],
  poLines: readonly PoLineRaw[],
  grns: readonly GrnRaw[],
  indentAudit: readonly AuditRaw[],
  poAudit: readonly AuditRaw[],
  skills: readonly SkillName[],
  opts: { showClosed?: boolean; now?: string } = {},
): Omit<IndentsTree, 'in4' | 'linked' | 'error'> {
  const skill = new Map(skills.map(k => [k.id, k]))
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now()
  const daysSince = (at: string | null) => (at ? Math.max(0, Math.floor((nowMs - Date.parse(at)) / 86400000)) : null)
  const auditByIndent = groupBy(indentAudit, a => a.doc_id)
  const auditByPo = groupBy(poAudit, a => a.doc_id)
  const linesByItem = groupBy(poLines, l => l.INDENT_ITEM_ID)
  const grnsByPoMaterial = groupBy(grns, g => `${g.PO_ID}|${g.MATERIAL_ID ?? ''}`)
  const itemsByIndent = groupBy(items, i => i.indent_id)

  const rows: IndentRow[] = []
  let hidden = 0
  for (const ind of [...indents].sort((a, b) => String(iso(b.CREATION_DT) ?? '').localeCompare(String(iso(a.CREATION_DT) ?? '')))) {
    const stage = stageOf(ind.STATUS)
    if (stage === 'closed' && !opts.showClosed) { hidden++; continue }
    const built: IndentItem[] = (itemsByIndent.get(ind.ID) ?? []).map(it => {
      const pos: PoRow[] = (linesByItem.get(it.ID) ?? [])
        .filter(l => !CLOSED_STATUS_IDS.has(l.po_status ?? -1))
        .map(l => {
          const g = (grnsByPoMaterial.get(`${l.po_id}|${it.MATERIAL_ID ?? ''}`) ?? [])
            .map(x => ({ grnId: x.GRN_ID, grnNo: s(x.GRN_NO), date: iso(x.GRN_DT), status: s(x.grn_status), qty: n(x.RECIEVED_QTY), value: n(x.GRN_MATERIAL_COST) }))
            .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
          return {
            poId: l.po_id, poNo: s(l.po_no), statusId: l.po_status, status: statusName(l.po_status), stage: stageOf(l.po_status),
            date: iso(l.po_date), supplier: s(l.supplier),
            qty: n(l.ORDER_QTY), rate: l.NET_RATE == null ? null : Number(l.NET_RATE), value: n(l.LANDED_COST) || n(l.MATERIAL_VALUE),
            grnQty: n(l.GRN_QTY), chain: chainFrom(auditByPo.get(l.po_id) ?? []), grns: g,
          }
        })
      const qty = n(it.ORDER_QTY)
      const poQty = pos.reduce((t, p) => t + p.qty, 0)
      const poValue = pos.reduce((t, p) => t + p.value, 0)
      // Received per PO line is IN4's own GRN_QTY on the PO line; the value is
      // the landed cost in the same proportion when the receipt is partial.
      const receivedQty = pos.reduce((t, p) => t + p.grnQty, 0)
      const receivedValue = pos.reduce((t, p) => t + (p.qty > 0 ? p.value * Math.min(1, p.grnQty / p.qty) : 0), 0)
      const approvedPos = pos.filter(p => p.stage === 'approved')
      const closedForPo = it.CLOSED_FOR_PO === true || it.CLOSED_FOR_PO === 1 || it.CLOSED_FOR_PO === '1'
      // IN4's own "closed for PO" flag wins over our arithmetic: a line the
      // store closed at 1,900 of 2,000 is not waiting for a PO of 100.
      const next: IndentItem['next'] =
        stage === 'closed' ? 'closed'
        : stage !== 'approved' ? 'indent approval'
        : poQty + 0.001 < qty && !closedForPo ? 'raise PO'
        : approvedPos.length < pos.length ? 'PO approval'
        : receivedQty + 0.001 < poQty ? 'delivery'
        : 'done'
      const indentChain = chainFrom(auditByIndent.get(ind.ID) ?? [])
      const lastIndentStep = indentChain[indentChain.length - 1]?.at ?? iso(ind.CREATION_DT)
      const approvedAt = [...indentChain].reverse().find(c => c.stage === 'approved')?.at ?? lastIndentStep
      const poApprovedAt = approvedPos.map(p => [...p.chain].reverse().find(c => c.stage === 'approved')?.at ?? p.date).filter(Boolean).sort().pop() ?? null
      const poPendingSince = pos.filter(p => p.stage !== 'approved').map(p => p.chain[p.chain.length - 1]?.at ?? p.date).filter(Boolean).sort()[0] ?? null
      const waitingSince =
        next === 'indent approval' ? lastIndentStep
        : next === 'raise PO' ? approvedAt
        : next === 'PO approval' ? poPendingSince
        : next === 'delivery' ? poApprovedAt
        : null
      const waitingDays = daysSince(waitingSince)
      const late = waitingDays != null && next !== 'done' && next !== 'closed' && waitingDays > SLA_DAYS[next]
      return {
        id: it.ID, material: s(it.material) ?? `Material ${it.MATERIAL_ID}`, uom: s(it.uom),
        categoryId: it.WORK_CATEGORY_ID, subcategoryId: it.WORK_SUBCATEGORY_ID,
        qty, poQty, poValue, receivedQty, receivedValue, pos, next,
        closedForPo, waitingSince, waitingDays, late,
      }
    })
    const posDistinct = new Map<number, IndentRow['pos'][number]>()
    for (const it of built) for (const p of it.pos) {
      const cur = posDistinct.get(p.poId) ?? { poId: p.poId, poNo: p.poNo, status: p.status, stage: p.stage, date: p.date, supplier: p.supplier, value: 0, grnQty: 0, qty: 0 }
      cur.value += p.value; cur.grnQty += p.grnQty; cur.qty += p.qty
      posDistinct.set(p.poId, cur)
    }
    rows.push({
      id: ind.ID, ref: s(ind.DISPLAY_NO) ?? `Indent ${ind.ID}`, date: iso(ind.CREATION_DT), statusId: ind.STATUS, status: statusName(ind.STATUS), stage,
      projectId: ind.PROJECT_ID == null ? null : n(ind.PROJECT_ID), project: s(ind.project), subproject: s(ind.subproject),
      woNo: s(ind.wo_no), materialType: s(ind.MATERIAL_TYPE)?.replace(/^\s*\d+\s*\(M\)\s*/, '') ?? null, remarks: s(ind.REMARKS), raisedBy: s(ind.raised_by),
      chain: chainFrom(auditByIndent.get(ind.ID) ?? []),
      items: built,
      poValue: built.reduce((t, i) => t + i.poValue, 0),
      receivedValue: built.reduce((t, i) => t + i.receivedValue, 0),
      awaitingPo: built.filter(i => i.next === 'raise PO').length,
      awaitingDelivery: built.filter(i => i.next === 'delivery' || i.next === 'PO approval').length,
      pos: [...posDistinct.values()].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))),
    })
  }

  // ── The tree: category → sub-category → the indents whose items sit there.
  // An indent whose items span two sub-categories appears under both, with
  // only the items that belong there — the way the Internal Estimate files a
  // work order's BOQ, line by line.
  const cats = new Map<string, IndentsCatRow>()
  for (const r of rows) {
    const bySub = groupBy(r.items, i => `${i.categoryId ?? 0}|${i.subcategoryId ?? 0}`)
    for (const [key, its] of bySub) {
      const [catId, subId] = key.split('|').map(Number)
      const ck = `icat:${catId}`
      const c = cats.get(ck) ?? {
        id: ck, name: catId ? (skill.get(catId)?.name ?? `Category ${catId}`) : '(no category on the indent line)', code: catId ? (skill.get(catId)?.code ?? null) : null,
        subs: [], indents: 0, items: 0, poValue: 0, receivedValue: 0, awaitingPo: 0, awaitingDelivery: 0,
      }
      const sk = `${ck}:${subId}`
      let sub = c.subs.find(x => x.id === sk)
      if (!sub) {
        sub = { id: sk, name: subId ? (skill.get(subId)?.name ?? `Sub-category ${subId}`) : '(no sub-category)', code: subId ? (skill.get(subId)?.code ?? null) : null, indents: [], items: 0, poValue: 0, receivedValue: 0, awaitingPo: 0, awaitingDelivery: 0 }
        c.subs.push(sub)
      }
      const part: IndentRow = {
        ...r, items: its,
        poValue: its.reduce((t, i) => t + i.poValue, 0), receivedValue: its.reduce((t, i) => t + i.receivedValue, 0),
        awaitingPo: its.filter(i => i.next === 'raise PO').length, awaitingDelivery: its.filter(i => i.next === 'delivery' || i.next === 'PO approval').length,
      }
      sub.indents.push(part)
      sub.items += its.length; sub.poValue += part.poValue; sub.receivedValue += part.receivedValue; sub.awaitingPo += part.awaitingPo; sub.awaitingDelivery += part.awaitingDelivery
      c.items += its.length; c.poValue += part.poValue; c.receivedValue += part.receivedValue; c.awaitingPo += part.awaitingPo; c.awaitingDelivery += part.awaitingDelivery
      cats.set(ck, c)
    }
  }
  const byCode = (a: { code: string | null; name: string }, b: { code: string | null; name: string }) => {
    const ca = Number((a.code ?? a.name).match(/^\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER), cb = Number((b.code ?? b.name).match(/^\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER)
    return ca - cb || a.name.localeCompare(b.name)
  }
  const catList = [...cats.values()].sort(byCode)
  for (const c of catList) { c.subs.sort(byCode); c.indents = new Set(c.subs.flatMap(sb => sb.indents.map(i => i.id))).size }

  // ── Waiting in IN4: indents and POs at a pending status.
  const pending: PendingApproval[] = []
  for (const r of rows) {
    if (r.statusId != null && PENDING_STATUS_IDS.has(r.statusId)) {
      const last = r.chain[r.chain.length - 1]
      pending.push({
        kind: 'indent', id: r.id, ref: r.ref, status: r.status, stage: r.stage,
        since: last?.at ?? r.date, by: r.raisedBy ?? last?.by ?? null,
        what: [r.materialType, `${r.items.length} item${r.items.length === 1 ? '' : 's'}`, r.remarks].filter(Boolean).join(' · ') || null,
        value: null, context: r.woNo ? `for ${r.woNo}` : null, project: r.project,
      })
    }
  }
  const seenPo = new Set<number>()
  for (const r of rows) for (const it of r.items) for (const p of it.pos) {
    if (seenPo.has(p.poId) || p.statusId == null || !PENDING_STATUS_IDS.has(p.statusId)) continue
    seenPo.add(p.poId)
    const last = p.chain[p.chain.length - 1]
    const total = rows.flatMap(x => x.items).flatMap(i => i.pos).filter(x => x.poId === p.poId).reduce((t, x) => t + x.value, 0)
    pending.push({
      kind: 'po', id: p.poId, ref: p.poNo ?? `PO ${p.poId}`, status: p.status, stage: p.stage,
      since: last?.at ?? p.date, by: last?.by ?? null,
      what: p.supplier, value: total, context: `for ${r.ref}`, project: r.project,
    })
  }
  pending.sort((a, b) => String(a.since ?? '').localeCompare(String(b.since ?? '')))

  const allItems = rows.flatMap(r => r.items)
  return {
    cats: catList, pending,
    totals: {
      indents: rows.length, items: allItems.length,
      poValue: allItems.reduce((t, i) => t + i.poValue, 0), receivedValue: allItems.reduce((t, i) => t + i.receivedValue, 0),
      awaitingPo: allItems.filter(i => i.next === 'raise PO').length,
      awaitingDelivery: allItems.filter(i => i.next === 'delivery' || i.next === 'PO approval').length,
      hidden,
    },
  }
}

/** The chips on the Indents screens: which lines to keep. */
export type IndentFilter = 'all' | 'approval' | 'po' | 'delivery' | 'late' | 'done'
export const FILTER_LABEL: Record<IndentFilter, string> = {
  all: 'All', approval: 'Waiting for approval', po: 'Awaiting PO', delivery: 'Awaiting delivery', late: 'Late', done: 'Received in full',
}
export function itemMatches(f: IndentFilter, it: IndentItem): boolean {
  switch (f) {
    case 'all': return true
    case 'approval': return it.next === 'indent approval'
    case 'po': return it.next === 'raise PO' || it.next === 'PO approval'
    case 'delivery': return it.next === 'delivery'
    case 'late': return it.late
    case 'done': return it.next === 'done'
  }
}

/** The tree with only the lines a filter keeps; empty indents, sub-categories
 *  and categories fall away. Figures on each row are recomputed from what is
 *  kept. Pure. */
export function filterIndentsTree(cats: readonly IndentsCatRow[], f: IndentFilter): IndentsCatRow[] {
  if (f === 'all') return [...cats]
  const sum = (rows: IndentRow[]) => ({
    items: rows.reduce((t, r) => t + r.items.length, 0),
    poValue: rows.reduce((t, r) => t + r.poValue, 0), receivedValue: rows.reduce((t, r) => t + r.receivedValue, 0),
    awaitingPo: rows.reduce((t, r) => t + r.awaitingPo, 0), awaitingDelivery: rows.reduce((t, r) => t + r.awaitingDelivery, 0),
  })
  return cats.map(c => {
    const subs = c.subs.map(sb => {
      const indents = sb.indents.map(r => {
        const items = r.items.filter(it => itemMatches(f, it))
        return {
          ...r, items,
          poValue: items.reduce((t, i) => t + i.poValue, 0), receivedValue: items.reduce((t, i) => t + i.receivedValue, 0),
          awaitingPo: items.filter(i => i.next === 'raise PO').length, awaitingDelivery: items.filter(i => i.next === 'delivery' || i.next === 'PO approval').length,
        }
      }).filter(r => r.items.length > 0)
      return { ...sb, indents, ...sum(indents) }
    }).filter(sb => sb.indents.length > 0)
    const all = subs.flatMap(sb => sb.indents)
    return { ...c, subs, indents: new Set(all.map(r => r.id)).size, ...sum(all) }
  }).filter(c => c.subs.length > 0)
}

function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]) }
  return m
}

/* ── Loading one project, live ──────────────────────────────────────────── */

const chunks = <T,>(xs: T[], size: number) => { const out: T[][] = []; for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size)); return out }
async function inList<T>(ids: number[], q: (list: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (const c of chunks([...new Set(ids.filter(Number.isInteger))], 400)) out.push(...await q(c.join(',')))
  return out
}

export async function loadIndentsTree(projectId: string, opts: { showClosed?: boolean } = {}): Promise<IndentsTree> {
  const supabase = await createClient()
  // Project → IN4 sub-projects through the two human-confirmed link tables,
  // exactly as the WO/PO tree does. Never a name match.
  const { data: links, error: linkErr } = await supabase.from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
  if (linkErr) return { ...EMPTY, error: linkErr.message }
  const bphIds = (links ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length === 0) return EMPTY
  const { data: subLinks, error: subErr } = await supabase.from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
  if (subErr) return { ...EMPTY, error: subErr.message }
  const subIds = [...new Set((subLinks ?? []).map(r => r.subproject_id as number))]
  if (subIds.length === 0) return EMPTY

  if (!in4Config()) return { ...EMPTY, linked: true, in4: 'not-configured' }
  const { data: sk } = await supabase.from('in4_skills').select('id, name, code')
  const skills = (sk ?? []) as SkillName[]

  try {
    const indents = await in4Query<IndentRaw>(`
      ${INDENT_SELECT}
      WHERE i.SUBPROJECT_ID IN (${subIds.join(',')})`)
    const indentIds = indents.map(i => i.ID)
    if (indentIds.length === 0) return { ...buildIndentsTree([], [], [], [], [], [], skills, opts), in4: 'live', linked: true, error: null }
    const parts = await loadIndentParts(indentIds)
    return { ...buildIndentsTree(indents, parts.items, parts.poLines, parts.grns, parts.indentAudit, parts.poAudit, skills, opts), in4: 'live', linked: true, error: null }
  } catch (e) {
    return { ...EMPTY, linked: true, in4: 'unavailable', error: e instanceof Error ? e.message : String(e) }
  }
}

const INDENT_SELECT = `
      SELECT i.ID, i.DISPLAY_NO, i.CREATION_DT, i.STATUS, i.SUBPROJECT_ID, i.PROJECT_ID, i.WORK_ORDER_ID, w.DISPLAY_NO wo_no,
             i.MATERIAL_TYPE, i.REMARKS, LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) raised_by,
             pr.NAME project, sp.SUBPROJECT_NAME subproject
      FROM PURCH_INDENT i
      LEFT JOIN ENGG_WORK_ORDER w ON w.ID = i.WORK_ORDER_ID
      LEFT JOIN HR_EMP_PROFILE e ON e.ID = i.CREATED_BY
      LEFT JOIN ENGG_PROJECT pr ON pr.ID = i.PROJECT_ID
      LEFT JOIN ENGG_SUBPROJECT sp ON sp.ID = i.SUBPROJECT_ID`

/** The lines, PO lines, receipts and both audit trails for a set of indents. */
async function loadIndentParts(indentIds: number[]) {
  const [items, indentAudit] = await Promise.all([
      inList(indentIds, list => in4Query<IndentItemRaw>(`
        SELECT ii.ID, ii.INDENT_NO indent_id, ii.MATERIAL_ID, m.NAME material, ii.ORDER_QTY, u.NAME uom,
               ii.WORK_CATEGORY_ID, ii.WORK_SUBCATEGORY_ID, ii.CLOSED_FOR_PO
        FROM PURCH_INDENT_ITEMS ii
        LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = ii.MATERIAL_ID
        LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = ii.UNIT_OF_MEASUREMENT
        WHERE ii.INDENT_NO IN (${list})`)),
      inList(indentIds, list => in4Query<AuditRaw>(`
        SELECT a.INDENT_ID doc_id, a.STATUS, a.MODIFIED_DT, LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) who, a.REMARKS
        FROM PURCH_INDENT_AUDIT_TRAIL a
        LEFT JOIN HR_EMP_PROFILE e ON e.ID = a.MODIFIED_BY
        WHERE a.INDENT_ID IN (${list})`)),
    ])
    const itemIds = items.map(i => i.ID)
    const poLines = await inList(itemIds, list => in4Query<PoLineRaw>(`
      SELECT pi.ID po_item_id, pi.INDENT_ITEM_ID, pi.ORDER_QTY,
             p.ID po_id, p.DISPLAY_NO po_no, p.STATUS po_status, p.CREATED_DT po_date, COALESCE(sp.PrintName, sp.NAME) supplier,
             f.NET_RATE, f.LANDED_COST, f.MATERIAL_VALUE, f.GRN_QTY
      FROM PURCH_PURCHASE_ORDER_ITEMS pi
      JOIN PURCH_PURCHASE_ORDER p ON p.ID = pi.PURCHASE_ORDER_ID
      LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = p.SUPPLIER_ID
      LEFT JOIN BI.FACT_PURCHASE_ORDER_DETAILS f ON f.ITEM_ID = pi.ID
      WHERE pi.INDENT_ITEM_ID IN (${list})`))
    const poIds = [...new Set(poLines.map(l => l.po_id))]
    const [grns, poAudit] = await Promise.all([
      inList(poIds, list => in4Query<GrnRaw>(`
        SELECT d.PO_ID, d.MATERIAL_ID, d.GRN_ID, h.GRN_NO, h.GRN_DT, h.STATUS grn_status, d.RECIEVED_QTY, d.GRN_MATERIAL_COST
        FROM BI.FACT_PURCHASE_GRN_DETAILS d
        LEFT JOIN BI.DIM_PURCHASE_GRN_HEADER h ON h.GRN_ID = d.GRN_ID
        WHERE d.PO_ID IN (${list}) AND (d.RECIEVED_QTY <> 0 OR d.GRN_MATERIAL_COST <> 0)`)),
      inList(poIds, list => in4Query<AuditRaw>(`
        SELECT a.PURCHASE_ORDER_ID doc_id, a.STATUS, a.MODIFIED_DT, LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) who, a.REMARKS
        FROM PURCH_PURCHASE_ORDER_AUDIT_TRAIL a
        LEFT JOIN HR_EMP_PROFILE e ON e.ID = a.MODIFIED_BY
        WHERE a.PURCHASE_ORDER_ID IN (${list})`)),
    ])
  return { items, indentAudit, poLines, grns, poAudit }
}

export interface ProjectIndents { projectId: number; project: string; code: string | null; tree: Omit<IndentsTree, 'in4' | 'linked' | 'error'> }

/**
 * Every project at once, for the portal-wide tracker: indents raised in the
 * last `months`, plus any older one still waiting for something (an approval,
 * a PO on an open line, a delivery). Grouped by IN4's own project — no CT Hub
 * mapping needed, so nothing is left out for want of a link.
 */
export async function loadIndentsAll(opts: { months?: number; showClosed?: boolean } = {}): Promise<{ projects: ProjectIndents[]; in4: IndentsTree['in4']; error: string | null }> {
  if (!in4Config()) return { projects: [], in4: 'not-configured', error: null }
  const months = opts.months ?? 12
  const supabase = await createClient()
  const { data: sk } = await supabase.from('in4_skills').select('id, name, code')
  const skills = (sk ?? []) as SkillName[]
  try {
    const indents = await in4Query<IndentRaw>(`
      ${INDENT_SELECT}
      WHERE i.STATUS NOT IN (6, 66)
        AND (i.CREATION_DT >= DATEADD(month, -${Math.max(1, Math.min(60, Math.round(months)))}, GETDATE())
             OR i.STATUS IN (1, 13, 60, 77, 113, 117)
             OR EXISTS (SELECT 1 FROM PURCH_INDENT_ITEMS ii WHERE ii.INDENT_NO = i.ID AND ii.CLOSED_FOR_PO = 0
                        AND ii.ORDER_QTY > COALESCE((SELECT SUM(pi.ORDER_QTY) FROM PURCH_PURCHASE_ORDER_ITEMS pi JOIN PURCH_PURCHASE_ORDER p ON p.ID = pi.PURCHASE_ORDER_ID WHERE pi.INDENT_ITEM_ID = ii.ID AND p.STATUS NOT IN (6, 66)), 0))
             OR EXISTS (SELECT 1 FROM PURCH_PURCHASE_ORDER_ITEMS pi JOIN PURCH_PURCHASE_ORDER p ON p.ID = pi.PURCHASE_ORDER_ID
                        LEFT JOIN BI.FACT_PURCHASE_ORDER_DETAILS f ON f.ITEM_ID = pi.ID
                        WHERE pi.INDENT_ITEM_ID IN (SELECT ii.ID FROM PURCH_INDENT_ITEMS ii WHERE ii.INDENT_NO = i.ID)
                          AND p.STATUS NOT IN (6, 66) AND COALESCE(f.GRN_QTY, 0) + 0.001 < pi.ORDER_QTY))`)
    if (indents.length === 0) return { projects: [], in4: 'live', error: null }
    const parts = await loadIndentParts(indents.map(i => i.ID))
    const byProject = new Map<number, IndentRaw[]>()
    for (const i of indents) { const k = n(i.PROJECT_ID); byProject.set(k, [...(byProject.get(k) ?? []), i]) }
    const projects: ProjectIndents[] = []
    for (const [projectId, list] of byProject) {
      const ids = new Set(list.map(i => i.ID))
      const items = parts.items.filter(x => ids.has(x.indent_id))
      const itemIds = new Set(items.map(x => x.ID))
      const poLines = parts.poLines.filter(l => itemIds.has(l.INDENT_ITEM_ID))
      const poIds = new Set(poLines.map(l => l.po_id))
      projects.push({
        projectId, project: s(list[0].project) ?? `Project ${projectId}`, code: null,
        tree: buildIndentsTree(list, items, poLines, parts.grns.filter(g => poIds.has(g.PO_ID)), parts.indentAudit.filter(a => ids.has(a.doc_id)), parts.poAudit.filter(a => poIds.has(a.doc_id)), skills, opts),
      })
    }
    projects.sort((a, b) => (b.tree.pending.length - a.tree.pending.length) || (b.tree.totals.awaitingPo + b.tree.totals.awaitingDelivery) - (a.tree.totals.awaitingPo + a.tree.totals.awaitingDelivery) || a.project.localeCompare(b.project))
    return { projects, in4: 'live', error: null }
  } catch (e) {
    return { projects: [], in4: 'unavailable', error: e instanceof Error ? e.message : String(e) }
  }
}
