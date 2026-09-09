// Putting the WOs and POs that are still waiting in IN4 INTO the orders tree —
// under their own category and sub-category, as yellow rows — so the WO / PO
// tab keeps the Internal Estimate's one shape. Pure; tested.
//
// Aksha, 10 Sep 2026: "only WO and PO verified in IN4 to be reflected, and in
// Tree view as IE so the same format is followed … the pending yellow colour
// should come."

import type { OrdersCatRow, OrdersSubRow, OrdersTree, Money } from './orders-tree'
import type { PendingOrder } from './order-approvals'

export type PendingSubRow = OrdersSubRow & { pending: PendingOrder[] }
export type PendingCatRow = Omit<OrdersCatRow, 'subs'> & { subs: PendingSubRow[]; pendingCount: number }

const NO_MONEY: Money = { ordered: 0, gross: null, billed: null, paid: null, advanceOutstanding: null, retention: null, balance: null }

/** Each pending order under its category and sub-category; a category or sub-category IN4 has no approved order in yet is created for it. */
export function placePending(cats: readonly OrdersCatRow[], pending: readonly PendingOrder[]): PendingCatRow[] {
  const out: PendingCatRow[] = cats.map(c => ({ ...c, subs: c.subs.map(s => ({ ...s, pending: [] })), pendingCount: 0 }))
  for (const o of pending) {
    const ck = o.categoryId != null ? String(o.categoryId) : '_none'
    let cat = out.find(c => c.id === ck)
    if (!cat) {
      cat = { id: ck, name: o.category ?? 'No category in IN4', code: '', subs: [], count: 0, ...NO_MONEY, pendingCount: 0 }
      out.push(cat)
    }
    const sk = o.kind === 'wo' ? `${ck}::wo:${o.subcategoryId ?? '_nosub'}` : `${ck}::po`
    let sub = cat.subs.find(s => s.id === sk)
    if (!sub) {
      sub = {
        id: sk, name: o.kind === 'wo' ? (o.subcategory ?? 'No sub-category in IN4') : 'Purchase orders', code: '', kind: o.kind,
        count: 0, ...NO_MONEY, unassigned: o.kind === 'wo' && o.subcategoryId == null, orders: [], pending: [],
      }
      cat.subs.push(sub)
    }
    sub.pending.push(o)
    cat.pendingCount++
  }
  return out
}

function sumOrNull<T>(rows: readonly T[], pick: (r: T) => number | null): number | null {
  let any = false, s = 0
  for (const r of rows) { const v = pick(r); if (v != null) { any = true; s += v } }
  return any ? s : null
}
const roll = <T extends Money>(rows: readonly T[]): Money => ({
  ordered: rows.reduce((s, r) => s + r.ordered, 0),
  gross: sumOrNull(rows, r => r.gross), billed: sumOrNull(rows, r => r.billed), paid: sumOrNull(rows, r => r.paid),
  advanceOutstanding: sumOrNull(rows, r => r.advanceOutstanding), retention: sumOrNull(rows, r => r.retention), balance: sumOrNull(rows, r => r.balance),
})

/** The tree narrowed to work orders or purchase orders, re-summed. Without a kind, the tree as it is. */
export function filterByKind(tree: Pick<OrdersTree, 'cats' | 'totals'>, kind?: 'wo' | 'po'): Pick<OrdersTree, 'cats' | 'totals'> {
  if (!kind) return { cats: tree.cats, totals: tree.totals }
  const cats = tree.cats
    .map(c => { const subs = c.subs.filter(s => s.kind === kind); return { ...c, subs, count: subs.reduce((t, s) => t + s.count, 0), ...roll(subs) } })
    .filter(c => c.subs.length > 0)
  const orders = cats.flatMap(c => c.subs.flatMap(s => s.orders))
  return {
    cats,
    totals: { ...roll(cats), woCount: kind === 'wo' ? orders.length : 0, poCount: kind === 'po' ? orders.length : 0, lineCount: orders.reduce((t, o) => t + o.lines.length, 0) },
  }
}
