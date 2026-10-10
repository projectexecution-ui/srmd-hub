import { describe, it, expect } from 'vitest'
import { buildTransferTracker, waitedLabel, type TrackerInput, type TrackerTransfer } from './transfer-tracker'

// The real request of 10 Oct 2026: Parimal raised ₹21,500 on AB at 11:44 IST,
// 702 Wiring → 803 Sewage Line. Since the CT Head step (same day) it waits
// first on Mayank Adhvaryoo (AB's named Project Head = CT Head), then Amit Gala.
const T0 = Date.parse('2026-10-10T06:14:31Z')
const base: TrackerTransfer = {
  id: 't1', project_id: 'pAB', status: 'pending_ph', amount: 21500, reason: 'Sewage line short',
  from_discipline_id: 'd07', from_sub_skill_id: 's702', to_discipline_id: 'd08', to_sub_skill_id: 's803',
  raised_by: 'parimal', raised_at: new Date(T0).toISOString(), atm_by: null, atm_at: null,
  trustee_by: null, trustee_at: null, in4_at: null, settle_note: null,
}
const people = [
  { id: 'parimal', name: 'Parimal Srmd', role: 'coordinator', active: true },
  { id: 'mayank', name: 'Mayank Adhvaryoo', role: 'project_head', active: true },
  { id: 'amit', name: 'Amit Gala', role: 'head', active: true },
  { id: 'akshay', name: 'Akshay Atmarpit', role: 'head', active: true },
  { id: 'chirag', name: 'Chirag Shah', role: 'founder', active: true },
  { id: 'aksha', name: 'Project Execution', role: 'admin', active: true },
]
const input = (over: Partial<TrackerInput> = {}): TrackerInput => ({
  transfers: [base],
  projects: [{ id: 'pAB', code: 'AB', name: 'Admin Block Full Building' }, { id: 'pNGH', code: 'NGH C', name: 'NGH C' }],
  approvers: [{ project_id: 'pAB', user_id: 'mayank', role: 'project_head' }, { project_id: 'pAB', user_id: 'amit', role: 'head' }, { project_id: 'pNGH', user_id: 'akshay', role: 'head' }],
  people,
  disciplines: [{ id: 'd07', code: '07', name: 'Electrical Works' }, { id: 'd08', code: '08', name: 'Plumbing Works' }],
  subSkills: [{ id: 's702', code: '702', name: 'Electrical Conducting & Wiring Works' }, { id: 's803', code: '803', name: 'Sewage Line' }],
  viewer: { id: 'parimal', role: 'coordinator', isAdmin: false },
  myApprovalIds: new Set(),
  now: T0 + 3 * 3_600_000,
  ...over,
})

