// The Accounts tab's figures — a REGROUPING of the WO/PO tree, nothing more.
//
// Aksha's accounts questions are not category questions: who is waiting to be
// paid, which deliveries have no bill yet, how much is held back, what each
// party's account looks like. Every number here is an order row the tree
// already computed (IN4 header + certificates placed by GRN), read once and
// regrouped, so the tab can never quote money the tree does not. Pure, so the
// grouping is tested without a database.

import type { OrdersTree, OrderRow } from './orders-tree'

export interface AccountsOrder {
  id: string
  ref: string
  kind: 'wo' | 'po'
  in4Id: number | null
  party: string | null
  category: string
  /** The full order, with GST (and freight for a PO). */
  gross: number
  billed: number
  paid: number
  /** Certified, not yet paid. */
  due: number
  retention: number
  advanceOutstanding: number
  /** Landed value received against a PO (its GRNs); null for a WO or when
   *  nothing has been received. */
  received: number | null
  flag: string | null
}

export interface PartyAccount {
  name: string
  kind: 'wo' | 'po' | 'both'
  orders: AccountsOrder[]
  gross: number; billed: number; paid: number; due: number; retention: number; advanceOutstanding: number
}

export interface Accounts {
  totals: { gross: number; billed: number; paid: number; due: number; retention: number; advanceOutstanding: number; orders: number }
  /** Orders with a certified, unpaid amount — largest first. */
  due: AccountsOrder[]
  /** POs whose receipts (landed) exceed what has been billed — largest gap first. */
  receivedNotBilled: Array<{ order: AccountsOrder; gap: number }>
  /** Orders with retention held — largest first. */
  retention: AccountsOrder[]
  /** Orders with an advance still to be recovered — largest first. */
  advances: AccountsOrder[]
  /** Every party with their orders, largest account first. */
  parties: PartyAccount[]
  /** Orders IN4 returned no header for — their money is blank in the tree
   *  and left out here, and the count says so. */
  withoutHeader: number
  in4: OrdersTree['in4']
}

const NO_PARTY = '(no party named in IN4)'

/** Flatten the tree's orders. A PO whose lines sit in two categories appears
 *  under both in the tree with the same header money; here it is one order. */
function flatten(tree: OrdersTree): { orders: AccountsOrder[]; withoutHeader: number } {
  const seen = new Set<string>()
  const orders: AccountsOrder[] = []
  let withoutHeader = 0
  for (const cat of tree.cats) {
    for (const sub of cat.subs) {
      for (const o of sub.orders) {
        const key = `${o.kind}:${o.in4Id ?? o.ref}`
        if (seen.has(key)) continue
        seen.add(key)
        if (o.gross == null || o.paid == null) { withoutHeader++; continue }
        orders.push(toAccountsOrder(o, cat.name))
      }
    }
  }
  return { orders, withoutHeader }
}

function toAccountsOrder(o: OrderRow, category: string): AccountsOrder {
  return {
    id: o.id, ref: o.ref, kind: o.kind, in4Id: o.in4Id, party: o.party, category,
    gross: o.gross ?? o.ordered,
    billed: o.billed ?? 0,
    paid: o.paid ?? 0,
    due: o.due ?? 0,
    retention: o.retention ?? 0,
    advanceOutstanding: o.advanceOutstanding ?? 0,
    received: o.kind === 'po' ? o.certifiedAmt : null,
    flag: o.flag,
  }
}

const desc = (pick: (o: AccountsOrder) => number) => (a: AccountsOrder, b: AccountsOrder) => pick(b) - pick(a)

export function buildAccounts(tree: OrdersTree): Accounts {
  const { orders, withoutHeader } = flatten(tree)

  const totals = orders.reduce((t, o) => ({
    gross: t.gross + o.gross, billed: t.billed + o.billed, paid: t.paid + o.paid, due: t.due + o.due,
    retention: t.retention + o.retention, advanceOutstanding: t.advanceOutstanding + o.advanceOutstanding, orders: t.orders + 1,
  }), { gross: 0, billed: 0, paid: 0, due: 0, retention: 0, advanceOutstanding: 0, orders: 0 })

  const due = orders.filter(o => o.due > 0.5).sort(desc(o => o.due))
  const receivedNotBilled = orders
    .filter(o => o.kind === 'po' && o.received != null && o.received - o.billed > 1)
    .map(order => ({ order, gap: order.received! - order.billed }))
    .sort((a, b) => b.gap - a.gap)
  const retention = orders.filter(o => o.retention > 0.5).sort(desc(o => o.retention))
  const advances = orders.filter(o => o.advanceOutstanding > 0.5).sort(desc(o => o.advanceOutstanding))

  const byParty = new Map<string, PartyAccount>()
  for (const o of orders) {
    const name = o.party?.trim() || NO_PARTY
    const p = byParty.get(name) ?? { name, kind: o.kind, orders: [], gross: 0, billed: 0, paid: 0, due: 0, retention: 0, advanceOutstanding: 0 }
    if (p.kind !== o.kind) p.kind = 'both'
    p.orders.push(o)
    p.gross += o.gross; p.billed += o.billed; p.paid += o.paid; p.due += o.due
    p.retention += o.retention; p.advanceOutstanding += o.advanceOutstanding
    byParty.set(name, p)
  }
  const parties = [...byParty.values()].sort((a, b) => b.gross - a.gross)
  for (const p of parties) p.orders.sort(desc(o => o.gross))

  return { totals, due, receivedNotBilled, retention, advances, parties, withoutHeader, in4: tree.in4 }
}
