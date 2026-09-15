import { describe, it, expect } from 'vitest'
import { whoHoldsWhat, summarise, type PendingBill } from './holding'

const NOW = new Date('2026-09-15T00:00:00Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const bill = (o: Partial<PendingBill> = {}): PendingBill => ({
  id: 'b1', vendor: 'Amin Developers', billNo: 'SR-67', orderType: 'WO',
  projectLabel: 'NGH B', amount: 500_000, stage: 'site_head', stageSince: daysAgo(1),
  isExample: false, woPending: false, amendmentFlag: false, ...o,
})

const desk = (holders: string[], mine = false) => () => ({ holders, mine })

describe('who is holding which bill', () => {
  it('groups the bills by the desk that has them, and names the people', () => {
    const d = whoHoldsWhat(
      [bill(), bill({ id: 'b2', stage: 'ct_head' })],
      b => (b.stage === 'ct_head' ? { holders: ['Mayank'], mine: false } : { holders: ['Parimal'], mine: true }),
      NOW)
    expect(d.map(x => x.stage).sort()).toEqual(['ct_head', 'site_head'])
    expect(d.find(x => x.stage === 'site_head')!.holders).toEqual(['Parimal'])
    expect(d.find(x => x.stage === 'ct_head')!.holders).toEqual(['Mayank'])
  })

  // The whole point of the block: the desk to push is the one sitting longest.
  it('puts the desk that has been sitting longest first', () => {
    const d = whoHoldsWhat([
      bill({ id: 'new', stage: 'submitted', stageSince: daysAgo(1) }),
      bill({ id: 'old', stage: 'ct_head', stageSince: daysAgo(30) }),
      bill({ id: 'mid', stage: 'site_head', stageSince: daysAgo(9) }),
    ], desk(['Parimal']), NOW)
    expect(d.map(x => x.stage)).toEqual(['ct_head', 'site_head', 'submitted'])
    expect(d[0].oldestDays).toBe(30)
  })

  it('puts the oldest bill at the top of its own desk', () => {
    const d = whoHoldsWhat([
      bill({ id: 'a', stageSince: daysAgo(2) }),
      bill({ id: 'b', stageSince: daysAgo(11) }),
      bill({ id: 'c', stageSince: daysAgo(6) }),
    ], desk(['Parimal']), NOW)
    expect(d[0].bills.map(x => x.id)).toEqual(['b', 'c', 'a'])
  })

  // A bill nobody owns does not chase itself. It is the worst case in the flow
  // and must not look like an empty queue.
  it('calls out a desk with nobody on it', () => {
    const d = whoHoldsWhat([bill()], desk([]), NOW)
    expect(d[0].orphan).toBe(true)
    expect(d[0].holders).toEqual([])
    expect(summarise(d).orphaned).toBe(1)
  })

  it('marks the desks the person looking is actually on', () => {
    const d = whoHoldsWhat(
      [bill({ id: 'mine', stage: 'site_head' }), bill({ id: 'theirs', stage: 'ct_head' })],
      b => ({ holders: ['Parimal'], mine: b.stage === 'site_head' }), NOW)
    expect(d.find(x => x.stage === 'site_head')!.mine).toBe(true)
    expect(d.find(x => x.stage === 'ct_head')!.mine).toBe(false)
    expect(summarise(d).mine).toBe(1)
  })

  // Two bills at one stage can sit on different desks — different project,
  // different sub-project. The group names everybody, not just the first.
  it('names every desk behind one stage, not only the first bill it saw', () => {
    const d = whoHoldsWhat([
      bill({ id: 'a', projectLabel: 'NGH B' }),
      bill({ id: 'b', projectLabel: 'Raj Uphaar' }),
    ], b => ({ holders: b.projectLabel === 'NGH B' ? ['Parimal'] : ['Mayank'], mine: b.id === 'b' }), NOW)
    expect(d[0].holders.sort()).toEqual(['Mayank', 'Parimal'])
    expect(d[0].mine).toBe(true)
    expect(d[0].orphan).toBe(false)
  })

  it('leaves finished bills out — a queue of finished work is noise', () => {
    const d = whoHoldsWhat([
      bill({ id: 'paid', stage: 'paid' }),
      bill({ id: 'rejected', stage: 'rejected' }),
      bill({ id: 'live' }),
    ], desk(['Parimal']), NOW)
    expect(d).toHaveLength(1)
    expect(d[0].bills.map(b => b.id)).toEqual(['live'])
  })

  // Consistent with every other figure in the section: an example is shown,
  // badged, and counted nowhere.
  it('shows example bills but keeps them out of the money', () => {
    const d = whoHoldsWhat([
      bill({ id: 'real', amount: 100_000 }),
      bill({ id: 'demo', amount: 900_000, isExample: true }),
    ], desk(['Parimal']), NOW)
    expect(d[0].bills).toHaveLength(2)
    expect(d[0].value).toBe(100_000)
    expect(summarise(d).value).toBe(100_000)
    expect(summarise(d).bills).toBe(2)
  })

  it('ranks what is wrong with a bill, worst first', () => {
    const d = whoHoldsWhat([
      bill({ id: 'amend', amendmentFlag: true, woPending: true, stageSince: daysAgo(40) }),
      bill({ id: 'nowo', woPending: true, stageSince: daysAgo(40) }),
      bill({ id: 'late', stageSince: daysAgo(40) }),
      bill({ id: 'fine', stageSince: daysAgo(0) }),
    ], desk(['Parimal']), NOW)
    const byId = new Map(d[0].bills.map(b => [b.id, b.flag]))
    expect(byId.get('amend')).toBe('amendment')
    expect(byId.get('nowo')).toBe('no_wo')
    expect(byId.get('late')).toBe('late')
    expect(byId.get('fine')).toBeNull()
  })

  it('counts what is late at each desk and across all of them', () => {
    const d = whoHoldsWhat([
      bill({ id: 'a', stageSince: daysAgo(40) }),
      bill({ id: 'b', stageSince: daysAgo(40), stage: 'ct_head' }),
      bill({ id: 'c', stageSince: daysAgo(0) }),
    ], desk(['Parimal']), NOW)
    expect(summarise(d).late).toBe(2)
    expect(d.reduce((s, x) => s + x.lateCount, 0)).toBe(2)
  })

  it('is empty, and does not throw, when nothing is moving', () => {
    expect(whoHoldsWhat([], desk(['Parimal']), NOW)).toEqual([])
    expect(summarise([])).toEqual({ bills: 0, value: 0, late: 0, orphaned: 0, mine: 0 })
  })
})
