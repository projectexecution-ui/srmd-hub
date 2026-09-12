// Rates — what SRMD actually paid, read from IN4's own orders.
//
// The engineer's question before raising an indent or a BOQ is "what did we
// pay last time, and to whom?". IN4 has the answer in two places and no
// screen for it: every PO line (BI.FACT_PURCHASE_ORDER_DETAILS: material,
// supplier, quantity, rate, value) and every work-order BOQ line
// (BI.FACT_ENGG_WORK_ORDER_BOQ: item, contractor, quantity, rate). This
// reads them live, grouped the way the question is asked.
//
// 2,508 materials carry a purchase rate; 145 of them were bought from more
// than one supplier at rates 20 % or more apart — the spread a Head wants
// to see before the next PO. SELECT only.

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/revamp/orders-tree'
import type { In4Read } from './masters-in4'

export interface PoRateLine {
  materialId: number; material: string; uom: string | null
  poId: number; poNo: string | null; date: string | null
  supplierId: number | null; supplier: string | null; project: string | null
  qty: number; rate: number; value: number
}

export interface MaterialRates {
  materialId: number; material: string; uom: string | null
  lines: PoRateLine[]
  lastRate: number | null; lastDate: string | null; lastSupplier: string | null
  minRate: number; maxRate: number; avgRate: number
  suppliers: string[]
  /** (max − min) / min — the price spread across everything ever paid. */
  spread: number
  spend: number
  /** Supplier with the lowest average rate, when more than one supplied. */
  cheapest: { supplier: string; rate: number } | null
}

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Group PO lines by material and work out the figures. Pure. */
export function summariseMaterialRates(lines: readonly PoRateLine[]): MaterialRates[] {
  const by = new Map<number, PoRateLine[]>()
  for (const l of lines) by.set(l.materialId, [...(by.get(l.materialId) ?? []), l])
  const out: MaterialRates[] = []
  for (const [materialId, ls] of by) {
    const sorted = [...ls].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    const rates = ls.map(l => l.rate)
    const minRate = Math.min(...rates), maxRate = Math.max(...rates)
    const spend = ls.reduce((t, l) => t + l.value, 0)
    const qty = ls.reduce((t, l) => t + l.qty, 0)
    const avgRate = qty > 0 ? ls.reduce((t, l) => t + l.rate * l.qty, 0) / qty : rates.reduce((t, r) => t + r, 0) / rates.length
    const bySupplier = new Map<string, { sum: number; q: number }>()
    for (const l of ls) if (l.supplier) { const c = bySupplier.get(l.supplier) ?? { sum: 0, q: 0 }; c.sum += l.rate * l.qty; c.q += l.qty; bySupplier.set(l.supplier, c) }
    const supplierAvgs = [...bySupplier.entries()].map(([supplier, c]) => ({ supplier, rate: c.q > 0 ? c.sum / c.q : 0 })).filter(x => x.rate > 0).sort((a, b) => a.rate - b.rate)
    out.push({
      materialId, material: ls[0].material, uom: ls[0].uom, lines: sorted,
      lastRate: sorted[0]?.rate ?? null, lastDate: sorted[0]?.date ?? null, lastSupplier: sorted[0]?.supplier ?? null,
      minRate, maxRate, avgRate, suppliers: [...bySupplier.keys()].sort(),
      spread: minRate > 0 ? (maxRate - minRate) / minRate : 0,
      spend,
      cheapest: supplierAvgs.length > 1 ? supplierAvgs[0] : null,
    })
  }
  return out.sort((a, b) => b.spend - a.spend)
}


/** Every PO line for materials whose name matches. Live. */
export async function searchMaterialRates(q: string): Promise<{ materials: MaterialRates[] } & In4Read> {
  if (!q.trim()) return { materials: [], in4: 'mirror' }
  const supabase = await createClient()
  const { rows, error } = await fetchAll<Record<string, unknown>>(
    (from, to) => supabase.rpc('in4_material_rate_search', { p_q: q, p_limit: 1500 }).range(from, to))
  if (error) return { materials: [], in4: 'unavailable', in4Error: error }
  return { materials: summariseMaterialRates(rows.map(toLine)), in4: 'mirror' }
}

const toLine = (r: Record<string, unknown>): PoRateLine => ({
  materialId: n(r.material_id), material: s(r.material) ?? `Material ${r.material_id}`, uom: s(r.uom),
  poId: n(r.po_id), poNo: s(r.po_no), date: iso(r.po_dt),
  supplierId: r.supplier_id == null ? null : n(r.supplier_id), supplier: s(r.supplier), project: s(r.project),
  qty: n(r.qty), rate: n(r.rate), value: n(r.value),
})

export interface MaterialOverviewRow {
  materialId: number; material: string; uom: string | null
  lines: number; suppliers: number; minRate: number; maxRate: number; spend: number; lastDate: string | null
  spread: number
}

/** The 300 materials SRMD has spent most on, with their rate spread. */
export async function loadMaterialRateOverview(): Promise<{ rows: MaterialOverviewRow[] } & In4Read> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('in4_material_rate_overview', { p_limit: 300 })
  if (error) return { rows: [], in4: 'unavailable', in4Error: error.message }
  return {
    rows: ((data ?? []) as Array<Record<string, unknown>>).map(r => {
      const minRate = n(r.min_rate), maxRate = n(r.max_rate)
      return {
        materialId: n(r.material_id), material: s(r.material) ?? '', uom: s(r.uom), lines: n(r.lines), suppliers: n(r.suppliers),
        minRate, maxRate, spend: n(r.spend), lastDate: iso(r.last_dt), spread: minRate > 0 ? (maxRate - minRate) / minRate : 0,
      }
    }),
    in4: 'mirror',
  }
}

export interface BoqRateLine {
  woId: number; woNo: string | null; date: string | null; contractor: string | null; project: string | null
  subname: string | null; description: string | null; uom: string | null; qty: number; rate: number
}

/** Work-order BOQ lines whose sub-name or description matches.
 *
 *  From the mirror. Every table this needed — the WO BOQ items, the work
 *  orders and their dates, the contractors, the projects — was already
 *  mirrored, so this one was crossing to us-east-1 for data that had been
 *  sitting in Mumbai all along. */
export async function searchBoqRates(q: string): Promise<{ lines: BoqRateLine[]; capped: boolean } & In4Read> {
  if (!q.trim()) return { lines: [], capped: false, in4: 'mirror' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('in4_boq_rate_search', { p_q: q, p_limit: 400 })
  if (error) return { lines: [], capped: false, in4: 'unavailable', in4Error: error.message }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return {
    lines: rows.map(r => ({
      woId: n(r.wo_id), woNo: s(r.wo_no), date: iso(r.wo_dt), contractor: s(r.contractor), project: s(r.project),
      subname: s(r.subname), description: s(r.description), uom: s(r.uom), qty: n(r.qty), rate: n(r.rate),
    })),
    capped: rows.length >= 400, in4: 'mirror',
  }
}
