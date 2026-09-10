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

import { in4Query, in4Config } from '@/lib/in4/db'
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
  in4: 'live' | 'not-configured' | 'unavailable'
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
const like = (v: string) => v.replace(/[%_[]/g, ch => `[${ch}]`).replace(/'/g, "''")

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
  if (!in4Config()) return EMPTY(kind, 'not-configured')
  try {
    return kind === 'po' ? await loadPo(in4Id, ref) : await loadWo(in4Id)
  } catch (e) {
    return EMPTY(kind, 'unavailable', e instanceof Error ? e.message : String(e))
  }
}

async function loadPo(poId: number | null, ref?: string | null): Promise<OrderLineRates> {
  const where = poId != null && Number.isInteger(poId)
    ? `p.ID = ${poId}`
    : ref && /^[A-Za-z0-9/_\-. ]{1,60}$/.test(ref) ? `p.DISPLAY_NO = '${ref.replace(/'/g, "''")}'` : null
  if (!where) return EMPTY('po', 'unavailable', 'no purchase-order id')

  const items = await in4Query<Record<string, unknown>>(`
    SELECT p.PROJECT_ID, pi.ID item_id, pi.MATERIAL_ID, m.NAME material, u.NAME uom, f.NET_RATE rate
    FROM PURCH_PURCHASE_ORDER p
    JOIN PURCH_PURCHASE_ORDER_ITEMS pi ON pi.PURCHASE_ORDER_ID = p.ID
    LEFT JOIN PURCH_MATERIAL_LOOKUP m ON m.ID = pi.MATERIAL_ID
    LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = m.UNIT_OF_MEASUREMENT
    LEFT JOIN BI.FACT_PURCHASE_ORDER_DETAILS f ON f.ITEM_ID = pi.ID
    WHERE ${where} ORDER BY pi.ID`)
  if (items.length === 0) return EMPTY('po', 'live')

  const projectId = items[0].PROJECT_ID == null ? null : n(items[0].PROJECT_ID)
  const materialIds = [...new Set(items.map(i => i.MATERIAL_ID).filter((x): x is number => x != null).map(Number))]

  // Every prior PO line for these materials (this PO excluded), folded per material.
  const hist = materialIds.length ? await in4Query<Record<string, unknown>>(`
    SELECT f.MATERIAL_ID, f.PO_ID, h.PO_NO, h.PO_DT, COALESCE(sp.PrintName, sp.NAME) supplier, pr.NAME project, f.PROJECT_ID,
           f.BASE_PO_QTY qty, f.NET_RATE rate, f.MATERIAL_VALUE value, f.GRN_QTY grn_qty
    FROM BI.FACT_PURCHASE_ORDER_DETAILS f
    JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = f.PO_ID
    LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = f.SUPPLIER_ID
    LEFT JOIN ENGG_PROJECT pr ON pr.ID = f.PROJECT_ID
    WHERE f.MATERIAL_ID IN (${materialIds.join(',')}) AND f.NET_RATE > 0 AND h.STATUS_ID = 2 ${poId != null ? `AND f.PO_ID <> ${poId}` : ''}
    ORDER BY h.PO_DT DESC`) : []
  const histLines: PoRateLine[] = hist.map(r => ({
    materialId: n(r.MATERIAL_ID), poId: n(r.PO_ID), poNo: s(r.PO_NO), date: iso(r.PO_DT),
    supplier: s(r.supplier), project: s(r.project), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID),
    qty: n(r.qty), rate: n(r.rate), value: n(r.value), grnQty: n(r.grn_qty),
  }))
  const ctxByMaterial = buildPriceContext(histLines, projectId)

  // Near-name suggestions for the materials with no history at all.
  const orphans = items
    .filter(i => { const c = ctxByMaterial.get(n(i.MATERIAL_ID)); return !c || c.purchases === 0 })
    .map(i => ({ name: s(i.material), uom: s(i.uom) }))
    .filter((x): x is { name: string; uom: string | null } => !!x.name)
  const suggByLine = await poSuggestions(orphans, materialIds)

  const lines = items.map(i => {
    const name = s(i.material) ?? `Material ${n(i.MATERIAL_ID)}`
    return toLineRate(
      { key: lineKey(name, s(i.uom)), itemId: n(i.item_id), name, uom: s(i.uom), rate: i.rate == null ? null : n(i.rate) },
      ctxByMaterial.get(n(i.MATERIAL_ID)),
      suggByLine.get(lineKey(name, null)) ?? [],
    )
  })
  return { kind: 'po', lines, in4: 'live', error: null }
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
    const cands = await in4Query<Record<string, unknown>>(`
      SELECT TOP 80 m.ID, m.NAME, u.NAME uom
      FROM PURCH_MATERIAL_LOOKUP m
      LEFT JOIN COMMON_UOM_LOOKUP u ON u.ID = m.UNIT_OF_MEASUREMENT
      WHERE (${tokens.map(t => `m.NAME LIKE '%${like(t)}%'`).join(' OR ')})
        ${excludeIds.length ? `AND m.ID NOT IN (${excludeIds.join(',')})` : ''}`)
    const candIds = cands.map(c => n(c.ID)).filter(Boolean)
    if (candIds.length === 0) return out
    const rates = await in4Query<Record<string, unknown>>(`
      SELECT f.MATERIAL_ID, h.PO_DT, f.NET_RATE, COALESCE(sp.PrintName, sp.NAME) supplier
      FROM BI.FACT_PURCHASE_ORDER_DETAILS f
      JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = f.PO_ID
      LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = f.SUPPLIER_ID
      WHERE f.MATERIAL_ID IN (${candIds.join(',')}) AND f.NET_RATE > 0 AND h.STATUS_ID = 2
      ORDER BY h.PO_DT DESC`)
    const lastByMat = new Map<number, { rate: number; date: string | null; supplier: string | null }>()
    for (const r of rates) { const id = n(r.MATERIAL_ID); if (!lastByMat.has(id)) lastByMat.set(id, { rate: n(r.NET_RATE), date: iso(r.PO_DT), supplier: s(r.supplier) }) }
    const pool = cands
      .map(c => { const last = lastByMat.get(n(c.ID)); return last ? { name: s(c.NAME) ?? '', uom: s(c.uom), lastRate: last.rate, date: last.date, supplier: last.supplier, tokens: nameTokens(s(c.NAME) ?? '') } : null })
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
  const items = await in4Query<Record<string, unknown>>(`
    SELECT w.PROJECT_ID, d.ITEM_ID, d.BOQ_SUBNAME, d.UOM, f.RATE
    FROM ENGG_WORK_ORDER w
    JOIN BI.DIM_ENGG_WORK_ORDER_BOQ d ON d.WO_ID = w.ID
    JOIN BI.FACT_ENGG_WORK_ORDER_BOQ f ON f.ITEM_ID = d.ITEM_ID
    WHERE w.ID = ${woId} ORDER BY d.ITEM_ID`)
  if (items.length === 0) return EMPTY('wo', 'live')
  const projectId = items[0].PROJECT_ID == null ? null : n(items[0].PROJECT_ID)

  const boqNames = [...new Set(items.map(i => stripBoqNumber(s(i.BOQ_SUBNAME))).filter(x => x.length >= 3))]
  const refs = boqNames.length ? await in4Query<Record<string, unknown>>(`
    SELECT d.BOQ_SUBNAME, d.UOM, d.WO_ID, w.DISPLAY_NO wo_no, w.CREATION_DT, sp.FIRM_NAME party, w.PROJECT_ID, pr.NAME project, f.QUANTITY, f.RATE, f.AMT
    FROM BI.DIM_ENGG_WORK_ORDER_BOQ d
    JOIN BI.FACT_ENGG_WORK_ORDER_BOQ f ON f.ITEM_ID = d.ITEM_ID
    JOIN ENGG_WORK_ORDER w ON w.ID = d.WO_ID
    LEFT JOIN ENGG_SERVICE_PROVIDER sp ON sp.ID = w.SERVICE_PROVIDER_ID
    LEFT JOIN ENGG_PROJECT pr ON pr.ID = w.PROJECT_ID
    WHERE w.STATUS = 2 AND f.RATE > 0 AND w.ID <> ${woId} AND (${boqNames.map(x => `d.BOQ_SUBNAME LIKE '%${like(x)}%'`).join(' OR ')})
    ORDER BY w.CREATION_DT DESC`) : []
  const refLines = refs.map(r => ({
    key: normaliseBoq(s(r.BOQ_SUBNAME), s(r.UOM)), materialId: 0, poId: n(r.WO_ID), poNo: s(r.wo_no), date: iso(r.CREATION_DT),
    supplier: s(r.party), project: s(r.project), projectId: r.PROJECT_ID == null ? null : n(r.PROJECT_ID), qty: n(r.QUANTITY), rate: n(r.RATE), value: n(r.AMT), grnQty: 0,
  }))
  const keys = items.map(i => normaliseBoq(s(i.BOQ_SUBNAME), s(i.UOM)))
  const ctxByKey = referencesFor(refLines, keys, projectId)

  // Near-name suggestions: prior WO lines whose name matched by LIKE but under a
  // different normalised key than the line — the "similar name" the engineer meant.
  const byKeyLast = new Map<string, RateSuggestion & { tokens: string[] }>()
  for (const r of refLines) {
    if (byKeyLast.has(r.key)) continue
    const name = String(refs.find(x => normaliseBoq(s(x.BOQ_SUBNAME), s(x.UOM)) === r.key)?.BOQ_SUBNAME ?? '').trim()
    byKeyLast.set(r.key, { name: stripBoqNumber(name), uom: null, lastRate: r.rate, date: r.date, supplier: r.supplier, tokens: nameTokens(name) })
  }
  const pool = [...byKeyLast.values()]

  const lines = items.map(i => {
    const name = s(i.BOQ_SUBNAME) ?? '(unnamed item)'
    const key = normaliseBoq(name, s(i.UOM))
    const ctx = ctxByKey.get(key)
    const suggestions = ctx && ctx.purchases > 0 ? [] : rankSuggestions(name, pool.filter(p => normaliseBoq(p.name, null) !== normaliseBoq(name, null)))
    return { ...toLineRate({ key, itemId: n(i.ITEM_ID), name, uom: s(i.UOM), rate: i.RATE == null ? null : n(i.RATE) }, ctx, suggestions) }
  })
  return { kind: 'wo', lines, in4: 'live', error: null }
}
