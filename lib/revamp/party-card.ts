// One contractor or supplier, the way a Head sizes them up: what they were
// given, what they were paid, what is held back, where they worked, how they
// deliver, and whether their prices are competitive. Profile from the IN4
// mirror; every figure live from IN4's own facts. SELECT only.

import { createClient } from '@/lib/supabase/server'
import { in4QueryCached, in4Config } from '@/lib/in4/db'
import { flagParties, oneLine, type Party, type In4Read } from './masters-in4'

export interface PartyOrder {
  id: number; ref: string; date: string | null; project: string | null; category: string | null
  status: string | null; gross: number; paid: number; retention: number
  /** POs: 'Fullfilled' | 'Partial' | ''. */
  grnStatus: string | null; firstGrn: string | null
}

export interface PriceCheck { material: string; myRate: number; marketMin: number; suppliers: number }

export interface PartyCard {
  party: Party
  totals: { orders: number; gross: number; paid: number; retention: number; projects: number; categories: number; first: string | null; last: string | null }
  orders: PartyOrder[]
  /** Suppliers only: average PO-to-first-GRN days and the share fulfilled. */
  delivery: { avgLeadDays: number | null; fulfilled: number; partial: number; open: number } | null
  /** Suppliers only: materials where more than one supplier was used. */
  prices: PriceCheck[]
}

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function loadPartyCard(kind: 'contractor' | 'supplier', id: number): Promise<({ card: PartyCard | null }) & In4Read> {
  const supabase = await createClient()
  const { data } = await supabase.from('in4_parties')
    .select('kind, id, name, code, pan, gstin, address, city, state, pin, phone, email, contact_person, is_active, skills')
    .eq('kind', kind).eq('id', id).maybeSingle()
  if (!data) return { card: null, in4: 'live' }
  const p = data as Record<string, unknown>
  const [party] = flagParties([{
    kind, id, name: s(p.name) ?? '', code: s(p.code), pan: s(p.pan), gstin: s(p.gstin),
    address: oneLine(p.address), city: s(p.city), state: s(p.state), pin: s(p.pin),
    phone: s(p.phone), email: s(p.email), contactPerson: s(p.contact_person),
    isActive: p.is_active !== false, skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
    duplicateOf: [], gstinLooksWrong: false, panLooksWrong: false,
  }])
  const empty: PartyCard = { party, totals: { orders: 0, gross: 0, paid: 0, retention: 0, projects: 0, categories: 0, first: null, last: null }, orders: [], delivery: null, prices: [] }
  if (!in4Config()) return { card: empty, in4: 'not-configured' }

  try {
    if (kind === 'contractor') {
      const rows = await in4QueryCached<Record<string, unknown>>(`
        SELECT w.ID, w.DISPLAY_NO, w.CREATION_DT, pr.NAME project, k.NAME category, st.NAME status,
               f.WO_GROSS_VALUE gross, f.WO_PAID_AMT paid, f.WO_RETENTION_AMT retention
        FROM BI.FACT_ENGG_WORK_ORDER f
        JOIN ENGG_WORK_ORDER w ON w.ID = f.WO_ID
        LEFT JOIN ENGG_SUBPROJECT sub ON sub.ID = f.SUBPROJECT_ID
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = sub.PROJECT_ID
        LEFT JOIN ENGG_SKILLS_LOOKUP k ON k.ID = f.WORK_CATEGORY_ID
        LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = w.STATUS
        WHERE f.CONTRACTOR_ID = ${id}
        ORDER BY w.CREATION_DT DESC`)
      const orders: PartyOrder[] = rows.map(r => ({
        id: n(r.ID), ref: s(r.DISPLAY_NO) ?? `WO ${r.ID}`, date: iso(r.CREATION_DT), project: s(r.project), category: s(r.category)?.replace(/^\d+\s+/, '') ?? null,
        status: s(r.status), gross: n(r.gross), paid: n(r.paid), retention: n(r.retention), grnStatus: null, firstGrn: null,
      }))
      return { card: { ...empty, orders, totals: totalsOf(orders) }, in4: 'live' }
    }
    const [rows, prices] = await Promise.all([
      in4QueryCached<Record<string, unknown>>(`
        SELECT h.PO_ID, h.PO_NO, h.PO_DT, pr.NAME project, h.PO_CATEGORY category, h.STATUS status, h.GRN_STATUS,
               h.PO_VALUE gross, h.PAID_AMT paid,
               (SELECT MIN(gh.GRN_DT) FROM BI.FACT_PURCHASE_GRN_DETAILS d JOIN BI.DIM_PURCHASE_GRN_HEADER gh ON gh.GRN_ID = d.GRN_ID WHERE d.PO_ID = h.PO_ID) first_grn
        FROM BI.PURCHASE_ORDER_HEADER h
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = h.PROJECT_ID
        WHERE h.SUPPLIER_ID = ${id}
        ORDER BY h.PO_DT DESC`),
      in4QueryCached<Record<string, unknown>>(`
        SELECT TOP 25 m.NAME material, x.my_rate, y.min_rate, y.suppliers
        FROM (SELECT MATERIAL_ID, SUM(NET_RATE * BASE_PO_QTY) / NULLIF(SUM(BASE_PO_QTY), 0) my_rate FROM BI.FACT_PURCHASE_ORDER_DETAILS WHERE SUPPLIER_ID = ${id} AND NET_RATE > 0 GROUP BY MATERIAL_ID) x
        JOIN (SELECT MATERIAL_ID, MIN(NET_RATE) min_rate, COUNT(DISTINCT SUPPLIER_ID) suppliers FROM BI.FACT_PURCHASE_ORDER_DETAILS WHERE NET_RATE > 0 GROUP BY MATERIAL_ID) y ON y.MATERIAL_ID = x.MATERIAL_ID
        JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = x.MATERIAL_ID
        WHERE y.suppliers > 1 AND x.my_rate > 0
        ORDER BY x.my_rate / NULLIF(y.min_rate, 0) DESC`),
    ])
    const orders: PartyOrder[] = rows.map(r => ({
      id: n(r.PO_ID), ref: s(r.PO_NO) ?? `PO ${r.PO_ID}`, date: iso(r.PO_DT), project: s(r.project), category: s(r.category),
      status: s(r.status), gross: n(r.gross), paid: n(r.paid), retention: 0, grnStatus: s(r.GRN_STATUS), firstGrn: iso(r.first_grn),
    }))
    const live = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Terminated')
    const leads = live.filter(o => o.date && o.firstGrn).map(o => (Date.parse(o.firstGrn!) - Date.parse(o.date!)) / 86400000).filter(d => d >= 0)
    return {
      card: {
        ...empty, orders, totals: totalsOf(orders),
        delivery: {
          avgLeadDays: leads.length ? Math.round(leads.reduce((t, d) => t + d, 0) / leads.length) : null,
          fulfilled: live.filter(o => o.grnStatus === 'Fullfilled').length,
          partial: live.filter(o => o.grnStatus === 'Partial').length,
          open: live.filter(o => !o.grnStatus || (o.grnStatus !== 'Fullfilled' && o.grnStatus !== 'Partial')).length,
        },
        prices: prices.map(r => ({ material: s(r.material) ?? '', myRate: n(r.my_rate), marketMin: n(r.min_rate), suppliers: n(r.suppliers) })),
      },
      in4: 'live',
    }
  } catch (e) {
    return { card: empty, in4: 'unavailable', in4Error: e instanceof Error ? e.message : String(e) }
  }
}

function totalsOf(orders: PartyOrder[]): PartyCard['totals'] {
  const live = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Terminated')
  const dates = live.map(o => o.date).filter((d): d is string => !!d).sort()
  return {
    orders: live.length,
    gross: live.reduce((t, o) => t + o.gross, 0), paid: live.reduce((t, o) => t + o.paid, 0), retention: live.reduce((t, o) => t + o.retention, 0),
    projects: new Set(live.map(o => o.project).filter(Boolean)).size, categories: new Set(live.map(o => o.category).filter(Boolean)).size,
    first: dates[0] ?? null, last: dates[dates.length - 1] ?? null,
  }
}
