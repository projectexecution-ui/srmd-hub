// "What did we pay last time?" for ONE order's line items, on demand.
//
// The WO/PO tab already flags rate changes on orders WAITING for approval
// (order-approvals.ts). Aksha, 9 Sep 2026: he wants the same beside ANY line
// in the tree while approving — the previous rate for that item, "never bought
// before" when there is none, and a few near-name suggestions from the master
// when an engineer typed the name slightly differently.
//
// Reuses the price engine (approver.ts) so a figure here matches the approvals
// view exactly, and the WO name-matching (order-approvals.ts) so a BOQ line
// finds its earlier self even with "7." numbering or spacing differences.
// Live from IN4, SELECT only. Loaded per order, lazily, when a line is opened.

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/revamp/orders-tree'
import type { In4State } from '@/lib/revamp/masters-in4'
import { buildPriceContext, referenceRate, priceDelta, type PoRateLine, type MaterialContext, type LastPurchase } from './approver'
import { referencesFor, normaliseBoq, stripBoqNumber } from './order-approvals'

/** The key both the loader and the tree line compute, so the client can find a
 *  line's history without the tree having to carry a material id. */
export const lineKey = (name: string | null | undefined, uom?: string | null) => normaliseBoq(name, uom)

/** A near-name item the engineer might have meant — from past purchases. */
export interface RateSuggestion { name: string; uom: string | null; lastRate: number; date: string | null; supplier: string | null }

export interface LineRate {
  /** normaliseBoq(name, uom) — what a PO line matches on. */
  key: string
  /** ITEM_ID — what a WO line matches on (its tree id is `boq:<item_id>`). */
  itemId: number | null
  name: string
  uom: string | null
  currentRate: number | null
  /** Most recent purchase anywhere in the trust; null = never bought. */
  last: LastPurchase | null
  /** Most recent on THIS project — the rate to compare with first. */
  lastHere: LastPurchase | null
  /** Which of the two `referenceRate` chose, for the ± label. */
  where: 'here' | 'elsewhere' | null
  /** This line's rate vs the reference, as a percent; null = nothing to compare. */
  deltaPct: number | null
  timesBought: number
  suppliers: number
  minRate: number | null
  maxRate: number | null
  onProjectSpend: number
  /** Only filled when there is no exact history — "did you mean…". */
  suggestions: RateSuggestion[]
}

export interface OrderLineRates {
  kind: 'wo' | 'po'
  lines: LineRate[]
  in4: In4State
  error: string | null
}

const n = (v: unknown) => (v == null ? 0 : Number(v))
const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  const t = d.toISOString()
  return t.startsWith('1900-01-01') ? null : t
}

/** One line's history folded into the shape the panel shows. Pure, so the
 *  never-bought and cheaper/dearer cases are tested rather than eyeballed. */
export function toLineRate(
  line: { key: string; itemId: number | null; name: string; uom: string | null; rate: number | null },
  ctx: MaterialContext | undefined,
  suggestions: RateSuggestion[] = [],
): LineRate {
  const ref = referenceRate(ctx)
  return {
    key: line.key, itemId: line.itemId, name: line.name, uom: line.uom, currentRate: line.rate,
    last: ctx?.last ?? null, lastHere: ctx?.lastHere ?? null,
    where: ref ? ref.where : null,
    deltaPct: priceDelta(line.rate, ctx),
    timesBought: ctx?.purchases ?? 0,
    suppliers: ctx?.suppliers ?? 0,
    minRate: ctx?.minRate ?? null,
    maxRate: ctx?.maxRate ?? null,
    onProjectSpend: ctx?.onProject.spend ?? 0,
    suggestions: ref ? [] : suggestions, // suggestions only matter when there is no real history
  }
}

/** Significant words in a material name, for a near-name lookup. */
export function nameTokens(name: string): string[] {
  return [...new Set(stripBoqNumber(name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4))]
}

/** Rank near-name candidates against a line by shared tokens, then recency. Pure. */
export function rankSuggestions(lineName: string, cands: Array<RateSuggestion & { tokens: string[] }>): RateSuggestion[] {
  const want = new Set(nameTokens(lineName))
  if (want.size === 0) return []
  return cands
    .map(c => ({ c, overlap: c.tokens.filter(t => want.has(t)).length }))
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || String(b.c.date ?? '').localeCompare(String(a.c.date ?? '')))
    .slice(0, 3)
    .map(x => ({ name: x.c.name, uom: x.c.uom, lastRate: x.c.lastRate, date: x.c.date, supplier: x.c.supplier }))
}

