import { describe, it, expect } from 'vitest'
import { bucketMovements, movementDetail, type RawMovement } from './daily-movement'

const base = {
  remarks: null, item_id: 'i1', warehouse_id: 'w1',
  item_code: 'C1', item_name: 'Cement', unit: 'bags', store_code: 'S1', store_name: 'Main', actor_name: 'Ravi',
}
const mv = (over: Partial<RawMovement>): RawMovement => ({
  movement_type: 'receipt', qty: 10, created_at: '2026-08-04T05:00:00.000Z', ...base, ...over,
})

describe('bucketMovements', () => {
  it('classifies entries and exits', () => {
    const r = bucketMovements([
      mv({ movement_type: 'receipt', qty: 100 }),
      mv({ movement_type: 'return_good', qty: 5 }),
      mv({ movement_type: 'issue', qty: 20 }),
      mv({ movement_type: 'damage', qty: 2 }),
    ])
    expect(r.kpi.entries).toBe(2)
    expect(r.kpi.exits).toBe(2)
    expect(r.entries.map(e => e.type)).toContain('Vendor receipt')
    expect(r.exits.map(e => e.type)).toContain('Issued to site')
  })

  it('pairs a transfer_out + transfer_in from the same transaction into one move', () => {
    const at = '2026-08-04T06:30:00.000Z'
    const r = bucketMovements([
      mv({ movement_type: 'transfer_out', qty: 8, created_at: at, warehouse_id: 'w1', store_name: 'Main' }),
      mv({ movement_type: 'transfer_in', qty: 8, created_at: at, warehouse_id: 'w2', store_name: 'Site B' }),
    ])
    expect(r.kpi.transfers).toBe(1)
    expect(r.transfers[0]).toMatchObject({ fromStore: 'Main', toStore: 'Site B', qty: 8 })
    // A paired transfer must NOT also land in entries/exits.
    expect(r.kpi.entries).toBe(0)
    expect(r.kpi.exits).toBe(0)
  })

  it('carries request context into exit lines and renders movementDetail', () => {
    const r = bucketMovements([
      mv({ movement_type: 'issue', qty: 5, project: 'AB — Admin Block', purpose: 'Xyz', requested_by: 'Ravi', reference: 'REQ-1', is_emergency: true }),
    ])
    const line = r.exits[0]
    expect(line.project).toBe('AB — Admin Block')
    expect(line.isEmergency).toBe(true)
    const d = movementDetail(line)
    expect(d).toContain('AB — Admin Block')
    expect(d).toContain('Xyz')
    expect(d).toContain('req by Ravi')
    expect(d).toContain('REQ-1')
  })

  it('movementDetail falls back to the remark when there is no request context', () => {
    const r = bucketMovements([mv({ movement_type: 'receipt', qty: 10, remarks: 'From ABC Traders' })])
    expect(movementDetail(r.entries[0])).toBe('From ABC Traders')
  })

  it('keeps adjustments separate and counts items/stores touched', () => {
    const r = bucketMovements([
      mv({ movement_type: 'adjustment', qty: 3, item_id: 'i2', warehouse_id: 'w2' }),
      mv({ movement_type: 'receipt', qty: 1, item_id: 'i1', warehouse_id: 'w1' }),
    ])
    expect(r.adjustments).toHaveLength(1)
    expect(r.kpi.itemsTouched).toBe(2)
    expect(r.kpi.storesTouched).toBe(2)
  })
})
