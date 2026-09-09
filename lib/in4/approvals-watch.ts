// Watching IN4 for the three moments the Atm Head asked to hear about:
//   · an indent reaches Verify        → "approve it in IN4"
//   · a purchase order reaches Verify → "approve it in IN4"
//   · a work order reaches Verify     → "approve it in IN4" (Aksha, 10 Sep 2026)
//   · a GRN is approved               → "material received"
//
// IN4 has no hooks, so this is a poll: read what is at Verify now and what
// was received since last time, compare with what was already told, and
// tell only the new. The "already told" memory is one app_settings row —
// CT Hub's own key/value table, no schema change. The Atm Head is whoever
// holds the `head` chair on the CT Hub project the IN4 sub-project is linked
// to (cc_project_approvers), through the same two link tables the Budget
// and WO/PO trees use. Delivery is notify_user(), so it follows each
// person's own channel choices (e-mail, Telegram) and the admin policy.
//
// Cadence is the cron dispatcher's: twice a day on the free plan. Every run
// is idempotent, so a faster plan simply tells people sooner.
//
// Pure planning (planNotices) is separated from reading (readIn4Watch) so
// the dedupe rule is tested without a database. SELECT only against IN4.

import { in4Query } from './db'

export interface WatchState {
  /** indent id → status id already announced */
  indents: Record<string, number>
  /** PO id → status id already announced */
  pos: Record<string, number>
  /** WO id → status id already announced */
  wos?: Record<string, number>
  /** GRNs dated on/after this ISO date are candidates; announced ids listed. */
  grnSince: string | null
  grns: Record<string, true>
  lastRunAt: string | null
}
export const EMPTY_STATE: WatchState = { indents: {}, pos: {}, wos: {}, grnSince: null, grns: {}, lastRunAt: null }

export interface PendingDoc {
  kind: 'indent' | 'po' | 'wo'
  id: number; ref: string; statusId: number; status: string
  subprojectId: number | null; projectId: number | null
  who: string | null; since: string | null; what: string | null; value: number | null
  /** The WO an indent is for; the indent(s) a PO serves. */
  context: string | null
}
export interface GrnDoc {
  grnId: number; grnNo: string | null; date: string | null
  subprojectId: number | null; projectId: number | null
  poNo: string | null; supplier: string | null; qty: number; value: number; materials: string | null
}

export interface Notice {
  type: 'in4_indent_verify' | 'in4_po_verify' | 'in4_wo_verify' | 'in4_grn_received'
  subprojectId: number | null
  projectId: number | null
  title: string
  body: string
  data: Record<string, unknown>
}

