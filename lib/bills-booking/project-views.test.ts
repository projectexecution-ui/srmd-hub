import { describe, it, expect } from 'vitest'
import {
  buildProjectViews, shortSubName, stageLine, filterBills, sortMains, stageTotals, matchesProject,
  type ViewBill, type BuildInput,
} from './project-views'

const NOW = Date.parse('2026-10-12T12:00:00+05:30')
const bill = (o: Partial<ViewBill>): ViewBill => ({
  id: 'b', vendor: 'Desai Construction Pvt Ltd.', billNo: 'SRASSK-MS-WC-03', orderType: 'WO',
  orderNo: 'WO/SRASSK/WCE/2026-27/90', amount: 217608, stage: 'disc_head',
  stageSince: '2026-10-11T05:20:00Z', subprojectId: 97, hubProjectId: null,
  holders: ['Ambrishkumar Mistry'], mine: false, isExample: false, ...o,
})
const subs = new Map([
  [97, { id: 97, name: 'Welcome Centre Extension - Execution', projectId: 30 }],
  [5, { id: 5, name: 'Raj Uphaar - Execution', projectId: 7 }],
  [6, { id: 6, name: 'RU Infra Work', projectId: 7 }],
])
const mains = new Map([[30, { id: 30, name: 'Welcome Centre Extension' }], [7, { id: 7, name: 'Raj Uphaar' }]])
const base: Omit<BuildInput, 'bills'> = {
  subs, mains, hubProjects: new Map(), mySubs: new Set<number>(), myHubProjects: new Set<string>(), teams: new Map(), now: NOW,
  // Real IN4 position, 12 Oct 2026: Welcome Centre Extension - Execution.
  subPositions: new Map([[97, { orders: 6602257, woCount: 2, billed: 2108900, paid: 1983795 }]]),
  mainPositions: new Map([[30, { orders: 6602257, woCount: 2, billed: 2108900, paid: 1983795 }]]),
}

