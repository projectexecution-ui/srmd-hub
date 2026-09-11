import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WEEKLY_CONFIG, DEFAULT_LINES, parseWeeklyConfig, serializeWeeklyConfig, applyWeeklyConfig,
  mondayOf, isMondayIST, resolveRecipients, UNPLACED_GROUP, type WeeklyConfig,
} from './config'
import type { ComposeResult, ProjectNode } from '@/lib/budget-v2'

const node = (name: string, group: string, budget: number, approved: number, spent: number, cats: Array<[string, number, number, number]> = []): ProjectNode => ({
  name, group, status: 'open', area: null, budget, approved, spent,
  categories: cats.map(([label, b, a, s]) => ({ code: '', label, budget: b, approved: a, spent: s, hasBudget: true, subcats: [] })),
})
const tree = (nodes: ProjectNode[]): ComposeResult => {
  const groups = new Map<string, ProjectNode[]>()
  for (const n of nodes) groups.set(n.group, [...(groups.get(n.group) ?? []), n])
  const gs = [...groups.entries()].map(([name, projects]) => ({
    name, projects,
    budget: projects.reduce((s, p) => s + p.budget, 0), approved: projects.reduce((s, p) => s + p.approved, 0),
    spent: projects.reduce((s, p) => s + p.spent, 0), area: 0,
  }))
  return { groups: gs, totals: { budget: gs.reduce((s, g) => s + g.budget, 0), approved: gs.reduce((s, g) => s + g.approved, 0), spent: gs.reduce((s, g) => s + g.spent, 0), area: 0 } }
}

// A slice of the real 11 Sep 2026 state, in ₹ crore for readability.
const IN4 = tree([
  node('Admin Block', 'Admin Block', 1.43, 1.36, 1.24, [['Civil', 1.0, 1.0, 1.0], ['Site Admin', 0.43, 0.36, 0.24]]),
  node('Admin Block - Common Expenses', 'Admin Block', 0.01, 0, 0, [['Site Admin', 0.01, 0, 0]]),
  node('Admin Block - SRMD Ashram ICT Team', 'Admin Block', 0.01, 0, 0),
  node('Admin Block - SRMD Ashram Security Team', '— Ungrouped', 0.03, 0, 0),
  node('Welcome Centre Extension', '— Ungrouped', 1.95, 0.21, 0.14),
  node('Welcome Centre Extension - Design', 'Welcome Centre Extension', 0.41, 0.06, 0.06),
  node('SRAH', '— Ungrouped', 46.65, 42.19, 34.13),
  node('Sheth House - Design', '— Ungrouped', 0.05, 0, 0),
  node('Brand New IN4 Head', '— Ungrouped', 0.5, 0.1, 0.1),
  node('Empty Head', '— Ungrouped', 0, 0, 0),
])

describe('weekly report config', () => {
  it('reads the approved list when nothing is stored, or the stored value is broken', () => {
    expect(parseWeeklyConfig(null)).toEqual(DEFAULT_WEEKLY_CONFIG)
    expect(parseWeeklyConfig('not json')).toEqual(DEFAULT_WEEKLY_CONFIG)
    expect(parseWeeklyConfig('[1,2]')).toEqual(DEFAULT_WEEKLY_CONFIG)
  })

  it('round-trips through JSON without losing a field', () => {
    const cfg: WeeklyConfig = { ...DEFAULT_WEEKLY_CONFIG, includeDesign: true, groupPdfs: false, recipients: { '11111111-1111-1111-1111-111111111111': { card: true, email: false } }, lastSentWeek: '2026-09-07' }
    expect(parseWeeklyConfig(serializeWeeklyConfig(cfg))).toEqual(cfg)
  })

  it('keeps the last entry when one IN4 name is listed twice', () => {
    const cfg = parseWeeklyConfig(JSON.stringify({ lines: [{ in4: 'SRAH', project: 'A' }, { in4: 'SRAH', project: 'B' }] }))
    expect(cfg.lines).toEqual([{ in4: 'SRAH', project: 'B' }])
  })

  it('places every default line under a main project and names every Design line as such', () => {
    for (const l of DEFAULT_LINES) expect(l.project.length, l.in4).toBeGreaterThan(0)
    const design = DEFAULT_LINES.filter(l => l.design).map(l => l.in4).sort()
    expect(design).toEqual([
      'New Guest House - Infra Work - Design', 'P2 Row Houses - Design', 'Sheth House - Design', 'Welcome Centre Extension - Design',
    ])
  })
})

