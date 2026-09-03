import { describe, it, expect } from 'vitest'
import {
  MEASURES, DEFAULT_COLUMNS, measure, defaultSelection, filterLines, buildRows,
  totalRow, formatCell, pdfColumnsOf, describeSelection, UNITS,
  savedKeyFor, toSaved, fromSaved, bucketFor, usableBuckets,
  type SourceLine, type Selection,
} from './sc-budgets'

// Two projects, three categories, real shapes from cc_budget_lines.
const LINES: SourceLine[] = [
  { projectId: 'p1', projectName: 'SRAH', disciplineCode: '01', disciplineName: 'Site Pre-lims', subCode: '102', subName: 'Porta Cabins', ie: 132085, budget: 132085, wo: 65130, paid: 65130, sft: 840034 },
  { projectId: 'p1', projectName: 'SRAH', disciplineCode: '01', disciplineName: 'Site Pre-lims', subCode: '105', subName: 'Plumbing', ie: 2365, budget: 2365, wo: 2360, paid: 2360, sft: 840034 },
  { projectId: 'p1', projectName: 'SRAH', disciplineCode: '02', disciplineName: 'Earthworks', subCode: '201', subName: 'Excavation', ie: 111130, budget: 111130, wo: 97583, paid: 97583, sft: 840034 },
  { projectId: 'p2', projectName: 'NGH C', disciplineCode: '02', disciplineName: 'Earthworks', subCode: '201', subName: 'Excavation', ie: 500000, budget: 400000, wo: 100000, paid: 50000, sft: 200000 },
  // A category-level line with no sub-category — must survive a sub pick.
  { projectId: 'p2', projectName: 'NGH C', disciplineCode: '03', disciplineName: 'Civil', subCode: null, subName: null, ie: 900000, budget: 800000, wo: 0, paid: 0, sft: 200000 },
]

const sel = (over: Partial<Selection> = {}): Selection => ({ ...defaultSelection(['p1', 'p2']), ...over })

describe('the measures a column can show', () => {
  it('has unique ids and short labels', () => {
    const ids = MEASURES.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of MEASURES) {
      expect(m.label.trim().split(/\s+/).length, m.id).toBeLessThanOrEqual(5)
      expect(m.hint.length, m.id).toBeGreaterThan(8)
    }
  })

  it('opens on the four figures the HOD reads first', () => {
    expect(DEFAULT_COLUMNS).toEqual(['budget', 'wo', 'paid', 'balance'])
  })

  // The Internal Estimate is management's own baseline — flagged so a future
  // change cannot quietly widen who sees it.
  it('marks the Internal Estimate confidential', () => {
    expect(measure('ie').confidential).toBe(true)
    expect(MEASURES.filter(m => m.confidential).map(m => m.id)).toEqual(['ie'])
  })

  it('throws on an unknown measure rather than rendering blank', () => {
    expect(() => measure('nope' as never)).toThrow(/Unknown measure/)
  })
})

describe('mixing categories and sub-categories across projects', () => {
  it('takes everything when nothing is picked', () => {
    expect(filterLines(LINES, sel())).toHaveLength(5)
  })

  it('narrows to chosen projects', () => {
    expect(filterLines(LINES, sel({ projectIds: ['p1'] })).every(l => l.projectId === 'p1')).toBe(true)
    expect(filterLines(LINES, sel({ projectIds: ['p1'] }))).toHaveLength(3)
  })

  it('narrows to chosen categories', () => {
    expect(filterLines(LINES, sel({ disciplineCodes: ['02'] }))).toHaveLength(2)
  })

  it('mixes a category and a sub-category pick together', () => {
    const r = filterLines(LINES, sel({ disciplineCodes: ['01'], subCodes: ['102'] }))
    expect(r).toHaveLength(1)
    expect(r[0].subCode).toBe('102')
  })

  // A sub pick must narrow only lines that HAVE a sub-category, or a
  // category-level line vanishes without the reader asking for that.
  it('keeps a category-level line through a sub-category pick', () => {
    const r = filterLines(LINES, sel({ subCodes: ['201'] }))
    expect(r.map(l => l.subCode ?? 'null').sort()).toEqual(['201', '201', 'null'])
  })

  it('one category across two projects rolls into one row', () => {
    const rows = buildRows(filterLines(LINES, sel({ disciplineCodes: ['02'] })), sel({ disciplineCodes: ['02'] }))
    expect(rows).toHaveLength(1)
    expect(rows[0].values.budget).toBe(511130)
    expect(rows[0].sub).toBe('2 projects')
  })

  it('names the single project when a row covers only one', () => {
    const s = sel({ projectIds: ['p1'], disciplineCodes: ['01'] })
    expect(buildRows(filterLines(LINES, s), s)[0].sub).toBe('SRAH')
  })
})

