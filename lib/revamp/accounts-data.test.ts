import { describe, it, expect } from 'vitest'
import { buildAccounts } from './accounts-data'
import type { OrdersTree, OrderRow, OrdersCatRow } from './orders-tree'

const EMPTY_LEDGER = { rows: [], totals: { paidOut: 0, paid: 0, tds: 0, retention: 0, advancePaid: 0, advanceRecovered: 0, billed: 0, outstanding: 0 } }

function order(o: Partial<OrderRow> & { id: string; ref: string; kind: 'wo' | 'po' }): OrderRow {
  return {
    party: null, in4Id: null, due: 0, ordered: 0, gross: 0, billed: 0, paid: 0, advanceOutstanding: 0, retention: 0, balance: 0,
    breakup: null, lines: [], lineTotal: 0, certifiedAmt: null, lineNote: null, flag: null, ledger: EMPTY_LEDGER, ledgerNote: null,
    ...o,
  }
}
function cat(name: string, orders: OrderRow[], kind: 'wo' | 'po' = 'wo'): OrdersCatRow {
  return {
    id: `cat:${name}`, name, code: '', count: orders.length, ordered: 0, gross: 0, billed: 0, paid: 0, advanceOutstanding: 0, retention: 0, balance: 0,
    subs: [{ id: `sub:${name}`, name: kind === 'po' ? 'Purchase orders' : 'Sub', code: '', kind, count: orders.length, orders, ordered: 0, gross: 0, billed: 0, paid: 0, advanceOutstanding: 0, retention: 0, balance: 0 }],
  }
}
function tree(cats: OrdersCatRow[]): OrdersTree {
  return { cats, totals: { ordered: 0, gross: 0, billed: 0, paid: 0, advanceOutstanding: 0, retention: 0, balance: 0, woCount: 0, poCount: 0, lineCount: 0 }, notes: [], in4: 'live', linked: true, error: null }
}

const WO_A = order({ id: 'wo:1', ref: 'WO/1', kind: 'wo', in4Id: 1, party: 'Alpha Builders', ordered: 100, gross: 118, billed: 59, paid: 40, due: 19, retention: 5, advanceOutstanding: 10 })
const WO_B = order({ id: 'wo:2', ref: 'WO/2', kind: 'wo', in4Id: 2, party: 'Alpha Builders', ordered: 50, gross: 59, billed: 0, paid: 0, due: 0, retention: 0, advanceOutstanding: 0 })
const PO_C = order({ id: 'po:c:PO/3', ref: 'PO/3', kind: 'po', in4Id: 3, party: 'Gamma Supplies', ordered: 200, gross: 236, billed: 100, paid: 100, due: 0, retention: 0, advanceOutstanding: 0, certifiedAmt: 236 })
const PO_D = order({ id: 'po:d:PO/4', ref: 'PO/4', kind: 'po', in4Id: 4, party: null, ordered: 10, gross: 11.8, billed: 11.8, paid: 0, due: 11.8, retention: 0, advanceOutstanding: 0, certifiedAmt: 11.8 })
const NO_HEADER = order({ id: 'wo:9', ref: 'WO/9', kind: 'wo', in4Id: 9, party: 'Zeta', ordered: 999, gross: null, billed: null, paid: null, advanceOutstanding: null, retention: null, balance: null, due: null })

describe('buildAccounts — the tree regrouped by what is owed', () => {
  const a = buildAccounts(tree([cat('Civil', [WO_A, WO_B, NO_HEADER]), cat('Civil PO', [PO_C, PO_D], 'po')]))

  it('totals are the sum of the orders the tree priced', () => {
    expect(a.totals).toEqual({ gross: 118 + 59 + 236 + 11.8, billed: 59 + 100 + 11.8, paid: 140, due: 30.8, retention: 5, advanceOutstanding: 10, orders: 4 })
    expect(a.withoutHeader).toBe(1)
  })

  it('lists what is due, largest first', () => {
    expect(a.due.map(o => o.ref)).toEqual(['WO/1', 'PO/4'])
  })

  it('finds the PO whose receipts exceed its bills', () => {
    expect(a.receivedNotBilled).toHaveLength(1)
    expect(a.receivedNotBilled[0].order.ref).toBe('PO/3')
    expect(a.receivedNotBilled[0].gap).toBe(136)
  })

  it('separates retention held from advances outstanding', () => {
    expect(a.retention.map(o => o.ref)).toEqual(['WO/1'])
    expect(a.advances.map(o => o.ref)).toEqual(['WO/1'])
  })

  it('groups by party, largest account first, and names the unnamed', () => {
    expect(a.parties.map(p => p.name)).toEqual(['Gamma Supplies', 'Alpha Builders', '(no party named in IN4)'])
    const alpha = a.parties[1]
    expect(alpha.kind).toBe('wo')
    expect(alpha.orders.map(o => o.ref)).toEqual(['WO/1', 'WO/2'])
    expect(alpha).toMatchObject({ gross: 177, billed: 59, paid: 40, due: 19, retention: 5, advanceOutstanding: 10 })
  })

  it('counts a PO listed under two categories ONCE', () => {
    const twice = buildAccounts(tree([cat('A', [PO_C], 'po'), cat('B', [{ ...PO_C, id: 'po:b:PO/3' }], 'po')]))
    expect(twice.totals.orders).toBe(1)
    expect(twice.totals.gross).toBe(236)
  })

  it('marks a party with both kinds of order as both', () => {
    const both = buildAccounts(tree([cat('A', [WO_A]), cat('B', [{ ...PO_C, party: 'Alpha Builders' }], 'po')]))
    expect(both.parties[0].kind).toBe('both')
  })
})