const EMPTY = (kind: 'wo' | 'po', in4: OrderLineRates['in4'], error: string | null = null): OrderLineRates => ({ kind, lines: [], in4, error })

/** History for every line of one order. `in4Id` is IN4's own id (PO header id
 *  or WO id); `ref` (the PO number) is a fallback when the header id was not
 *  captured. Never throws — a failure returns in4:'unavailable' with lines
 *  still listed but blank, so the panel says so. */
export async function loadOrderLineRates(kind: 'wo' | 'po', in4Id: number | null, ref?: string | null): Promise<OrderLineRates> {
  try {
    return kind === 'po' ? await loadPo(in4Id, ref) : await loadWo(in4Id)
  } catch (e) {
    return EMPTY(kind, 'unavailable', e instanceof Error ? e.message : String(e))
  }
}

async function loadPo(poId: number | null, ref?: string | null): Promise<OrderLineRates> {
  const byId = poId != null && Number.isInteger(poId)
  if (!byId && !ref) return EMPTY('po', 'unavailable', 'no purchase-order id')
  const supabase = await createClient()

  const { data: itemRows, error: itemErr } = await supabase.rpc('in4_po_lines',
    byId ? { p_po_id: poId } : { p_ref: ref })
  if (itemErr) return EMPTY('po', 'unavailable', itemErr.message)
  const items = (itemRows ?? []) as Array<Record<string, unknown>>
  if (items.length === 0) return EMPTY('po', 'mirror')

  const projectId = items[0].project_id == null ? null : n(items[0].project_id)
  const materialIds = [...new Set(items.map(i => i.material_id).filter((x): x is number => x != null).map(Number))]

  // Every prior PO line for these materials (this PO excluded), folded per material.
  const hist = materialIds.length
    ? (await fetchAll<Record<string, unknown>>((from, to) => supabase
        .rpc('in4_material_po_history', { p_material_ids: materialIds, p_exclude_po: byId ? poId : null, p_approved_only: true })
        .range(from, to))).rows
    : []
  const histLines: PoRateLine[] = hist.map(r => ({
    materialId: n(r.material_id), poId: n(r.po_id), poNo: s(r.po_no), date: iso(r.po_dt),
    supplier: s(r.supplier), project: s(r.project), projectId: r.project_id == null ? null : n(r.project_id),
    qty: n(r.qty), rate: n(r.rate), value: n(r.value), grnQty: n(r.grn_qty),
  }))
  const ctxByMaterial = buildPriceContext(histLines, projectId)

  // Near-name suggestions for the materials with no history at all.
  const orphans = items
    .filter(i => { const c = ctxByMaterial.get(n(i.material_id)); return !c || c.purchases === 0 })
    .map(i => ({ name: s(i.material), uom: s(i.uom) }))
    .filter((x): x is { name: string; uom: string | null } => !!x.name)
  const suggByLine = await poSuggestions(orphans, materialIds)

  const lines = items.map(i => {
    const name = s(i.material) ?? `Material ${n(i.material_id)}`
    return toLineRate(
      { key: lineKey(name, s(i.uom)), itemId: n(i.item_id), name, uom: s(i.uom), rate: i.rate == null ? null : n(i.rate) },
      ctxByMaterial.get(n(i.material_id)),
      suggByLine.get(lineKey(name, null)) ?? [],
    )
  })
  return { kind: 'po', lines, in4: 'mirror', error: null }
}