describe('the project-first Bills home', () => {
  it('puts Desai under its IN4 main project with the sub-project named in full, not "WCE"', () => {
    const [m] = buildProjectViews({ ...base, bills: [bill({})] })
    expect(m.name).toBe('Welcome Centre Extension')
    expect(m.subs[0].name).toBe('Execution')
    expect(m.subs[0].fullName).toBe('Welcome Centre Extension - Execution')
    expect(m.byStage.disc_head).toEqual({ n: 1, amount: 217608, late: 0 })
    expect(m.oldestDays).toBe(1)
  })

  it('carries the whole IN4 position of the project, not only what is pending', () => {
    const [m] = buildProjectViews({ ...base, bills: [bill({})] })
    expect(m.position).toEqual({ orders: 6602257, woCount: 2, billed: 2108900, paid: 1983795 })
    expect(m.subs[0].position?.billed).toBe(2108900)
  })

  it('flags a bill past its desk turnaround as late (Disc Head: 2 days)', () => {
    const [m] = buildProjectViews({ ...base, bills: [bill({ id: '1', stageSince: '2026-10-07T05:00:00Z' }), bill({ id: '2' })] })
    expect(m.late).toBe(1)
    expect(m.byStage.disc_head?.late).toBe(1)
    expect(m.subs[0].bills[0].tone).not.toBe('ok')
  })

  it('puts the viewer\'s own project first and counts what waits on them', () => {
    const ms = sortMains(buildProjectViews({ ...base, bills: [
      bill({ id: '1' }),
      bill({ id: '2', subprojectId: 5, mine: true, stage: 'ct_head' }),
      bill({ id: '3', subprojectId: 6 }),
    ] }), 'wait')
    expect(ms.map(m => m.name)).toEqual(['Raj Uphaar', 'Welcome Centre Extension'])
    expect(ms[0].mine).toBe(true)
    expect(ms[0].waitingOnMe).toBe(1)
    expect(ms[0].subs.map(s => s.name)).toEqual(['Execution', 'RU Infra Work'])
  })

  it('counts a named desk seat as "my project" even with nothing waiting', () => {
    const ms = sortMains(buildProjectViews({ ...base, mySubs: new Set([97]), bills: [bill({ id: '1' }), bill({ id: '2', subprojectId: 5 })] }), 'name')
    expect(ms[0].name).toBe('Welcome Centre Extension')
    expect(ms[0].mine).toBe(true)
  })

  it('sorts the rest by biggest money or by name when asked', () => {
    const ms = buildProjectViews({ ...base, bills: [bill({ id: '1', amount: 10 }), bill({ id: '2', subprojectId: 5, amount: 999 })] })
    expect(sortMains(ms, 'amount').map(m => m.name)).toEqual(['Raj Uphaar', 'Welcome Centre Extension'])
    expect(sortMains(ms, 'name').map(m => m.name)).toEqual(['Raj Uphaar', 'Welcome Centre Extension'])
  })

  it('filters by what waits on me, by step, by person and by search', () => {
    const bills = [
      bill({ id: '1', mine: true }),
      bill({ id: '2', stage: 'ct_head', holders: ['Kantilal K'] }),
      bill({ id: '3', vendor: 'Crony Electricals', billNo: '153' }),
    ]
    const ids = (f: Parameters<typeof filterBills>[1]) => filterBills(bills, f).map(b => b.id)
    expect(ids({ scope: 'mine', stage: null, who: null, q: null })).toEqual(['1'])
    expect(ids({ scope: 'all', stage: 'ct_head', who: null, q: null })).toEqual(['2'])
    expect(ids({ scope: 'all', stage: null, who: 'Kantilal K', q: null })).toEqual(['2'])
    expect(ids({ scope: 'all', stage: null, who: null, q: 'crony' })).toEqual(['3'])
  })

  it('lets a search match the project name too', () => {
    const [m] = buildProjectViews({ ...base, bills: [bill({})] })
    expect(matchesProject(m, 'welcome')).toBe(true)
    expect(matchesProject(m, 'raj')).toBe(false)
  })

  it('totals each step for the strip, late counted', () => {
    const t = stageTotals([bill({ id: '1' }), bill({ id: '2', stageSince: '2026-10-01T00:00:00Z' }), bill({ id: '3', stage: 'paid' })], NOW)
    expect(t.disc_head).toEqual({ n: 2, amount: 435216, late: 1 })
    expect(t.paid).toBeUndefined()
  })

  it('leaves out paid, rejected and example bills', () => {
    expect(buildProjectViews({ ...base, bills: [bill({ stage: 'paid' }), bill({ stage: 'rejected' }), bill({ isExample: true })] })).toEqual([])
  })

  it('falls back to the CT Hub project when IN4 has no sub-project', () => {
    const [m] = buildProjectViews({ ...base,
      hubProjects: new Map([['p1', { name: 'NGH C', parentName: 'New Guest House' }]]),
      bills: [bill({ subprojectId: null, hubProjectId: 'p1' })] })
    expect(m.name).toBe('New Guest House')
    expect(m.subs[0].name).toBe('NGH C')
  })

  it('reads the status columns as one line on a phone', () => {
    const [m] = buildProjectViews({ ...base, bills: [bill({ id: '1' }), bill({ id: '2' }), bill({ id: '3', stage: 'ct_head' })] })
    expect(stageLine(m.byStage, s => ({ disc_head: 'Disc Head', ct_head: 'CT Head' } as Record<string, string>)[s] ?? s))
      .toBe('Disc Head 2 · CT Head 1')
  })

  it('names a sub-project without repeating its project', () => {
    expect(shortSubName('New Guest House', 'New Guest House B-Execution')).toBe('B-Execution')
    expect(shortSubName('Raj Uphaar', 'RU Infra Work')).toBe('RU Infra Work')
  })
})
