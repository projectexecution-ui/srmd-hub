// What an approver needs beside an indent or a PO waiting in IN4: for each
// material, what it last cost and from whom, and how much of it this project
// has already bought. Live from IN4's PO facts (BI.FACT_PURCHASE_ORDER_DETAILS
// — every PO line ever, with net rate, quantity and received quantity), read
// only for the materials on the documents that are waiting. SELECT only.
//
// Aksha, 10 Sep 2026: "wear an Approver hat — it should come in an IE-type
// table along with all details."

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/revamp/orders-tree'
import type { In4State } from '@/lib/revamp/masters-in4'

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

export interface PriceContext { byMaterial: Map<number, MaterialContext>; in4: In4State; error: string | null }


/** What these materials have cost before, from the mirror.
 *
 *  This counts EVERY purchase order, approved or not — unlike the line-rates
 *  panel, which counts only approved ones. That difference was in IN4's own
 *  two queries and is kept: an approver comparing a price wants to see what
 *  else is in flight, not only what is already signed. */
export async function loadPriceContext(materialIds: readonly (number | null)[], projectId: number | null): Promise<PriceContext> {
  const ids = [...new Set(materialIds.filter((x): x is number => Number.isInteger(x)))]
  if (ids.length === 0) return { byMaterial: new Map(), in4: 'mirror', error: null }
  const supabase = await createClient()
  const { rows, error } = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase.rpc('in4_material_po_history', { p_material_ids: ids, p_approved_only: false }).range(from, to))
  if (error) return { byMaterial: new Map(), in4: 'unavailable', error }
  const lines: PoRateLine[] = rows.map(r => ({
    materialId: n(r.material_id), poId: n(r.po_id), poNo: s(r.po_no), date: iso(r.po_dt),
    supplier: s(r.supplier), project: s(r.project), projectId: r.project_id == null ? null : n(r.project_id),
    qty: n(r.qty), rate: n(r.rate), value: n(r.value), grnQty: n(r.grn_qty),
  }))
  return { byMaterial: buildPriceContext(lines, projectId), in4: 'mirror', error: null }
}
