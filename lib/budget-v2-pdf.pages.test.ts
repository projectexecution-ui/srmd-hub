import { describe, expect, it } from 'vitest'
import { buildWeeklyDetailPdf } from './budget-v2-pdf'
import type { ComposeResult, CatNode, ProjectNode, GroupNode } from './budget-v2'

/** A PDF page is a `/Type /Page` object (not /Pages). Counting them is the only
 *  honest check that a project did not spill onto a second sheet. */
function pageCount(bytes: Uint8Array): number {
  const s = Buffer.from(bytes).toString('latin1')
  return (s.match(/\/Type\s*\/Page[^s]/g) || []).length
}

const cat = (i: number, subs: number): CatNode => ({
  code: `0${i}`, label: `Category ${i}`, budget: 1e6, approved: 8e5, spent: 6e5, hasBudget: true,
  subcats: Array.from({ length: subs }, (_, j) => ({
    code: `0${i}.${j}`, label: `Work item ${i}.${j} with a fairly long descriptive name`,
    budget: 1e5, approved: 8e4, spent: 6e4,
  })),
})

const project = (name: string, cats: number, subsEach: number): ProjectNode => ({
  name, group: 'NGH', status: 'open', area: 12000,
  budget: 1e7, approved: 8e6, spent: 6e6,
  categories: Array.from({ length: cats }, (_, i) => cat(i, subsEach)),
})

const resultWith = (projects: ProjectNode[]): ComposeResult => {
  const g: GroupNode = { name: 'NGH', budget: 1e8, approved: 8e7, spent: 6e7, area: 50000, projects }
  return { groups: [g], totals: { budget: 1e8, approved: 8e7, spent: 6e7, area: 50000 } }
}

const base = (r: ComposeResult) => ({
  result: r,
  freshness: { budget: '2026-08-16' } as never,
  delta: { hasBaseline: false, overall: { budget: 0, approved: 0, paid: 0 }, projects: {} } as never,
  prevSnapshotWeek: null,
  prev: null,
})

describe('one project = one page, however long its breakdown', () => {
  it('keeps a SHORT project on a single page', () => {
    const r = resultWith([project('NGH A', 4, 3)])
    const pdf = buildWeeklyDetailPdf({ ...base(r), onlyProject: 'NGH A' }, 'subcategory')
    expect(pageCount(pdf)).toBe(1)
  })

  // This is the case Aksha reported: sub-category expands every work item, and
  // NGH B / SRAH ran over the bottom of the page and continued overleaf.
  it('squeezes a LONG sub-category breakdown onto one page instead of splitting it', () => {
    const r = resultWith([project('NGH B', 10, 8)])   // 10 cats x 8 items + totals ≈ 91 rows
    const pdf = buildWeeklyDetailPdf({ ...base(r), onlyProject: 'NGH B' }, 'subcategory')
    expect(pageCount(pdf)).toBe(1)
  })

  // The physical limit, recorded rather than hidden. A ~155-row breakdown needs
  // roughly 1,035pt of a ~700pt A4 page even at the smallest legible size, so it
  // still runs to a second sheet. Fixing THIS case needs a landscape or A3 page,
  // not more shrinking — 4pt type helps nobody.
  it('documents the limit: a very long breakdown still needs a second sheet', () => {
    const r = resultWith([project('SRAH', 14, 10)])   // ~155 rows
    const pdf = buildWeeklyDetailPdf({ ...base(r), onlyProject: 'SRAH' }, 'subcategory')
    expect(pageCount(pdf)).toBe(2)
  })

  it('a group file = 1 summary page + 1 page per project, nothing split', () => {
    const r = resultWith([project('NGH A', 8, 6), project('NGH B', 10, 8), project('NGH C', 6, 5)])
    const pdf = buildWeeklyDetailPdf({ ...base(r), onlyGroup: 'NGH' }, 'subcategory')
    // 1 summary + 3 projects; NGH B and NGH C fit, the largest may take two.
    expect(pageCount(pdf)).toBeLessThanOrEqual(5)
  })
})
