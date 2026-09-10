import { describe, it, expect } from 'vitest'
import { placePending, filterByKind } from './orders-pending'
import type { OrdersCatRow, OrdersSubRow, OrderRow } from './orders-tree'
import type { PendingOrder } from './order-approvals'

const money = (ordered: number, paid: number | null = null) => ({ ordered, gross: ordered, billed: paid, paid, advanceOutstanding: null, retention: null, balance: paid == null ? null : ordered - paid })
const order = (id: string, kind: 'wo' | 'po', ordered: number): OrderRow => ({
  id, ref: id.toUpperCase(), party: 'X', kind, in4Id: 1, due: null, breakup: null, lines: [], lineTotal: ordered, certifiedAmt: null, lineNote: null, flag: null,
  ledger: { rows: [], totals: { billed: 0, paid: 0, retention: 0, outstanding: 0 } } as unknown as OrderRow['ledger'], ledgerNote: null, ...money(ordered, 0),
})
const sub = (id: string, kind: 'wo' | 'po', orders: OrderRow[]): OrdersSubRow => ({ id, name: id, code: '', kind, count: orders.length, orders, ...money(orders.reduce((t, o) => t + o.ordered, 0), 0) })
const cat = (id: string, subs: OrdersSubRow[]): OrdersCatRow => ({ id, name: `Cat ${id}`, code: '', subs, count: subs.reduce((t, s) => t + s.count, 0), ...money(subs.reduce((t, s) => t + s.ordered, 0), 0) })

const CATS: OrdersCatRow[] = [
  cat('1', [sub('1::wo:422', 'wo', [order('wo:1', 'wo', 100)]), sub('1::po', 'po', [order('po:1', 'po', 50)])]),
  cat('12', [sub('12::wo:900', 'wo', [order('wo:2', 'wo', 200)])]),
]
const pend = (o: Partial<PendingOrder> & { id: number; kind: 'wo' | 'po' }): PendingOrder => ({
  ref: `${o.kind.toUpperCase()}/${o.id}`, statusId: 113, status: 'Verify', stage: 'verify', date: null, party: 'P', projectId: 9, project: 'SRAH', subprojectId: 31, subproject: 'Exec',
  category: null, categoryId: null, subcategory: null, subcategoryId: null, description: null, value: 1000, raisedBy: null, since: null, chain: [], lines: [], refs: new Map(), turn: 'approver', ...o,
})

describe('placePending — pending orders go under their category and sub-category', () => {
  it('lands in an existing sub-category and counts on the category', () => {
    const out = placePending(CATS, [pend({ id: 5, kind: 'wo', categoryId: 1, subcategoryId: 422 })])
    expect(out[0].pendingCount).toBe(1)
    expect(out[0].subs[0].pending.map(p => p.ref)).toEqual(['WO/5'])
    expect(out[1].pendingCount).toBe(0)
    expect(CATS[0].subs[0]).not.toHaveProperty('pending') // the input is untouched
  })
  it('a PO goes to the category’s Purchase orders row, created if IN4 has none approved yet', () => {
    const out = placePending(CATS, [pend({ id: 7, kind: 'po', categoryId: 12, category: '12 Finishes' })])
    const c = out.find(x => x.id === '12')!
    expect(c.subs.map(s => s.id)).toEqual(['12::wo:900', '12::po'])
    expect(c.subs[1]).toMatchObject({ name: 'Purchase orders', kind: 'po', count: 0, gross: null })
    expect(c.subs[1].pending).toHaveLength(1)
  })
  it('a category with nothing approved yet is created, named from IN4', () => {
    const out = placePending(CATS, [pend({ id: 9, kind: 'wo', categoryId: 5, category: '05 Waterproofing Works', subcategoryId: null })])
    const c = out.find(x => x.id === '5')!
    expect(c).toMatchObject({ name: '05 Waterproofing Works', pendingCount: 1, ordered: 0, gross: null })
    expect(c.subs[0]).toMatchObject({ id: '5::wo:_nosub', name: 'No sub-category in IN4', unassigned: true })
  })
})

describe('filterByKind — the tree narrowed to WOs or POs, re-summed', () => {
  it('keeps everything without a kind', () => {
    expect(filterByKind({ cats: CATS, totals: { ...money(350, 0), woCount: 2, poCount: 1, lineCount: 0 } }).cats).toBe(CATS)
  })
  it('drops the other kind’s sub-categories and empty categories, and re-sums', () => {
    const po = filterByKind({ cats: CATS, totals: { ...money(350, 0), woCount: 2, poCount: 1, lineCount: 0 } }, 'po')
    expect(po.cats.map(c => c.id)).toEqual(['1'])
    expect(po.cats[0]).toMatchObject({ count: 1, ordered: 50, gross: 50 })
    expect(po.totals).toMatchObject({ ordered: 50, woCount: 0, poCount: 1 })
    const wo = filterByKind({ cats: CATS, totals: { ...money(350, 0), woCount: 2, poCount: 1, lineCount: 0 } }, 'wo')
    expect(wo.totals).toMatchObject({ ordered: 300, woCount: 2, poCount: 0 })
  })
})
