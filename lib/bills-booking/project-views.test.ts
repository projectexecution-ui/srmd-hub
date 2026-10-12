import { describe, it, expect } from 'vitest'
import { buildProjectViews, shortSubName, stageLine, type ViewBill } from './project-views'

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
const base = { subs, mains, hubProjects: new Map(), mySubs: new Set<number>(), myHubProjects: new Set<string>(), teams: new Map(), now: NOW }

describe('the project-first Bills home', () => {
  it('puts Desai under its IN4 main project with the sub-project named in full, not "WCE"', () => {
    const [m] = buildProjectViews({ ...base, bills: [bill({})] })
    expect(m.name).toBe('Welcome Centre Extension')
    expect(m.subs[0].name).toBe('Execution')
    expect(m.subs[0].fullName).toBe('Welcome Centre Extension - Execution')
    expect(m.byStage.disc_head).toEqual({ n: 1, amount: 217608 })
    expect(m.oldestDays).toBe(1)
  })

  it('puts the viewer\'s own project first and counts what waits on them', () => {
    const ms = buildProjectViews({ ...base, bills: [
      bill({ id: '1' }),
      bill({ id: '2', subprojectId: 5, mine: true, stage: 'ct_head' }),
      bill({ id: '3', subprojectId: 6 }),
    ] })
    expect(ms.map(m => m.name)).toEqual(['Raj Uphaar', 'Welcome Centre Extension'])
    expect(ms[0].mine).toBe(true)
    expect(ms[0].waitingOnMe).toBe(1)
    expect(ms[0].subs.map(s => s.name)).toEqual(['Execution', 'RU Infra Work'])
  })

  it('counts a named desk seat as "my project" even with nothing waiting', () => {
    const ms = buildProjectViews({ ...base, mySubs: new Set([97]), bills: [bill({ id: '1' }), bill({ id: '2', subprojectId: 5 })] })
    expect(ms[0].name).toBe('Welcome Centre Extension')
    expect(ms[0].mine).toBe(true)
  })

  it('leaves out paid, rejected and example bills', () => {
    const ms = buildProjectViews({ ...base, bills: [bill({ stage: 'paid' }), bill({ stage: 'rejected' }), bill({ isExample: true })] })
    expect(ms).toEqual([])
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