/** Verify-stage statuses: 113 Verify, 117 Amended & Verify. */
export const VERIFY_STATUS_IDS = new Set([113, 117])

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const day = (isoStr: string | null) => (isoStr ? new Date(isoStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : '')

/**
 * What to tell, and the memory to keep. Pure.
 * A document is announced once per status: an indent that goes Verify →
 * ReSubmit → Verify is announced again, because it is waiting again.
 */
export function planNotices(state: WatchState, pending: readonly PendingDoc[], grns: readonly GrnDoc[], nowIso: string): { notices: Notice[]; next: WatchState } {
  const next: WatchState = { indents: {}, pos: {}, wos: {}, grnSince: state.grnSince, grns: { ...state.grns }, lastRunAt: nowIso }
  const notices: Notice[] = []
  for (const d of pending) {
    const book = d.kind === 'indent' ? next.indents : d.kind === 'wo' ? (next.wos as Record<string, number>) : next.pos
    const before = d.kind === 'indent' ? state.indents : d.kind === 'wo' ? (state.wos ?? {}) : state.pos
    book[String(d.id)] = d.statusId
    if (before[String(d.id)] === d.statusId) continue
    if (!VERIFY_STATUS_IDS.has(d.statusId)) continue
    const since = day(d.since)
    notices.push(d.kind === 'indent'
      ? {
          type: 'in4_indent_verify', subprojectId: d.subprojectId, projectId: d.projectId,
          title: `Indent ${d.ref} is waiting for your approval in IN4`,
          body: [`${d.ref}${d.context ? ` (${d.context})` : ''} reached ${d.status}${since ? ` on ${since}` : ''}${d.who ? `, raised by ${d.who}` : ''}.`, d.what ? d.what : null, 'Open IN4 to approve it.'].filter(Boolean).join(' '),
          data: { kind: 'indent', id: d.id, ref: d.ref, status: d.status, who: d.who, since: d.since, what: d.what, context: d.context },
        }
      : d.kind === 'wo'
      ? {
          type: 'in4_wo_verify', subprojectId: d.subprojectId, projectId: d.projectId,
          title: `WO ${d.ref} is waiting for your approval in IN4`,
          body: [`${d.ref}${d.what ? ` to ${d.what}` : ''}${d.value ? ` for ${inr(d.value)}` : ''} reached ${d.status}${since ? ` on ${since}` : ''}${d.who ? `, by ${d.who}` : ''}.`, d.context ? d.context : null, 'Open IN4 to approve it; the WO / PO tab in CT Hub shows every rate against the last one paid.'].filter(Boolean).join(' '),
          data: { kind: 'wo', id: d.id, ref: d.ref, status: d.status, who: d.who, since: d.since, contractor: d.what, value: d.value, context: d.context },
        }
      : {
          type: 'in4_po_verify', subprojectId: d.subprojectId, projectId: d.projectId,
          title: `PO ${d.ref} is waiting for your approval in IN4`,
          body: [`${d.ref}${d.what ? ` to ${d.what}` : ''}${d.value ? ` for ${inr(d.value)}` : ''} reached ${d.status}${since ? ` on ${since}` : ''}${d.who ? `, by ${d.who}` : ''}.`, d.context ? d.context : null, 'Open IN4 to approve it.'].filter(Boolean).join(' '),
          data: { kind: 'po', id: d.id, ref: d.ref, status: d.status, who: d.who, since: d.since, supplier: d.what, value: d.value, context: d.context },
        })
  }
  // Receipts: dated on/after the watermark and not yet announced. The first
  // run sets the watermark to now so a year of old GRNs is not announced.
  if (!state.grnSince) {
    next.grnSince = nowIso.slice(0, 10)
  } else {
    for (const g of grns) {
      if (next.grns[String(g.grnId)]) continue
      if (g.date && g.date.slice(0, 10) < state.grnSince) continue
      next.grns[String(g.grnId)] = true
      notices.push({
        type: 'in4_grn_received', subprojectId: g.subprojectId, projectId: g.projectId,
        title: `Material received${g.poNo ? ` against ${g.poNo}` : ''}`,
        body: [`${g.grnNo ?? `GRN ${g.grnId}`}${g.date ? ` on ${day(g.date)}` : ''}${g.supplier ? ` from ${g.supplier}` : ''}: ${g.materials ?? 'material'}${g.qty ? ` — ${g.qty.toLocaleString('en-IN')} units` : ''}${g.value ? `, ${inr(g.value)}` : ''}.`].join(' '),
        data: { kind: 'grn', id: g.grnId, ref: g.grnNo, date: g.date, po: g.poNo, supplier: g.supplier, qty: g.qty, value: g.value, materials: g.materials },
      })
    }
    // Keep the watermark a week back so a GRN approved late is still seen
    // once; the announced-id list keeps it from repeating.
    const weekAgo = new Date(Date.parse(nowIso) - 7 * 86400000).toISOString().slice(0, 10)
    next.grnSince = weekAgo > state.grnSince ? weekAgo : state.grnSince
    for (const id of Object.keys(next.grns)) {
      const g = grns.find(x => String(x.grnId) === id)
      if (g && g.date && g.date.slice(0, 10) < next.grnSince) delete next.grns[id]
    }
  }
  return { notices, next }
}

/** What IN4 holds right now: every indent and PO at a pending status, and
 *  every approved GRN dated on/after `grnSince`. SELECT only. */
export async function readIn4Watch(grnSince: string | null): Promise<{ pending: PendingDoc[]; grns: GrnDoc[] }> {
  const [indents, pos, wos, grnRows] = await Promise.all([
    in4Query<Record<string, unknown>>(`
      SELECT i.ID, i.DISPLAY_NO, i.STATUS, st.NAME status_name, i.SUBPROJECT_ID, i.PROJECT_ID, i.MATERIAL_TYPE, i.REMARKS, w.DISPLAY_NO wo_no,
             LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) who,
             (SELECT MAX(a.MODIFIED_DT) FROM PURCH_INDENT_AUDIT_TRAIL a WHERE a.INDENT_ID = i.ID AND a.STATUS = i.STATUS) since,
             (SELECT COUNT(*) FROM PURCH_INDENT_ITEMS ii WHERE ii.INDENT_NO = i.ID) items
      FROM PURCH_INDENT i
      LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = i.STATUS
      LEFT JOIN ENGG_WORK_ORDER w ON w.ID = i.WORK_ORDER_ID
      LEFT JOIN HR_EMP_PROFILE e ON e.ID = i.CREATED_BY
      WHERE i.STATUS IN (1, 113, 60, 77, 117)`),
    in4Query<Record<string, unknown>>(`
      SELECT p.ID, p.DISPLAY_NO, p.STATUS, st.NAME status_name, p.PROJECT_ID,
             (SELECT TOP 1 pi.SUBPROJECT_ID FROM PURCH_PURCHASE_ORDER_INDENT pi WHERE pi.PURCHASE_ORDER_ID = p.ID) subproject_id,
             (SELECT STRING_AGG(ind.DISPLAY_NO, ', ') FROM PURCH_PURCHASE_ORDER_INDENT pi JOIN PURCH_INDENT ind ON ind.ID = pi.INDENT_ID WHERE pi.PURCHASE_ORDER_ID = p.ID) indents,
             COALESCE(sp.PrintName, sp.NAME) supplier, p.TOTAL_VALUE,
             (SELECT TOP 1 LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) FROM PURCH_PURCHASE_ORDER_AUDIT_TRAIL a LEFT JOIN HR_EMP_PROFILE e ON e.ID = a.MODIFIED_BY WHERE a.PURCHASE_ORDER_ID = p.ID AND a.STATUS = p.STATUS ORDER BY a.MODIFIED_DT DESC) who,
             (SELECT MAX(a.MODIFIED_DT) FROM PURCH_PURCHASE_ORDER_AUDIT_TRAIL a WHERE a.PURCHASE_ORDER_ID = p.ID AND a.STATUS = p.STATUS) since
      FROM PURCH_PURCHASE_ORDER p
      LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = p.STATUS
      LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = p.SUPPLIER_ID
      WHERE p.STATUS IN (1, 113, 60, 77, 117)`),
    in4Query<Record<string, unknown>>(`
      SELECT w.ID, w.DISPLAY_NO, w.STATUS, st.NAME status_name, w.PROJECT_ID, w.SUBPROJECT_ID, w.WORK_ORDER_VALUE, w.WORK_DESCRIPTION,
             sp.FIRM_NAME contractor, sk.NAME category,
             (SELECT TOP 1 LTRIM(RTRIM(CONCAT(e.FirstName, ' ', e.LastName))) FROM ENGG_WO_AUDIT_TRAIL a LEFT JOIN HR_EMP_PROFILE e ON e.ID = a.MODIFIED_BY WHERE a.WO_ID = w.ID AND a.STATUS = w.STATUS ORDER BY a.MODIFIED_DT DESC) who,
             (SELECT MAX(a.MODIFIED_DT) FROM ENGG_WO_AUDIT_TRAIL a WHERE a.WO_ID = w.ID AND a.STATUS = w.STATUS) since
      FROM ENGG_WORK_ORDER w
      LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = w.STATUS
      LEFT JOIN ENGG_SERVICE_PROVIDER sp ON sp.ID = w.SERVICE_PROVIDER_ID
      LEFT JOIN ENGG_SKILLS_LOOKUP sk ON sk.ID = w.SKILL_ID
      WHERE w.STATUS IN (1, 113, 60, 77, 117)`),
    grnSince
      ? in4Query<Record<string, unknown>>(`
        SELECT h.GRN_ID, h.GRN_NO, h.GRN_DT, h.PROJECT_ID, MAX(d.SUBPROJECT_ID) subproject_id,
               MAX(po.PO_NO) po_no, MAX(COALESCE(sp.PrintName, sp.NAME)) supplier,
               SUM(d.RECIEVED_QTY) qty, SUM(d.GRN_MATERIAL_COST) value,
               STRING_AGG(m.NAME, ', ') materials
        FROM BI.DIM_PURCHASE_GRN_HEADER h
        JOIN BI.FACT_PURCHASE_GRN_DETAILS d ON d.GRN_ID = h.GRN_ID AND (d.RECIEVED_QTY <> 0 OR d.GRN_MATERIAL_COST <> 0)
        LEFT JOIN BI.PURCHASE_ORDER_HEADER po ON po.PO_ID = d.PO_ID
        LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = h.SUPPLIER_ID
        LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = d.MATERIAL_ID
        WHERE h.STATUS = 'Approved' AND h.GRN_DT >= '${grnSince.replace(/[^0-9-]/g, '')}'
        GROUP BY h.GRN_ID, h.GRN_NO, h.GRN_DT, h.PROJECT_ID`)
      : Promise.resolve([] as Record<string, unknown>[]),
  ])
  const pending: PendingDoc[] = [
    ...indents.map(r => ({
      kind: 'indent' as const, id: n(r.ID), ref: s(r.DISPLAY_NO) ?? `Indent ${r.ID}`, statusId: n(r.STATUS), status: s(r.status_name) ?? String(r.STATUS),
      subprojectId: r.SUBPROJECT_ID == null ? null : n(r.SUBPROJECT_ID), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID),
      who: s(r.who), since: iso(r.since),
      what: [s(r.MATERIAL_TYPE)?.replace(/^\s*\d+\s*\(M\)\s*/, ''), `${n(r.items)} item${n(r.items) === 1 ? '' : 's'}`, s(r.REMARKS)].filter(Boolean).join(' · ') || null,
      value: null, context: s(r.wo_no) ? `for ${s(r.wo_no)}` : null,
    })),
    ...pos.map(r => ({
      kind: 'po' as const, id: n(r.ID), ref: s(r.DISPLAY_NO) ?? `PO ${r.ID}`, statusId: n(r.STATUS), status: s(r.status_name) ?? String(r.STATUS),
      subprojectId: r.subproject_id == null ? null : n(r.subproject_id), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID),
      who: s(r.who), since: iso(r.since), what: s(r.supplier), value: n(r.TOTAL_VALUE) || null,
      context: s(r.indents) ? `for ${s(r.indents)}` : null,
    })),
    ...wos.map(r => ({
      kind: 'wo' as const, id: n(r.ID), ref: s(r.DISPLAY_NO) ?? `WO ${r.ID}`, statusId: n(r.STATUS), status: s(r.status_name) ?? String(r.STATUS),
      subprojectId: r.SUBPROJECT_ID == null ? null : n(r.SUBPROJECT_ID), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID),
      who: s(r.who), since: iso(r.since), what: s(r.contractor), value: n(r.WORK_ORDER_VALUE) || null,
      context: [s(r.category)?.replace(/^\d+\s+/, ''), s(r.WORK_DESCRIPTION)].filter(Boolean).join(' · ') || null,
    })),
  ]
  const grns: GrnDoc[] = grnRows.map(r => ({
    grnId: n(r.GRN_ID), grnNo: s(r.GRN_NO), date: iso(r.GRN_DT),
    subprojectId: r.subproject_id == null ? null : n(r.subproject_id), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID),
    poNo: s(r.po_no), supplier: s(r.supplier), qty: n(r.qty), value: n(r.value), materials: s(r.materials),
  }))
  return { pending, grns }
}
