import { describe, it, expect } from 'vitest'
import { buildProjectTree, countTree, projectIdFromPath } from './project-tree'

const P = (id: string, code: string | null, name: string, parentId: string | null = null, groupLabel: string | null = null) => ({ id, code, name, parentId, groupLabel })

describe('buildProjectTree', () => {
  it('nests children under their parent and labels the branch by group label, else code', () => {
    const t = buildProjectTree([
      P('ngh', 'NGH', 'NGH Infra', null, 'NGH'),
      P('a', 'NGH A', 'NGH A', 'ngh'), P('b', 'NGH B', 'NGH B', 'ngh'),
      P('srah', 'SRAH', 'SRAH'),
    ])
    expect(t.map(x => x.label)).toEqual(['NGH', 'SRAH'])
    expect(t[0].children.map(c => c.code)).toEqual(['NGH A', 'NGH B'])
    expect(countTree(t)).toBe(4)
  })
  it('promotes a child whose parent is not in the list instead of dropping it', () => {
    const t = buildProjectTree([P('a', 'NGH A', 'NGH A', 'missing')])
    expect(t).toHaveLength(1)
    expect(t[0].id).toBe('a')
  })
  it('flattens anything deeper than two levels up to the top', () => {
    const t = buildProjectTree([P('g', 'G', 'Group'), P('m', 'M', 'Mid', 'g'), P('leaf', 'L', 'Leaf', 'm')])
    expect(t.map(x => x.id).sort()).toEqual(['g', 'leaf'])
  })
  it('sorts numerically so A02 comes before A10', () => {
    const t = buildProjectTree([P('p', 'P2', 'P2', null, 'P2'), P('x', 'P2 A10', 'A10', 'p'), P('y', 'P2 A02', 'A02', 'p')])
    expect(t[0].children.map(c => c.code)).toEqual(['P2 A02', 'P2 A10'])
  })
  it('reads the project id off an Internal Estimate URL', () => {
    expect(projectIdFromPath('/cost-control/projects/9f1c2a3b-1111-2222-3333-444455556666/setup')).toBe('9f1c2a3b-1111-2222-3333-444455556666')
    expect(projectIdFromPath('/dashboard')).toBeNull()
  })
})
