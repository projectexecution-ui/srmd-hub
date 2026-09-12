import { describe, it, expect } from 'vitest'
import {
  KINDS, KIND_BY_KEY, applyFilter, coverageGaps, daysBetween, daysOverdue, daysWaiting,
  defaultAssignee, defaultDueDate, isFlagged, sortRegister, summarise, summariseDecisions,
  type DecisionCategory, type DecisionRow, type RegisterRow, type Stakeholder,
} from './types'

const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  id: over.id ?? 'r1',
  ref: 'SRAH/RFI/001',
  kind: 'rfi',
  title: 'A query',
  status: 'open',
  priority: 'normal',
  projectId: 'p1',
  projectName: 'SRAH',
  categoryName: 'Civil',
  subCategoryName: 'Concrete Work',
  disciplineName: null,
  location: null,
  assignedToId: 'u1',
  assignedToName: 'Ambrish',
  assignedAt: '2026-09-10T04:00:00Z',
  dueOn: '2026-09-20',
  costImpact: null,
  raisedById: 'u2',
  raisedByName: 'Akshay',
  createdAt: '2026-09-10T04:00:00Z',
  lastActivityAt: '2026-09-10T04:00:00Z',
  posts: 1,
  escalated: false,
  ...over,
})

describe('the six kinds', () => {
  it('gives every kind a distinct reference prefix', () => {
    const codes = KINDS.map(k => k.code)
    expect(new Set(codes).size).toBe(KINDS.length)
  })

  it('lets an instruction and a non-conformance come back sooner than a query', () => {
    expect(KIND_BY_KEY.instruction.defaultDays).toBeLessThan(KIND_BY_KEY.rfi.defaultDays)
    expect(KIND_BY_KEY.ncr.defaultDays).toBeLessThan(KIND_BY_KEY.rfi.defaultDays)
  })
})

describe('dates', () => {
  it('counts days between two dates', () => {
    expect(daysBetween('2026-09-01', '2026-09-12')).toBe(11)
    expect(daysBetween('2026-09-12', '2026-09-01')).toBe(-11)
  })

  it('reports overdue only once the date has passed', () => {
    expect(daysOverdue('2026-09-20', '2026-09-12')).toBe(0)
    expect(daysOverdue('2026-09-12', '2026-09-12')).toBe(0)
    expect(daysOverdue('2026-09-06', '2026-09-12')).toBe(6)
    expect(daysOverdue(null, '2026-09-12')).toBe(0)
  })

  it('measures how long an entry has sat with someone', () => {
    const assigned = '2026-09-10T04:00:00Z'
    const now = Date.parse('2026-09-12T05:00:00Z')
    expect(daysWaiting(assigned, now)).toBe(2)
    expect(daysWaiting(null, now)).toBe(0)
  })

  // Saturday is a working day on these sites; Sunday is not. A Friday issue
  // must not fall due on a Sunday nobody reads.
  it('skips Sundays when working out the response date', () => {
    // 2026-09-11 is a Friday. Three working days → Sat 12, Mon 14, Tue 15.
    expect(defaultDueDate('issue', '2026-09-11')).toBe('2026-09-15')
    // An instruction is one working day: Friday → Saturday.
    expect(defaultDueDate('instruction', '2026-09-11')).toBe('2026-09-12')
    // Saturday + 1 working day skips Sunday entirely.
    expect(defaultDueDate('instruction', '2026-09-12')).toBe('2026-09-14')
  })
})

describe('reading the register', () => {
  const today = '2026-09-12'
  const rows = [
    row({ id: 'a', assignedToId: 'me', dueOn: '2026-09-20' }),
    row({ id: 'b', assignedToId: 'other', dueOn: '2026-09-06' }),               // overdue
    row({ id: 'c', assignedToId: 'me', status: 'closed', dueOn: '2026-09-01' }),
    row({ id: 'd', assignedToId: 'other', costImpact: 950_000 }),
  ]

  it('"Assigned to me" is open entries in my name, never closed ones', () => {
    const mine = applyFilter(rows, 'mine', 'all', 'me', today).map(r => r.id)
    expect(mine).toEqual(['a'])
  })

  it('"Overdue" ignores anything already closed', () => {
    expect(applyFilter(rows, 'overdue', 'all', 'me', today).map(r => r.id)).toEqual(['b'])
  })

  it('"Cost impact" picks only entries carrying a figure', () => {
    expect(applyFilter(rows, 'cost', 'all', 'me', today).map(r => r.id)).toEqual(['d'])
  })

  it('filters by kind on top of the state filter', () => {
    const mixed = [...rows, row({ id: 'e', kind: 'ncr', assignedToId: 'me' })]
    expect(applyFilter(mixed, 'mine', 'ncr', 'me', today).map(r => r.id)).toEqual(['e'])
  })

  it('puts overdue first, then the most urgent, then the stalest', () => {
    const list = [
      row({ id: 'normal', dueOn: '2026-09-30', lastActivityAt: '2026-09-11T00:00:00Z' }),
      row({ id: 'critical', priority: 'critical', dueOn: '2026-09-30', lastActivityAt: '2026-09-11T00:00:00Z' }),
      row({ id: 'overdue', dueOn: '2026-09-01', lastActivityAt: '2026-09-11T00:00:00Z' }),
      row({ id: 'stale', dueOn: '2026-09-30', lastActivityAt: '2026-08-01T00:00:00Z' }),
    ]
    expect(sortRegister(list, today).map(r => r.id)).toEqual(['overdue', 'critical', 'stale', 'normal'])
  })

  it('counts what is mine, what is late and what carries money', () => {
    const s = summarise(rows, 'me', [2, 4], today)
    expect(s.mine).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.live).toBe(3)
    expect(s.costTotal).toBe(950_000)
    expect(s.costCount).toBe(1)
    expect(s.avgDaysToClose).toBe(3)
  })

  it('reports no average until something has actually been closed', () => {
    expect(summarise(rows, 'me', [], today).avgDaysToClose).toBeNull()
  })
})

