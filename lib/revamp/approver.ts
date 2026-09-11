// What an approver needs beside an indent or a PO waiting in IN4: for each
// material, what it last cost and from whom, and how much of it this project
// has already bought. Live from IN4's PO facts (BI.FACT_PURCHASE_ORDER_DETAILS
// — every PO line ever, with net rate, quantity and received quantity), read
// only for the materials on the documents that are waiting. SELECT only.
//
// Aksha, 10 Sep 2026: "wear an Approver hat — it should come in an IE-type
// table along with all details."

import { in4QueryCached, in4Config } from '@/lib/in4/db'

export interface PoRateLine {
  materialId: number
  poId: number; poNo: string | null; date: string | null
  supplier: string | null; project: string | null; projectId: number | null
  qty: number; rate: number; value: number; grnQty: number
}

export interface LastPurchase { rate: number; date: string | null; supplier: string | null; project: string | null; poNo: string | null; qty: number }

export interface MaterialContext {
  materialId: number
  /** The most recent purchase anywhere in the trust. */
  last: LastPurchase | null
  /** The most recent purchase on this project — the rate an approver compares with first. */
  lastHere: LastPurchase | null
  /** Everything this project has bought of the material so far. */
  onProject: { orderedQty: number; receivedQty: number; spend: number; pos: number }
  purchases: number
  suppliers: number
  minRate: number | null
  maxRate: number | null
}

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const toLast = (l: PoRateLine): LastPurchase => ({ rate: l.rate, date: l.date, supplier: l.supplier, project: l.project, poNo: l.poNo, qty: l.qty })

/** Every PO line for the materials, folded per material. Pure. */
export function buildPriceContext(lines: readonly PoRateLine[], projectId: number | null): Map<number, MaterialContext> {
  const by = new Map<number, PoRateLine[]>()
  for (const l of lines) by.set(l.materialId, [...(by.get(l.materialId) ?? []), l])
  const out = new Map<number, MaterialContext>()
  for (const [materialId, ls] of by) {
    const sorted = [...ls].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    const here = projectId == null ? [] : sorted.filter(l => l.projectId === projectId)
    const rates = sorted.map(l => l.rate).filter(r => r > 0)
    out.set(materialId, {
      materialId,
      last: sorted[0] ? toLast(sorted[0]) : null,
      lastHere: here[0] ? toLast(here[0]) : null,
      onProject: {
        orderedQty: here.reduce((t, l) => t + l.qty, 0), receivedQty: here.reduce((t, l) => t + l.grnQty, 0),
        spend: here.reduce((t, l) => t + l.value, 0), pos: new Set(here.map(l => l.poId)).size,
      },
      purchases: sorted.length,
      suppliers: new Set(sorted.map(l => l.supplier ?? '')).size,
      minRate: rates.length ? Math.min(...rates) : null,
      maxRate: rates.length ? Math.max(...rates) : null,
    })
  }
  return out
}

/** The rate to compare a new price with — this project's last, else the trust's last. */
export function referenceRate(ctx: MaterialContext | undefined): { rate: number; where: 'here' | 'elsewhere'; from: LastPurchase } | null {
  if (!ctx) return null
  if (ctx.lastHere) return { rate: ctx.lastHere.rate, where: 'here', from: ctx.lastHere }
  if (ctx.last) return { rate: ctx.last.rate, where: 'elsewhere', from: ctx.last }
  return null
}

/** A PO line's rate against the reference, as a percentage; null when there is nothing to compare with. */
export function priceDelta(rate: number | null, ctx: MaterialContext | undefined): number | null {
  const ref = referenceRate(ctx)
  if (rate == null || !ref || ref.rate <= 0) return null
  return (rate - ref.rate) / ref.rate * 100
}

export interface PriceContext { byMaterial: Map<number, MaterialContext>; in4: 'live' | 'not-configured' | 'unavailable'; error: string | null }

const chunks = <T,>(xs: T[], size: number) => { const out: T[][] = []; for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size)); return out }

/** Live: every PO line ever raised for these materials. */
export async function loadPriceContext(materialIds: readonly (number | null)[], projectId: number | null): Promise<PriceContext> {
  const ids = [...new Set(materialIds.filter((x): x is number => Number.isInteger(x)))]
  if (!in4Config()) return { byMaterial: new Map(), in4: 'not-configured', error: null }
  if (ids.length === 0) return { byMaterial: new Map(), in4: 'live', error: null }
  try {
    const lines: PoRateLine[] = []
    for (const c of chunks(ids, 400)) {
      const rows = await in4QueryCached<Record<string, unknown>>(`
        SELECT f.MATERIAL_ID, f.PO_ID, h.PO_NO, h.PO_DT, COALESCE(sp.PrintName, sp.NAME) supplier, pr.NAME project, f.PROJECT_ID,
               f.BASE_PO_QTY qty, f.NET_RATE rate, f.MATERIAL_VALUE value, f.GRN_QTY grn_qty
        FROM BI.FACT_PURCHASE_ORDER_DETAILS f
        JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = f.PO_ID
        LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = f.SUPPLIER_ID
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = f.PROJECT_ID
        WHERE f.MATERIAL_ID IN (${c.join(',')}) AND f.NET_RATE > 0
        ORDER BY h.PO_DT DESC`)
      for (const r of rows) lines.push({
        materialId: n(r.MATERIAL_ID), poId: n(r.PO_ID), poNo: s(r.PO_NO), date: iso(r.PO_DT),
        supplier: s(r.supplier), project: s(r.project), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID),
        qty: n(r.qty), rate: n(r.rate), value: n(r.value), grnQty: n(r.grn_qty),
      })
    }
    return { byMaterial: buildPriceContext(lines, projectId), in4: 'live', error: null }
  } catch (e) {
    return { byMaterial: new Map(), in4: 'unavailable', error: e instanceof Error ? e.message : String(e) }
  }
}