/** A unit reduced to a comparison key, so "SqFt" == "sqft" == "Sq. Ft.". */
const uomKey = (u: string | null | undefined) => String(u ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** For each orphan line, up to 3 past-bought materials with a similar name AND
 *  the SAME unit — never a per-box rate against a per-SqFt tile — with their
 *  last rate. One candidate query + one rate query; best-effort. */
async function poSuggestions(orphans: Array<{ name: string; uom: string | null }>, excludeIds: number[]): Promise<Map<string, RateSuggestion[]>> {
  const out = new Map<string, RateSuggestion[]>()
  if (orphans.length === 0) return out
  const tokens = [...new Set(orphans.flatMap(o => nameTokens(o.name)))].slice(0, 40)
  if (tokens.length === 0) return out
  try {
    const supabase = await createClient()
    const { data: candRows } = await supabase.rpc('in4_material_name_search',
      { p_tokens: tokens, p_exclude_ids: excludeIds, p_limit: 80 })
    const cands = (candRows ?? []) as Array<Record<string, unknown>>
    const candIds = cands.map(c => n(c.id)).filter(Boolean)
    if (candIds.length === 0) return out
    const { data: rateRows } = await supabase.rpc('in4_material_last_rate', { p_material_ids: candIds })
    const lastByMat = new Map<number, { rate: number; date: string | null; supplier: string | null }>()
    for (const r of ((rateRows ?? []) as Array<Record<string, unknown>>)) {
      lastByMat.set(n(r.material_id), { rate: n(r.rate), date: iso(r.po_dt), supplier: s(r.supplier) })
    }
    const pool = cands
      .map(c => { const last = lastByMat.get(n(c.id)); return last ? { name: s(c.name) ?? '', uom: s(c.uom), lastRate: last.rate, date: last.date, supplier: last.supplier, tokens: nameTokens(s(c.name) ?? '') } : null })
      .filter((x): x is RateSuggestion & { tokens: string[] } => !!x && x.name !== '')
    // Per orphan line, keep only same-unit candidates (when the line has a unit),
    // so a ₹648/box tile never appears against a ₹52/SqFt one. Keyed by name.
    for (const o of orphans) {
      const same = o.uom ? pool.filter(c => uomKey(c.uom) === uomKey(o.uom)) : pool
      out.set(lineKey(o.name, null), rankSuggestions(o.name, same))
    }
    return out
  } catch {
    return out
  }
}

async function loadWo(woId: number | null): Promise<OrderLineRates> {
  if (woId == null || !Number.isInteger(woId)) return EMPTY('wo', 'unavailable', 'no work-order id')
  const supabase = await createClient()
  const { data: itemRows, error: itemErr } = await supabase.rpc('in4_wo_boq_lines', { p_wo_id: woId })
  if (itemErr) return EMPTY('wo', 'unavailable', itemErr.message)
  const items = (itemRows ?? []) as Array<Record<string, unknown>>
  if (items.length === 0) return EMPTY('wo', 'mirror')
  const projectId = items[0].project_id == null ? null : n(items[0].project_id)

  const boqNames = [...new Set(items.map(i => stripBoqNumber(s(i.subname))).filter(x => x.length >= 3))]
  const refs = boqNames.length
    ? (await fetchAll<Record<string, unknown>>((from, to) => supabase
        .rpc('in4_wo_boq_reference_lines', { p_names: boqNames, p_exclude_wo: woId })
        .range(from, to))).rows
    : []
  const refLines = refs.map(r => ({
    key: normaliseBoq(s(r.subname), s(r.uom)), materialId: 0, poId: n(r.wo_id), poNo: s(r.wo_no), date: iso(r.wo_dt),
    supplier: s(r.party), project: s(r.project), projectId: r.project_id == null ? null : n(r.project_id), qty: n(r.qty), rate: n(r.rate), value: n(r.amt), grnQty: 0,
  }))
  const keys = items.map(i => normaliseBoq(s(i.subname), s(i.uom)))
  const ctxByKey = referencesFor(refLines, keys, projectId)

  // Near-name suggestions: prior WO lines whose name matched by LIKE but under a
  // different normalised key than the line — the "similar name" the engineer meant.
  const byKeyLast = new Map<string, RateSuggestion & { tokens: string[] }>()
  for (const r of refLines) {
    if (byKeyLast.has(r.key)) continue
    const name = String(refs.find(x => normaliseBoq(s(x.subname), s(x.uom)) === r.key)?.subname ?? '').trim()
    byKeyLast.set(r.key, { name: stripBoqNumber(name), uom: null, lastRate: r.rate, date: r.date, supplier: r.supplier, tokens: nameTokens(name) })
  }
  const pool = [...byKeyLast.values()]

  const lines = items.map(i => {
    const name = s(i.subname) ?? '(unnamed item)'
    const key = normaliseBoq(name, s(i.uom))
    const ctx = ctxByKey.get(key)
    const suggestions = ctx && ctx.purchases > 0 ? [] : rankSuggestions(name, pool.filter(p => normaliseBoq(p.name, null) !== normaliseBoq(name, null)))
    return { ...toLineRate({ key, itemId: n(i.item_id), name, uom: s(i.uom), rate: i.rate == null ? null : n(i.rate) }, ctx, suggestions) }
  })
  return { kind: 'wo', lines, in4: 'mirror', error: null }
}
