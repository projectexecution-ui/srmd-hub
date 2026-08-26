import { formatINR, formatNumber } from '@/lib/utils'

export { formatINR }

/** Quantity display for the warehouse.
 *
 *  Stock is numeric(14,3) so Postgres hands back "3686.000" and "12.000" —
 *  printing that raw gives "3686.000 Bag", which reads as false precision and
 *  is what a storekeeper notices first. This keeps Indian grouping, drops
 *  trailing zeros, and keeps real decimals (1.5 MT stays 1.5). */
export function formatQty(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const decimals = Number.isInteger(v) ? 0 : String(v).split('.')[1]?.replace(/0+$/, '').length || 0
  return formatNumber(v, Math.min(decimals, 3))
}

/** A whole-number count with Indian grouping — 2803 reads as "2,803".
 *  Counts of things, never quantities: use `formatQty` for those, which
 *  keeps real decimals. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

/** Quantity with its unit — "3,686 Bag", "1.5 MT". */
export function formatQtyUnit(n: number | string | null | undefined, unit?: string | null): string {
  const q = formatQty(n)
  return unit ? `${q} ${unit}` : q
}
