import { describe, expect, it } from 'vitest'
import { projectPdfFilename } from '@/lib/budget-v2-pdf'

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