describe('buildTransferTracker', () => {
  it('shows Parimal his own request: step 1 of 5, with the CT Head Mayank, 3 h', () => {
    const [r] = buildTransferTracker(input())
    expect(r.projectLabel).toBe('AB · Admin Block Full Building')
    expect(r.step).toBe(1)
    expect(r.stage).toBe('CT Head')
    expect(r.withWhom).toBe('Mayank Adhvaryoo')
    expect(waitedLabel(r)).toBe('3 h')
    expect(r.stuck).toBe(false)
    expect(r.raisedBy).toBe('Parimal Srmd')
    expect(r.fromLabel).toBe('07 Electrical Works › 702 Electrical Conducting & Wiring Works')
    expect(r.toLabel).toBe('08 Plumbing Works › 803 Sewage Line')
    expect(r.next).toEqual(['Atm Head', 'Trustee', 'shift in IN4', 'IN4 sync check'])
    expect(r.mine).toBe(false)
  })

  it('after the CT Head signs: step 2, with Amit Gala, counted from the CT Head sign-off', () => {
    const atAtm: TrackerTransfer = { ...base, status: 'pending_atm', ph_by: 'mayank', ph_at: new Date(T0 + 3_600_000).toISOString() }
    const [r] = buildTransferTracker(input({ transfers: [atAtm] }))
    expect(r.step).toBe(2)
    expect(r.stage).toBe('Atm Head')
    expect(r.withWhom).toBe('Amit Gala')
    expect(r.since).toBe(atAtm.ph_at)
    expect(waitedLabel(r)).toBe('2 h')
  })

  it('names every Project Head when the project has no named CT Head', () => {
    const noPh: TrackerTransfer = { ...base, project_id: 'pNGH' }
    const [r] = buildTransferTracker(input({ transfers: [noPh] }))
    expect(r.withWhom).toBe('Mayank Adhvaryoo')
  })

  it('marks it the Atm Head\'s own when he may approve it, and points him to the buttons', () => {
    const [r] = buildTransferTracker(input({ transfers: [{ ...base, status: 'pending_atm' }], viewer: { id: 'amit', role: 'head', isAdmin: false }, myApprovalIds: new Set(['t1']) }))
    expect(r.mine).toBe(true)
    expect(r.actionHref).toBe('/cost-control/approvals')
  })

  it('shows an Atm Head only his projects (and ones with no named Atm Head)', () => {
    const other: TrackerTransfer = { ...base, id: 't2', project_id: 'pNGH' }
    const noHead: TrackerTransfer = { ...base, id: 't3', project_id: 'pX' }
    const rows = buildTransferTracker(input({ transfers: [base, other, noHead], viewer: { id: 'amit', role: 'head', isAdmin: false } }))
    expect(rows.map(r => r.id).sort()).toEqual(['t1', 't3'])
  })

  it('keeps following a request an Atm Head signed, after it moves on', () => {
    const signed: TrackerTransfer = { ...base, project_id: 'pNGH', status: 'pending_trustee', atm_by: 'amit', atm_at: new Date(T0 + 3_600_000).toISOString() }
    const [r] = buildTransferTracker(input({ transfers: [signed], viewer: { id: 'amit', role: 'head', isAdmin: false } }))
    expect(r.stage).toBe('Trustee')
    expect(r.withWhom).toBe('Chirag Shah')
    expect(r.since).toBe(signed.atm_at)
  })

  it('names Billing / the Coordinator for the IN4 step and makes it Parimal\'s to do', () => {
    const atIn4: TrackerTransfer = { ...base, status: 'awaiting_in4', trustee_at: new Date(T0).toISOString() }
    const [r] = buildTransferTracker(input({ transfers: [atIn4], now: T0 + 3 * 86_400_000 }))
    expect(r.stage).toBe('Shift in IN4')
    expect(r.step).toBe(4)
    expect(r.withWhom).toBe('Parimal Srmd')
    expect(r.mine).toBe(true)
    expect(r.actionHref).toBe('/cost-control/billing')
    expect(r.stuck).toBe(true)
    expect(waitedLabel(r)).toBe('3 days')
  })

  it('carries the sync\'s note when IN4 moved a different figure', () => {
    const atSync: TrackerTransfer = { ...base, status: 'awaiting_sync', in4_at: new Date(T0).toISOString(), settle_note: 'IN4 moved ₹20,000, not ₹21,500' }
    const [r] = buildTransferTracker(input({ transfers: [atSync] }))
    expect(r.withWhom).toBe('the next IN4 sync')
    expect(r.settleNote).toBe('IN4 moved ₹20,000, not ₹21,500')
    expect(r.next).toEqual([])
  })

  it('shows nothing to an engineer or the Trustee, and nothing closed', () => {
    expect(buildTransferTracker(input({ viewer: { id: 'x', role: 'engineer', isAdmin: false } }))).toEqual([])
    expect(buildTransferTracker(input({ viewer: { id: 'chirag', role: 'founder', isAdmin: false } }))).toEqual([])
    expect(buildTransferTracker(input({ transfers: [{ ...base, status: 'confirmed' }] }))).toEqual([])
  })

  it('shows an admin everything', () => {
    const other: TrackerTransfer = { ...base, id: 't2', project_id: 'pNGH' }
    expect(buildTransferTracker(input({ transfers: [base, other], viewer: { id: 'aksha', role: 'admin', isAdmin: true } }))).toHaveLength(2)
  })

  it('puts the longest-waiting first', () => {
    const older: TrackerTransfer = { ...base, id: 'old', raised_at: new Date(T0 - 86_400_000).toISOString() }
    const rows = buildTransferTracker(input({ transfers: [base, older] }))
    expect(rows.map(r => r.id)).toEqual(['old', 't1'])
  })
})