describe('grouping', () => {
  it('by category collapses sub-categories', () => {
    const s = sel({ grouping: 'category' })
    const rows = buildRows(LINES, s)
    expect(rows.map(r => r.label)).toEqual(['01 Site Pre-lims', '02 Earthworks', '03 Civil'])
    expect(rows[0].values.budget).toBe(134450)
  })

  it('by sub-category keeps them apart', () => {
    const rows = buildRows(LINES, sel({ grouping: 'subcategory' }))
    expect(rows.map(r => r.label)).toContain('102 Porta Cabins')
    expect(rows.map(r => r.label)).toContain('105 Plumbing')
  })

  it('by project sorts biggest budget first', () => {
    const rows = buildRows(LINES, sel({ grouping: 'project' }))
    expect(rows.map(r => r.label)).toEqual(['NGH C', 'SRAH'])
  })

  it('sorts categories by code number, not alphabetically', () => {
    const rows = buildRows(LINES, sel({ grouping: 'category' }))
    expect(rows.map(r => r.label.split(' ')[0])).toEqual(['01', '02', '03'])
  })
})

describe('the arithmetic that goes to the Trustee', () => {
  it('derives balance and uncommitted rather than storing them', () => {
    const rows = buildRows(LINES, sel({ grouping: 'project', projectIds: ['p2'] }))
    const ngh = rows.find(r => r.label === 'NGH C')!
    expect(ngh.values.budget).toBe(1200000)
    expect(ngh.values.paid).toBe(50000)
    expect(ngh.values.balance).toBe(1150000)
    expect(ngh.values.outstanding).toBe(1100000) // 1,200,000 − 100,000 WO
  })

  // Summing percentages across rows is meaningless — it must be recomputed.
  it('recomputes % Used on the total instead of adding the rows up', () => {
    const rows = buildRows(LINES, sel())
    const t = totalRow(rows, LINES)
    const summed = rows.reduce((n, r) => n + r.values.used_pct, 0)
    expect(t.values.used_pct).toBeCloseTo((215073 / 1445580) * 100, 4)
    expect(t.values.used_pct).not.toBeCloseTo(summed, 1)
  })

  // Area belongs to a project, not to a line — summing it per line would
  // multiply the area by the number of categories and wreck every ₹/sft.
  it('counts each project area once, however many lines it has', () => {
    const s = sel({ grouping: 'project', projectIds: ['p1'] })
    const row = buildRows(filterLines(LINES, s), s)[0]
    expect(row.lines).toBe(3)
    expect(row.values.per_sft).toBeCloseTo(245580 / 840034, 6)
  })

  it('counts each project area once on the total too', () => {
    const t = totalRow(buildRows(LINES, sel()), LINES)
    expect(t.values.per_sft).toBeCloseTo(1445580 / 1040034, 6)
  })

  it('never divides by zero when a project has no area', () => {
    const noArea = LINES.map(l => ({ ...l, sft: 0 }))
    const t = totalRow(buildRows(noArea, sel()), noArea)
    expect(t.values.per_sft).toBe(0)
    expect(Number.isFinite(t.values.used_pct)).toBe(true)
  })

  it('totals every money measure across the rows', () => {
    const t = totalRow(buildRows(LINES, sel()), LINES)
    expect(t.values.budget).toBe(1445580)
    expect(t.values.ie).toBe(1645580)
    expect(t.values.wo).toBe(265073)
    expect(t.values.paid).toBe(215073)
  })
})

describe('changing the amount shown', () => {
  it('scales money to lakh and crore, in Indian grouping', () => {
    expect(formatCell(12345678, 'budget', 'rupee')).toBe('₹1,23,45,678')
    expect(formatCell(12345678, 'budget', 'lakh')).toBe('₹123.46 L')
    expect(formatCell(12345678, 'budget', 'crore')).toBe('₹1.23 Cr')
  })

  it('never scales a rate — ₹/sft is a rate, not an amount', () => {
    expect(formatCell(290, 'per_sft', 'crore')).toBe('₹290')
  })

  it('shows a percentage as a percentage', () => {
    expect(formatCell(61.4, 'used_pct', 'lakh')).toBe('61%')
  })

  it('shows a dash rather than a zero', () => {
    expect(formatCell(0, 'budget', 'lakh')).toBe('—')
    expect(formatCell(0, 'used_pct', 'lakh')).toBe('—')
    expect(formatCell(0, 'per_sft', 'lakh')).toBe('—')
  })

  it('offers all three units with sane precision', () => {
    expect(UNITS.map(u => u.id)).toEqual(['rupee', 'lakh', 'crore'])
    expect(UNITS.find(u => u.id === 'rupee')!.dp).toBe(0)
  })
})

