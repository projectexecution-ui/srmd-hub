import { describe, expect, it } from 'vitest'
import { bucketOf, dayTotals, flows, flowSummary, sections, KIND_LABEL } from './daily'
import type { DayMovement } from './daily'
import type { MovementKind } from './ledger'

const mv = (o: Partial<DayMovement> & { kind: MovementKind }): DayMovement => ({
  id: Math.random().toString(36).slice(2), qty: 10,
  itemId: 'cement', itemName: 'OPC 53 Cement', itemCode: 'CEM-53', unit: 'Bag',
  category: 'Civil', storeId: 'A', storeName: 'Yunus', siteName: 'Yunus Land',
  actor: 'projectexecution', time: '18:47', remarks: null,
  entryNo: 'Out: 16Aug26/001', counterparty: 'AB — Admin Block', projectName: 'AB — Admin Block',
  ...o,
})

describe('which side of the gate a movement sits on', () => {
  it('reads receipts and returns as entries', () => {
    expect(bucketOf('in')).toBe('entry')
    expect(bucketOf('return')).toBe('entry')
  })
  it('reads issues and vendor take-backs as exits', () => {
    expect(bucketOf('issue')).toBe('exit')
    expect(bucketOf('vendor_out')).toBe('exit')
  })
  it('keeps a yard move out of both', () => {
    expect(bucketOf('move_in')).toBe('transfer')
    expect(bucketOf('move_out')).toBe('transfer')
  })
  it('puts counts, voids and damage together as corrections', () => {
    expect(bucketOf('adjust')).toBe('correction')
    expect(bucketOf('void')).toBe('correction')
    expect(bucketOf('damage')).toBe('correction')
  })
  it('names every kind in words a storekeeper uses', () => {
    for (const k of Object.keys(KIND_LABEL) as MovementKind[]) {
      expect(KIND_LABEL[k]).not.toMatch(/_/)
      expect(KIND_LABEL[k].length).toBeGreaterThan(3)
    }
  })
})

describe('the day’s counters', () => {
  it('counts a store move ONCE, not as an exit and an entry', () => {
    // Both halves are in the ledger. Counting both would make a quiet day of
    // shuffling material across the yard look like a busy one.
    const t = dayTotals([
      mv({ kind: 'move_out', storeName: 'Yunus' }),
      mv({ kind: 'move_in', storeName: 'NGH' }),
    ])
    expect(t.transfers).toBe(1)
    expect(t.entries).toBe(0)
    expect(t.exits).toBe(0)
  })

  it('counts distinct items touched, not rows', () => {
    const t = dayTotals([
      mv({ kind: 'issue', itemId: 'cement' }),
      mv({ kind: 'issue', itemId: 'cement' }),
      mv({ kind: 'in', itemId: 'wire' }),
    ])
    expect(t.itemsTouched).toBe(2)
    expect(t.exits).toBe(2)
    expect(t.entries).toBe(1)
  })

  it('is all zeroes on a day nothing happened', () => {
    expect(dayTotals([])).toEqual({
      entries: 0, exits: 0, transfers: 0, corrections: 0, itemsTouched: 0,
    })
  })
})

describe('where material went', () => {
  it('groups by store → destination and counts lines and items', () => {
    const f = flows([
      mv({ kind: 'issue', storeName: 'Yunus', counterparty: 'AB — Admin Block', itemId: 'a' }),
      mv({ kind: 'issue', storeName: 'Yunus', counterparty: 'AB — Admin Block', itemId: 'b' }),
      mv({ kind: 'issue', storeName: 'Yunus', counterparty: 'NGH B', itemId: 'a' }),
    ])
    expect(f).toHaveLength(2)
    expect(f[0]).toMatchObject({ from: 'Yunus', to: 'AB — Admin Block', lines: 2, items: 2 })
    expect(f[1]).toMatchObject({ to: 'NGH B', lines: 1, items: 1 })
  })

  it('ignores receipts — "it went into the store it went into" tells nobody anything', () => {
    expect(flows([mv({ kind: 'in' })])).toHaveLength(0)
  })

  it('shows the giving side of a yard move, not both', () => {
    const f = flows([
      mv({ kind: 'move_out', storeName: 'Yunus', counterparty: 'NGH Open Area' }),
      mv({ kind: 'move_in', storeName: 'NGH Open Area', counterparty: 'NGH Open Area' }),
    ])
    expect(f).toHaveLength(1)
    expect(f[0].from).toBe('Yunus')
  })

  it('summarises in one line, and says so plainly when nothing left', () => {
    const f = flows([
      mv({ kind: 'issue', storeName: 'Yunus', counterparty: 'AB' }),
      mv({ kind: 'issue', storeName: 'Yunus', counterparty: 'NGH B' }),
    ])
    expect(flowSummary(f)).toBe('2 destinations · from 1 store')
    expect(flowSummary([])).toContain('nothing left')
  })
})

describe('the tables under the card', () => {
  it('drops empty buckets instead of showing a heading with nothing under it', () => {
    const s = sections([mv({ kind: 'issue' })])
    expect(s).toHaveLength(1)
    expect(s[0].bucket).toBe('exit')
  })

  it('puts exits first — the day is read as "what did we give out"', () => {
    const s = sections([mv({ kind: 'in' }), mv({ kind: 'issue' }), mv({ kind: 'adjust' })])
    expect(s.map(x => x.bucket)).toEqual(['exit', 'entry', 'correction'])
  })

  it('sorts newest first inside a bucket', () => {
    const s = sections([
      mv({ kind: 'issue', time: '09:15' }),
      mv({ kind: 'issue', time: '21:49' }),
    ])
    expect(s[0].rows.map(r => r.time)).toEqual(['21:49', '09:15'])
  })
})
