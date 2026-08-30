import { describe, it, expect } from 'vitest'
import { buildProjectTree, countTree, projectIdFromPath, type FlatProject } from './project-tree'

const P = (id: string, code: string | null, name: string, parentId: string | null = null): FlatProject =>
  ({ id, code, name, parentId })

describe('buildProjectTree', () => {
  it('nests children under their parent', () => {
    const tree = buildProjectTree([
      P('ngh', 'NGH', 'NGH'),
      P('a', 'NGH A', 'NGH A', 'ngh'),
      P('b', 'NGH B', 'NGH B', 'ngh'),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].code).toBe('NGH')
    expect(tree[0].children.map(c => c.code)).toEqual(['NGH A', 'NGH B'])
  })

  it('keeps a project with no parent at the top', () => {
    const tree = buildProjectTree([P('x', 'SRAH', 'SRAH')])
    expect(tree.map(t => t.code)).toEqual(['SRAH'])
  })

  // A project must never disappear from the nav because its parent was
  // archived or filtered out — that failure would be silent.
  it('promotes a child whose parent is not in the list', () => {
    const tree = buildProjectTree([P('a', 'NGH A', 'NGH A', 'ngh-archived')])
    expect(tree.map(t => t.code)).toEqual(['NGH A'])
  })

  it('flattens anything deeper than two levels rather than dropping it', () => {
    const tree = buildProjectTree([
      P('root', 'R', 'Root'),
      P('mid', 'M', 'Mid', 'root'),
      P('deep', 'D', 'Deep', 'mid'),
    ])
    const codes = tree.map(t => t.code)
    expect(codes).toContain('R')
    expect(codes).toContain('D')          // promoted, not lost
    expect(tree.find(t => t.code === 'R')!.children.map(c => c.code)).toEqual(['M'])
  })

  it('sorts numerically so A2 comes before A10', () => {
    const tree = buildProjectTree([
      P('p', 'P2', 'P2'),
      P('a10', 'P2 A10', 'P2 A10', 'p'),
      P('a2', 'P2 A2', 'P2 A2', 'p'),
    ])
    expect(tree[0].children.map(c => c.code)).toEqual(['P2 A2', 'P2 A10'])
  })

  it('falls back to the name when a project has no code', () => {
    const tree = buildProjectTree([P('x', null, 'Zebra'), P('y', null, 'Apple')])
    expect(tree.map(t => t.name)).toEqual(['Apple', 'Zebra'])
  })

  it('handles an empty list', () => {
    expect(buildProjectTree([])).toEqual([])
  })
})

describe('countTree', () => {
  it('counts parents and children', () => {
    const tree = buildProjectTree([
      P('ngh', 'NGH', 'NGH'), P('a', 'NGH A', 'NGH A', 'ngh'), P('s', 'SRAH', 'SRAH'),
    ])
    expect(countTree(tree)).toBe(3)
  })
})

describe('projectIdFromPath', () => {
  const ID = 'df7d9f3d-ae77-49af-884a-ce49c3b687e3'

  it('finds the project on a cockpit URL', () => {
    expect(projectIdFromPath(`/project/${ID}`)).toBe(ID)
    expect(projectIdFromPath(`/project/${ID}/reports`)).toBe(ID)
  })

  it('returns null anywhere else', () => {
    expect(projectIdFromPath('/dashboard')).toBeNull()
    expect(projectIdFromPath(`/cost-control/projects/${ID}`)).toBeNull()
  })
})
