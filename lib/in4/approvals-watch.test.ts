import { describe, it, expect } from 'vitest'
import { planNotices, EMPTY_STATE, type PendingDoc, type GrnDoc } from './approvals-watch'

const NOW = '2026-09-09T04:00:00.000Z'
const IND: PendingDoc = { kind: 'indent', id: 1403, ref: 'IND/SRASSK/NGH/2026-27/151', statusId: 113, status: 'Verify', subprojectId: 12, projectId: 12, who: 'Kantilal Kheni', since: '2026-09-08T15:48:33.000Z', what: 'Fire Fighting Works · 4 items · NGH Wing-B GI pipes', value: null, context: 'for WO/NGH/ND/29' }
const PO: PendingDoc = { kind: 'po', id: 1269, ref: 'DRAFT-PO/SRET/RU/2025-26/1269', statusId: 113, status: 'Verify', subprojectId: 74, projectId: 8, who: 'Subhash Mahyavanshi', since: '2025-11-10T00:00:00.000Z', what: 'NATUROPROTECT', value: 63142, context: 'for IND/SRET/RU/2025-26/275' }
const SUBMITTED: PendingDoc = { ...IND, id: 1, ref: 'IND/X', statusId: 1, status: 'Submitted' }
const GRN: GrnDoc = { grnId: 1336, grnNo: 'GRN/SRASSK/NGH/2026-27/1', date: '2026-09-08T00:00:00.000Z', subprojectId: 12, projectId: 12, poNo: 'PO/SRASSK/NGH/2025-26/93', supplier: 'NATUROPROTECT', qty: 70, value: 1094.45, materials: 'Pidilite - Roff (T02) Grey' }

describe('planNotices — tell once, tell the right thing', () => {
  it('announces an indent and a PO at Verify, in words the Atm Head can act on', () => {
    const { notices } = planNotices(EMPTY_STATE, [IND, PO], [], NOW)
    expect(notices.map(x => x.type)).toEqual(['in4_indent_verify', 'in4_po_verify'])
    expect(notices[0].title).toBe('Indent IND/SRASSK/NGH/2026-27/151 is waiting for your approval in IN4')
    expect(notices[0].body).toContain('raised by Kantilal Kheni')
    expect(notices[0].body).toContain('Open IN4 to approve it.')
    expect(notices[1].body).toContain('₹63,142')
  })

  it('does NOT announce Submitted — only Verify is the Atm Head’s turn', () => {
    const { notices } = planNotices(EMPTY_STATE, [SUBMITTED], [], NOW)
    expect(notices).toHaveLength(0)
  })

  it('is silent on the next run when nothing changed', () => {
    const first = planNotices(EMPTY_STATE, [IND, PO], [], NOW)
    const second = planNotices(first.next, [IND, PO], [], NOW)
    expect(second.notices).toHaveLength(0)
  })

  it('announces again when a document comes back to Verify after a ReSubmit', () => {
    const first = planNotices(EMPTY_STATE, [IND], [], NOW)
    const back = planNotices(first.next, [{ ...IND, statusId: 60, status: 'ReSubmit' }], [], NOW)
    expect(back.notices).toHaveLength(0)
    const again = planNotices(back.next, [IND], [], NOW)
    expect(again.notices).toHaveLength(1)
  })

  it('forgets a document once it leaves the pending list, so a later Verify is fresh', () => {
    const first = planNotices(EMPTY_STATE, [IND], [], NOW)
    expect(first.next.indents['1403']).toBe(113)
    const gone = planNotices(first.next, [], [], NOW)
    expect(gone.next.indents['1403']).toBeUndefined()
  })

  it('sets the GRN watermark on the first run and announces nothing old', () => {
    const { notices, next } = planNotices(EMPTY_STATE, [], [GRN], NOW)
    expect(notices).toHaveLength(0)
    expect(next.grnSince).toBe('2026-09-09')
  })

  it('announces a receipt once, keeps a week of memory, and drops it after', () => {
    const state = { ...EMPTY_STATE, grnSince: '2026-09-08' }
    const a = planNotices(state, [], [GRN], NOW)
    expect(a.notices).toHaveLength(1)
    expect(a.notices[0].title).toBe('Material received against PO/SRASSK/NGH/2025-26/93')
    expect(a.notices[0].body).toContain('70 units')
    const b = planNotices(a.next, [], [GRN], NOW)
    expect(b.notices).toHaveLength(0)
    const later = planNotices(b.next, [], [GRN], '2026-09-20T04:00:00.000Z')
    expect(later.notices).toHaveLength(0)
    expect(later.next.grns['1336']).toBeUndefined()
  })
})