describe('stakeholders decide where an entry goes', () => {
  const person = (over: Partial<Stakeholder>): Stakeholder => ({
    id: 's1', projectId: 'p1', disciplineId: 'd-arch', disciplineName: 'Architecture',
    orgKind: 'consultant', userId: null, in4PartyKind: null, in4PartyId: null,
    name: 'SNK Design Studio', roleOnProject: 'Lead Architect', email: null, phone: null,
    isLead: false, isActive: true, notes: null, orderValue: null, paid: null, orders: 0,
    ...over,
  })

  it('names the discipline nobody covers — the whole point of the coverage check', () => {
    const enabled = [
      { id: 'd-arch', name: 'Architecture', shortName: null, order: 10 },
      { id: 'd-str', name: 'Structural', shortName: null, order: 20 },
    ]
    const gaps = coverageGaps(enabled, [person({ disciplineId: 'd-arch' })])
    expect(gaps.map(g => g.name)).toEqual(['Structural'])
  })

  it('does not count somebody who has left the project as cover', () => {
    const enabled = [{ id: 'd-arch', name: 'Architecture', shortName: null, order: 10 }]
    expect(coverageGaps(enabled, [person({ isActive: false })])).toHaveLength(1)
  })

  it('addresses an entry to the named lead', () => {
    const people = [
      person({ id: 's1', name: 'Firm A' }),
      person({ id: 's2', name: 'Firm B', isLead: true }),
    ]
    expect(defaultAssignee('d-arch', people)?.name).toBe('Firm B')
  })

  it('addresses it to the only person in the discipline when no lead is named', () => {
    expect(defaultAssignee('d-arch', [person({ name: 'Only Firm' })])?.name).toBe('Only Firm')
  })

  it('refuses to guess when two are named and neither leads', () => {
    const people = [person({ id: 's1' }), person({ id: 's2', name: 'Other' })]
    expect(defaultAssignee('d-arch', people)).toBeNull()
    expect(defaultAssignee(null, people)).toBeNull()
  })
})

describe('decisions', () => {
  const dec = (over: Partial<DecisionRow> = {}): DecisionRow => ({
    id: 'i1', projectId: 'p1', categoryId: 'c1', categoryName: 'Finishes', categoryCode: '12',
    subCategoryId: 's1', subCategoryName: 'Flooring — Vitrified',
    isApplicable: true, status: 'pending', spec: null, decidedByName: null, decidedOn: null,
    requiredBy: null, ownerName: null, revision: 0, openRefs: [],
    ...over,
  })

  it('flags an unsettled specification once procurement is inside the window', () => {
    expect(isFlagged(dec({ requiredBy: '2026-09-20' }), '2026-09-12')).toBe(true)
    expect(isFlagged(dec({ requiredBy: '2026-12-01' }), '2026-09-12')).toBe(false)
  })

  it('flags one already late', () => {
    expect(isFlagged(dec({ requiredBy: '2026-08-01' }), '2026-09-12')).toBe(true)
  })

  it('never flags something already approved, or not applicable, or undated', () => {
    expect(isFlagged(dec({ requiredBy: '2026-09-20', status: 'approved' }), '2026-09-12')).toBe(false)
    expect(isFlagged(dec({ requiredBy: '2026-09-20', isApplicable: false }), '2026-09-12')).toBe(false)
    expect(isFlagged(dec({ requiredBy: null }), '2026-09-12')).toBe(false)
  })

  it('counts applicable, approved, outstanding and flagged separately', () => {
    const cats: DecisionCategory[] = [{
      categoryId: 'c1', name: 'Finishes', code: '12', order: 12,
      rows: [
        dec({ subCategoryId: 'a', status: 'approved' }),
        dec({ subCategoryId: 'b', requiredBy: '2026-09-15' }),
        dec({ subCategoryId: 'c' }),
        dec({ subCategoryId: 'd', isApplicable: false }),
      ],
    }]
    const s = summariseDecisions(cats, '2026-09-12')
    expect(s).toEqual({ applicable: 3, total: 4, approved: 1, outstanding: 2, flagged: 1 })
  })
})
