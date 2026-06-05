// Pure comparison-maker math — extracted from the comparison grid component
// so it can be unit-tested and is the single source of truth for the L1/L2
// ranking that decides which vendor looks cheapest.
//
// A "quote" is one vendor's price for one scope item. The line amount is
// ALWAYS derived as quantity × rate — there is no manual lump-sum entry in
// the UI. We therefore compute the amount LIVE from the current quantity
// rather than trusting a stored `amount` snapshot (which goes stale the
// moment someone edits an item's quantity after rates were typed).

export interface CmpItem {
  id: string
  quantity: number | null
}
export interface CmpVendor {
  id: string
}
export interface CmpQuote {
  item_id: string
  vendor_id: string
  rate: number | null
  amount: number | null
  not_quoted: boolean
}

export function quoteKey(itemId: string, vendorId: string): string {
  return `${itemId}::${vendorId}`
}

// Generic on the quote type so callers that pass a richer Quote (with id,
// notes, etc.) get a Map of that richer type back — the grid relies on
// quote.id for its upsert path.
export function buildQuoteMap<Q extends CmpQuote>(quotes: Q[]): Map<string, Q> {
  const m = new Map<string, Q>()
  for (const q of quotes) m.set(quoteKey(q.item_id, q.vendor_id), q)
  return m
}

/** Is this quote a real, usable price? (present, not flagged not-quoted,
 *  and a finite numeric rate). */
export function isLiveQuote(q: CmpQuote | null | undefined): q is CmpQuote {
  return !!q && !q.not_quoted && q.rate != null && Number.isFinite(q.rate)
}

/** The line amount for a quote, computed LIVE from the current quantity.
 *  Returns null when there's no usable rate. When the item has no quantity
 *  we fall back to the stored amount (the only case where qty×rate can't be
 *  formed); otherwise the stored amount is ignored to avoid staleness. */
export function quoteLineAmount(q: CmpQuote | null | undefined, item: CmpItem): number | null {
  if (!isLiveQuote(q)) return null
  const rate = Number(q.rate)
  if (item.quantity != null && Number.isFinite(Number(item.quantity))) {
    return Number(item.quantity) * rate
  }
  return q.amount != null && Number.isFinite(q.amount) ? Number(q.amount) : null
}

/** Per-item best (lowest) rate among vendors who gave a usable quote.
 *  Returns Map<itemId, lowestRate>; items with no quotes are absent. */
export function computeItemBest(
  items: CmpItem[],
  vendors: CmpVendor[],
  quoteMap: Map<string, CmpQuote>,
): Map<string, number> {
  const best = new Map<string, number>()
  for (const it of items) {
    let lo: number | null = null
    for (const v of vendors) {
      const q = quoteMap.get(quoteKey(it.id, v.id))
      if (isLiveQuote(q)) {
        const rate = Number(q.rate)
        if (lo == null || rate < lo) lo = rate
      }
    }
    if (lo != null) best.set(it.id, lo)
  }
  return best
}

export interface VendorTotal {
  total: number
  missing: number
  quoted: number
}

/** Per-vendor grand total (sum of live line amounts), plus how many scope
 *  items they quoted vs left missing. */
export function computeVendorTotals(
  items: CmpItem[],
  vendors: CmpVendor[],
  quoteMap: Map<string, CmpQuote>,
): Map<string, VendorTotal> {
  const out = new Map<string, VendorTotal>()
  for (const v of vendors) {
    let total = 0, missing = 0, quoted = 0
    for (const it of items) {
      const q = quoteMap.get(quoteKey(it.id, v.id))
      if (!isLiveQuote(q)) { missing++; continue }
      quoted++
      total += quoteLineAmount(q, it) ?? 0
    }
    out.set(v.id, { total, missing, quoted })
  }
  return out
}

/** L-ranking: vendors sorted by total ascending (cheapest = L1). Vendors
 *  with a non-positive total are unranked (absent from the map). Stable on
 *  ties (preserves input order), so tied vendors get sequential ranks.
 *
 *  NOTE: this ranks on each vendor's OWN total regardless of how many items
 *  they quoted — a vendor missing most of the scope but cheap on a few can
 *  rank L1. Callers should surface the `missing` count alongside the rank.
 */
export function computeRanking(
  vendors: CmpVendor[],
  totals: Map<string, VendorTotal>,
): Map<string, number> {
  const ranked = vendors
    .map(v => ({ id: v.id, total: totals.get(v.id)?.total ?? 0 }))
    .filter(r => r.total > 0)
    .sort((a, b) => a.total - b.total)
  const map = new Map<string, number>()
  ranked.forEach((r, i) => map.set(r.id, i + 1))
  return map
}
