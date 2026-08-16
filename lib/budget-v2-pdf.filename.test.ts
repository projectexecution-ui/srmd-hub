import { describe, expect, it } from 'vitest'
import { projectPdfFilename, groupPdfFilename } from '@/lib/budget-v2-pdf'

// Real projects and figures from the Budget vs Actual V2 screen.
const cases = [
  { p: { name: 'NGH A',            budget: 95_700_000, spent: 61_500_000 }, on: '2026-08-16' },
  { p: { name: 'A01 Building',     budget: 110_400_000, spent: 39_482_640 }, on: '2026-08-16' },
  { p: { name: 'NGH Common',       budget: 4_941_070,  spent: 3_787_550 },  on: '2026-08-16' },
  { p: { name: 'P2 Step Terrace / Infra', budget: 32_600_000, spent: 1_620_000 }, on: '2026-08-16' },
  { p: { name: 'Zero Budget Proj', budget: 0,          spent: 0 },          on: '2026-08-16' },
]

describe('projectPdfFilename', () => {
  it('produces a sortable, self-describing, filesystem-safe name', () => {
    for (const c of cases) {
      const n = projectPdfFilename(c.p, c.on)
      console.log('  ', n)
      expect(n.endsWith('.pdf')).toBe(true)
      // no characters that break a filesystem or Telegram
      expect(/[\/:*?"<>|]/.test(n)).toBe(false)
      expect(n.startsWith('2026-W')).toBe(true)      // week first => sorts by date
      expect(n.length).toBeLessThan(80)
    }
  })
  it('shows used% and copes with a zero budget', () => {
    expect(projectPdfFilename(cases[0].p, '2026-08-16')).toContain('Used-64pc')
    expect(projectPdfFilename(cases[4].p, '2026-08-16')).toContain('Used-na')
  })
  it('shortens money the Indian way', () => {
    expect(projectPdfFilename(cases[0].p, '2026-08-16')).toContain('Bud-9.57Cr')
    expect(projectPdfFilename(cases[2].p, '2026-08-16')).toContain('Bud-49.41L')
  })
})

// A group travels as ONE file with a page per sub-project, so its name has to
// say how many are inside — otherwise you cannot tell a 5-project file from a
// 1-project one without opening it.
describe('groupPdfFilename', () => {
  const NGH = { name: 'NGH', budget: 452_000_000, spent: 262_160_000, projects: [1, 2, 3, 4, 5] }
  it('names a group file with its project count', () => {
    const n = groupPdfFilename(NGH, '2026-08-16')
    console.log('  ', n)
    expect(n).toContain('_NGH_')
    expect(n).toContain('5-projects')
    expect(n).toContain('Used-58pc')
    expect(n.endsWith('.pdf')).toBe(true)
    expect(/[\/:*?"<>|]/.test(n)).toBe(false)
  })
  it('sorts beside the individual project files of the same week', () => {
    const g = groupPdfFilename(NGH, '2026-08-16')
    const p = projectPdfFilename({ name: 'Vinay Building', budget: 80_500_000, spent: 51_800_000 }, '2026-08-16')
    console.log('  ', p)
    expect(g.slice(0, 8)).toBe(p.slice(0, 8))   // same 2026-Wnn prefix
  })
})