describe('choosing what the PDF carries', () => {
  it('defaults to whatever is on screen', () => {
    expect(pdfColumnsOf(sel())).toEqual(DEFAULT_COLUMNS)
  })

  it('narrows to the ticked columns', () => {
    expect(pdfColumnsOf(sel({ pdfColumns: ['budget', 'paid'] }))).toEqual(['budget', 'paid'])
  })

  it('keeps the report order, not the tick order', () => {
    expect(pdfColumnsOf(sel({ pdfColumns: ['paid', 'budget'] }))).toEqual(['budget', 'paid'])
  })

  // A PDF column that is not in the report would print an empty column.
  it('never carries a column the report does not show', () => {
    expect(pdfColumnsOf(sel({ columns: ['budget'], pdfColumns: ['budget', 'ie'] }))).toEqual(['budget'])
  })
})

// Aksha, 2026-09-03: "i want to club 2 Sub cat in one name and also sometine
// 2 CAt in one name".
describe('clubbing lines under one name', () => {
  const club = (over: Partial<import('./sc-budgets').Bucket> = {}) => ({
    id: 'b1', name: 'Finishes', disciplineCodes: [], subCodes: [], ...over,
  })

  it('clubs two sub-categories into one named row', () => {
    const s = sel({ buckets: [club({ subCodes: ['102', '105'] })], grouping: 'subcategory' })
    const rows = buildRows(LINES, s)
    const f = rows.find(r => r.label === 'Finishes')!
    expect(f.values.budget).toBe(134450) // 132,085 + 2,365
    expect(f.lines).toBe(2)
    expect(f.isClub).toBe(true)
    expect(rows.map(r => r.label)).not.toContain('102 Porta Cabins')
  })

  it('clubs two categories into one named row', () => {
    const s = sel({ buckets: [club({ name: 'Civil', disciplineCodes: ['02', '03'] })] })
    const f = buildRows(LINES, s).find(r => r.label === 'Civil')!
    expect(f.values.budget).toBe(1311130) // 111,130 + 400,000 + 800,000
    expect(f.lines).toBe(3)
  })

  it('mixes a category and a sub-category inside one club', () => {
    const s = sel({ buckets: [club({ disciplineCodes: ['03'], subCodes: ['102'] })] })
    const f = buildRows(LINES, s).find(r => r.label === 'Finishes')!
    expect(f.values.budget).toBe(932085) // 800,000 + 132,085
  })

  it('leaves everything not clubbed grouped as before', () => {
    const s = sel({ buckets: [club({ subCodes: ['102'] })] })
    const labels = buildRows(LINES, s).map(r => r.label)
    expect(labels).toContain('Finishes')
    expect(labels).toContain('02 Earthworks')
    expect(labels).toContain('03 Civil')
  })

  // The more specific rule is what someone means when they club one
  // sub-category out of a category they have also clubbed.
  it('lets a sub-category club win over a category club', () => {
    const s = sel({
      buckets: [
        club({ id: 'cat', name: 'All Prelims', disciplineCodes: ['01'] }),
        club({ id: 'sub', name: 'Just Cabins', subCodes: ['102'] }),
      ],
    })
    const rows = buildRows(LINES, s)
    expect(rows.find(r => r.label === 'Just Cabins')!.values.budget).toBe(132085)
    expect(rows.find(r => r.label === 'All Prelims')!.values.budget).toBe(2365)
  })

  it('never counts a line into two clubs', () => {
    const s = sel({
      buckets: [
        club({ id: 'a', name: 'A', disciplineCodes: ['02'] }),
        club({ id: 'b', name: 'B', disciplineCodes: ['02'] }),
      ],
    })
    const rows = buildRows(LINES, s)
    expect(rows.find(r => r.label === 'B')).toBeUndefined()
    expect(totalRow(rows, LINES).values.budget).toBe(1445580) // unchanged total
  })

  it('keeps the total identical however lines are clubbed', () => {
    const plain = totalRow(buildRows(LINES, sel()), LINES)
    const clubbed = totalRow(
      buildRows(LINES, sel({ buckets: [club({ disciplineCodes: ['01', '02', '03'] })] })), LINES)
    expect(clubbed.values.budget).toBe(plain.values.budget)
    expect(clubbed.values.paid).toBe(plain.values.paid)
  })

  it('puts clubs first, in the order they were defined', () => {
    const s = sel({
      buckets: [
        club({ id: 'z', name: 'Zebra', disciplineCodes: ['03'] }),
        club({ id: 'a', name: 'Alpha', disciplineCodes: ['02'] }),
      ],
    })
    expect(buildRows(LINES, s).map(r => r.label).slice(0, 2)).toEqual(['Zebra', 'Alpha'])
  })

  it('ignores a club with no name or no members', () => {
    const s = sel({ buckets: [club({ name: '  ' , subCodes: ['102'] }), club({ id: 'e', name: 'Empty' })] })
    const rows = buildRows(LINES, s)
    expect(rows.some(r => r.isClub)).toBe(false)
    expect(rows.map(r => r.label)).toContain('01 Site Pre-lims')
  })

  it('names the club across projects when it spans them', () => {
    const s = sel({ buckets: [club({ name: 'Excavation', subCodes: ['201'] })] })
    expect(buildRows(LINES, s).find(r => r.label === 'Excavation')!.sub).toBe('2 projects')
  })
})

