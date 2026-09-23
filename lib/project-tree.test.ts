import { describe, it, expect } from 'vitest'
import { buildProjectTree, countTree, projectIdFromPath } from './project-tree'

const P = (id: string, code: string | null, name: string, parentId: string | null = null, groupLabel: string | null = null, hasOwnData?: boolean) =>
  ({ id, code, name, parentId, groupLabel, ...(hasOwnData === undefined ? {} : { hasOwnData }) })

describe('buildProjectTree', () => {
  it('nests children under their parent and labels the branch by group label, else code', () => {
    const t = buildProjectTree([
      P('ngh', 'NGHG', 'NGH', null, 'NGH', false),
      P('a', 'NGH A', 'NGH A', 'ngh'), P('b', 'NGH B', 'NGH B', 'ngh'),
      P('srah', 'SRAH', 'SRAH'),
    ])
    expect(t.map(x => x.label)).toEqual(['NGH', 'SRAH'])
    expect(t[0].children.map(c => c.code)).toEqual(['NGH A', 'NGH B'])
    // NGH is an anchor — it holds nothing itself — so it is not a project to count.
    expect(t[0].anchor).toBe(true)
    expect(countTree(t)).toBe(3)
  })
  it('a parent with its own data is a project with sub-projects, not a group', () => {
    // Admin Block: ₹1.43 Cr of its own, plus seven children. It must never be
    // drawn as an anchor, or its money hides behind the children's roll-up.
    const t = buildProjectTree([
      P('ab', 'AB', 'Admin Block Full Building', null, null, true),
      P('ab1f', 'AB1F', 'Admin Block 1st Floor', 'ab'),
      P('abce', 'ABCE', 'Admin Block - Common Expenses', 'ab'),
    ])
    expect(t[0].anchor).toBe(false)
    expect(t[0].children).toHaveLength(2)
    expect(countTree(t)).toBe(3)
  })
  it('treats an unknown hasOwnData as a project, never an anchor', () => {
    // An older shell without the flag must not start hiding parents.
    const t = buildProjectTree([P('ek', 'EK', 'Ekant Kutir'), P('ekce', 'EKCE', 'Ekant Kutir - Common Expenses', 'ek')])
    expect(t[0].anchor).toBe(false)
    expect(countTree(t)).toBe(2)
  })
  it('labels a child by its name when its code would repeat the group label', () => {
    // NGH Infra's code is "NGH" — inside the NGH group it read as "NGH".
    const t = buildProjectTree([
      P('g', 'NGHG', 'NGH', null, 'NGH', false),
      P('infra', 'NGH', 'NGH Infra', 'g'), P('a', 'NGH A', 'NGH A', 'g'),
    ])
    expect(t[0].children.map(c => c.label)).toEqual(['NGH Infra', 'NGH A'])
    expect(t[0].children[0].code).toBe('NGH') // the code itself is untouched
  })
  it('promotes a child whose parent is not in the list instead of dropping it', () => {
    const t = buildProjectTree([P('a', 'NGH A', 'NGH A', 'missing')])
    expect(t).toHaveLength(1)
    expect(t[0].id).toBe('a')
  })
  // Three fixed levels since 23 Sep 2026 (H1): Group → Project → Sub-project.
  it('nests a third level under its project instead of flattening it up', () => {
    const t = buildProjectTree([P('g', 'G', 'Group', null, 'G', false), P('m', 'M', 'Mid', 'g', null, true), P('leaf', 'L', 'Leaf', 'm', null, true)])
    expect(t.map(x => x.id)).toEqual(['g'])
    expect(t[0].anchor).toBe(true)
    expect(t[0].children.map(c => c.id)).toEqual(['m'])
    expect(t[0].children[0].children.map(c => c.id)).toEqual(['leaf'])
    // A project holding a sub-project is not an anchor — it has data of its own.
    expect(t[0].children[0].anchor).toBe(false)
    // The count badge reaches the third level and skips the anchor.
    expect(countTree(t)).toBe(2)
  })
  it('sorts numerically so A02 comes before A10', () => {
    const t = buildProjectTree([P('p', 'P2', 'P2', null, 'P2'), P('x', 'P2 A10', 'A10', 'p'), P('y', 'P2 A02', 'A02', 'p')])
    expect(t[0].children.map(c => c.code)).toEqual(['P2 A02', 'P2 A10'])
  })
  it('reads the project id off an Internal Estimate URL', () => {
    expect(projectIdFromPath('/cost-control/projects/9f1c2a3b-1111-2222-3333-444455556666/setup')).toBe('9f1c2a3b-1111-2222-3333-444455556666')
    expect(projectIdFromPath('/project/9f1c2a3b-1111-2222-3333-444455556666/reports')).toBe('9f1c2a3b-1111-2222-3333-444455556666')
    expect(projectIdFromPath('/dashboard')).toBeNull()
  })
})
