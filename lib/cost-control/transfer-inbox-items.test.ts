import { describe, it, expect } from 'vitest'
import { transferInboxItems, subPart } from './transfer-inbox-items'
import { inboxActionLabel } from '@/lib/approvals/inbox-action'

describe('transferInboxItems', () => {
  it('turns a transfer waiting on the Atm Head into a home row that opens My Approvals', () => {
    const [it] = transferInboxItems([{
      id: 't1', project_code: 'AB', project_name: 'Admin Block Full Building', stage: 'Atm Head', amount: 21500,
      from_label: '07 Electrical Works › 702 Electrical Conducting & Wiring Works', to_label: '08 Plumbing Works › 803 Sewage Line',
      raised_at: '2026-10-10T06:14:31Z', raised_by_name: 'Parimal Srmd',
    }], [])
    expect(it.module_slug).toBe('cost-control')
    expect(it.doc_url).toBe('/cost-control/approvals')
    expect(it.work_label).toBe('Budget shift: 702 Electrical Conducting & Wiring Works → 803 Sewage Line')
    expect(it.doc_no).toBe('Budget shift · Atm Head')
    expect(it.raised_by).toBe('Parimal Srmd')
    expect(inboxActionLabel(it.next_stage)).toBe('Approve shift')
  })

  it('gives Billing / the Coordinator only the ones still to move in IN4', () => {
    const items = transferInboxItems([], [
      { id: 'a', project_code: 'AB', project_name: 'AB', status: 'awaiting_in4', amount: 1000, from_label: 'x › 1', to_label: 'y › 2', approved_at: null },
      { id: 'b', project_code: 'AB', project_name: 'AB', status: 'awaiting_sync', amount: 2000, from_label: 'x › 1', to_label: 'y › 2', approved_at: null },
    ])
    expect(items.map(i => i.doc_id)).toEqual(['a'])
    expect(items[0].doc_url).toBe('/cost-control/billing')
    expect(inboxActionLabel(items[0].next_stage)).toBe('Move in IN4')
  })

  it('reads the sub-category out of a full line label', () => {
    expect(subPart('07 Electrical Works › 702 Wiring')).toBe('702 Wiring')
    expect(subPart('702 Wiring')).toBe('702 Wiring')
  })
})