describe('saving a layout per project', () => {
  it('keys on the project', () => {
    expect(savedKeyFor('abc')).toBe('sc_budgets_abc')
  })

  // Saving the projects would make a report open somewhere other than where
  // it was clicked.
  it('saves the presentation but never which projects', () => {
    const saved = toSaved(sel({ projectIds: ['p1'], unit: 'crore', grouping: 'subcategory' }))
    expect(saved).not.toHaveProperty('projectIds')
    expect(saved.unit).toBe('crore')
    expect(saved.grouping).toBe('subcategory')
  })

  it('drops unusable clubs on the way out', () => {
    const saved = toSaved(sel({ buckets: [{ id: 'x', name: '', disciplineCodes: ['01'], subCodes: [] }] }))
    expect(saved.buckets).toEqual([])
  })

  it('round-trips a real layout', () => {
    const s = sel({
      unit: 'crore', grouping: 'subcategory', columns: ['budget', 'paid'], pdfColumns: ['budget'],
      buckets: [{ id: 'b1', name: 'Finishes', disciplineCodes: ['01'], subCodes: ['201'] }],
    })
    const back = fromSaved(toSaved(s), ['p1'])
    expect(back.unit).toBe('crore')
    expect(back.grouping).toBe('subcategory')
    expect(back.columns).toEqual(['budget', 'paid'])
    expect(back.pdfColumns).toEqual(['budget'])
    expect(back.buckets).toEqual(s.buckets)
    expect(back.projectIds).toEqual(['p1'])
  })

  // This JSON gets hand-edited in app_settings; a bad value must degrade, not
  // throw on a report the Trustee is opening.
  it('falls back to defaults on rubbish rather than throwing', () => {
    for (const bad of [null, undefined, 'nope', 42, [], {}]) {
      const r = fromSaved(bad, ['p1'])
      expect(r.columns).toEqual(DEFAULT_COLUMNS)
      expect(r.unit).toBe('lakh')
      expect(r.buckets).toEqual([])
    }
  })

  it('drops a column name that is not a real measure', () => {
    expect(fromSaved({ columns: ['budget', 'made_up'] }, ['p1']).columns).toEqual(['budget'])
  })

  it('keeps the default columns when the saved list is empty', () => {
    expect(fromSaved({ columns: [] }, ['p1']).columns).toEqual(DEFAULT_COLUMNS)
  })

  it('rejects a bad unit or grouping', () => {
    const r = fromSaved({ unit: 'dollars', grouping: 'sideways' }, ['p1'])
    expect(r.unit).toBe('lakh')
    expect(r.grouping).toBe('category')
  })

  it('gives a club an id when the saved one has none', () => {
    const r = fromSaved({ buckets: [{ name: 'X', disciplineCodes: ['01'] }] }, ['p1'])
    expect(r.buckets[0].id).toBe('club-0')
    expect(r.buckets[0].subCodes).toEqual([])
  })
})

describe('the line that describes the report', () => {
  const names = new Map([['p1', 'SRAH'], ['p2', 'NGH C']])

  it('names the projects when there are few', () => {
    expect(describeSelection(sel({ projectIds: ['p1', 'p2'] }), names))
      .toBe('SRAH, NGH C · all categories · by category · Lakh')
  })

  it('counts them when there are many', () => {
    const s = sel({ projectIds: ['a', 'b', 'c', 'd'] })
    expect(describeSelection(s, names)).toContain('4 projects')
  })

  it('says all projects when none are picked', () => {
    expect(describeSelection(sel({ projectIds: [] }), names)).toMatch(/^All projects/)
  })

  it('reports the category and sub-category narrowing', () => {
    const s = sel({ disciplineCodes: ['01'], subCodes: ['102', '105'], grouping: 'subcategory' })
    const d = describeSelection(s, names)
    expect(d).toContain('1 category')
    expect(d).toContain('2 sub-categories')
    expect(d).toContain('by sub-category')
  })
})