describe('applying the config to the IN4 tree', () => {
  const applied = applyWeeklyConfig(IN4, DEFAULT_WEEKLY_CONFIG)
  const g = (name: string) => applied.result.groups.find(x => x.name === name)!

  it('merges same-label lines into one and sums their money', () => {
    const ab = g('Admin Block')
    const common = ab.projects.find(p => p.name === 'Common expenses, ICT team, Security team')!
    expect(common.budget).toBeCloseTo(0.05, 6)
    expect(ab.projects.map(p => p.name)).toEqual(['Admin Block', 'Common expenses, ICT team, Security team'])
    expect(ab.budget).toBeCloseTo(1.48, 6)
  })

  it('merges categories by label when lines are merged', () => {
    const common = g('Admin Block').projects.find(p => p.name === 'Common expenses, ICT team, Security team')!
    expect(common.categories.map(c => c.label)).toEqual(['Site Admin'])
  })

  it('drops Design lines until the switch is on, and drops an all-Design project with them', () => {
    expect(g('Welcome Centre Extension').projects.map(p => p.name)).toEqual(['Welcome Centre Extension'])
    expect(applied.result.groups.find(x => x.name === 'Sheth House')).toBeUndefined()
    const withDesign = applyWeeklyConfig(IN4, { ...DEFAULT_WEEKLY_CONFIG, includeDesign: true })
    expect(withDesign.result.groups.find(x => x.name === 'Welcome Centre Extension')!.projects.map(p => p.name)).toEqual(['Welcome Centre Extension', 'Design'])
    expect(withDesign.result.groups.find(x => x.name === 'Sheth House')!.budget).toBeCloseTo(0.05, 6)
  })

  it('puts a standalone project under its own heading, keyed by its label', () => {
    expect(g('SRAH').projects).toHaveLength(1)
    expect(g('SRAH').projects[0].name).toBe('SRAH')
  })

  it('never loses money IN4 has that nobody placed — it shows under its own heading and is flagged', () => {
    expect(applied.unplaced).toEqual(['Brand New IN4 Head'])
    expect(g(UNPLACED_GROUP).budget).toBeCloseTo(0.5, 6)
  })

  it('ignores empty unplaced heads and reports config lines IN4 no longer has', () => {
    expect(applied.unplaced).not.toContain('Empty Head')
    expect(applied.missing).toContain('NGH A')
  })

  it('recomputes totals from what is shown, so the total equals the sum of the headings', () => {
    const t = applied.result.totals
    expect(t.budget).toBeCloseTo(applied.result.groups.reduce((s, x) => s + x.budget, 0), 6)
    // Design (0.41 + 0.05) and the empty head are out; the unplaced 0.5 is in.
    expect(t.budget).toBeCloseTo(1.43 + 0.01 + 0.01 + 0.03 + 1.95 + 46.65 + 0.5, 6)
  })

  it('hides a line marked show=false', () => {
    const cfg: WeeklyConfig = { ...DEFAULT_WEEKLY_CONFIG, lines: DEFAULT_LINES.map(l => l.in4 === 'SRAH' ? { ...l, show: false } : l) }
    expect(applyWeeklyConfig(IN4, cfg).result.groups.find(x => x.name === 'SRAH')).toBeUndefined()
  })
})

describe('weeks and recipients', () => {
  it('finds the IST Monday of any day in the week', () => {
    // Thu 10 Sep 2026 18:00 IST
    expect(mondayOf(Date.UTC(2026, 8, 10, 12, 30))).toBe('2026-09-07')
    // Sun 13 Sep 2026 23:30 IST is still the week of Mon 7 Sep
    expect(mondayOf(Date.UTC(2026, 8, 13, 18, 0))).toBe('2026-09-07')
    // Mon 14 Sep 2026 00:30 IST
    expect(mondayOf(Date.UTC(2026, 8, 13, 19, 0))).toBe('2026-09-14')
    expect(isMondayIST(Date.UTC(2026, 8, 13, 19, 0))).toBe(true)
    expect(isMondayIST(Date.UTC(2026, 8, 13, 18, 0))).toBe(false)
  })

  const people = [
    { id: 'a', ccRole: 'founder', active: true }, { id: 'b', ccRole: 'coordinator', active: true },
    { id: 'c', ccRole: 'head', active: false }, { id: 'd', ccRole: 'engineer', active: true },
  ]
  it('sends to management roles until someone is chosen by hand — never to a coordinator or engineer', () => {
    expect(resolveRecipients(DEFAULT_WEEKLY_CONFIG, people).map(r => r.id)).toEqual(['a'])
  })
  it('follows the chosen map exactly once it exists; "gets it" off means not sent at all, e-mail can be off on its own', () => {
    const cfg: WeeklyConfig = { ...DEFAULT_WEEKLY_CONFIG, recipients: { b: { card: true, email: false }, d: { card: false, email: true }, c: { card: true, email: true } } }
    // d is off despite e-mail on (the DM cannot be split from the card); c is inactive.
    expect(resolveRecipients(cfg, people)).toEqual([{ id: 'b', card: true, email: false }])
  })
})
