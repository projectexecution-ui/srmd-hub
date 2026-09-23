import { describe, it, expect } from 'vitest'
import {
  kindOf, parentKindFor, allowedParents, parentError, kindChangeError, childKindOf, inferKind, topOf, descendants, pathOf,
  type KindRow, type ProjectKind,
} from './kind'

const rows: KindRow[] = [
  { id: 'nghg', kind: 'group', parentId: null },
  { id: 'ngh-a', kind: 'project', parentId: 'nghg' },
  { id: 'ngh-b', kind: 'project', parentId: 'nghg' },
  { id: 'ngh-a-ce', kind: 'subproject', parentId: 'ngh-a' },
  { id: 'ab', kind: 'project', parentId: null },
  { id: 'abgf', kind: 'subproject', parentId: 'ab' },
]

describe('kinds', () => {
  it('reads the column safely — individual is the old word for project', () => {
    expect(kindOf('group')).toBe('group')
    expect(kindOf('subproject')).toBe('subproject')
    expect(kindOf('individual')).toBe('project')
    expect(kindOf(null)).toBe('project')
    expect(kindOf('nonsense')).toBe('project')
  })
  it('each kind has exactly one parent kind', () => {
    expect(parentKindFor('group')).toBeNull()
    expect(parentKindFor('project')).toBe('group')
    expect(parentKindFor('subproject')).toBe('project')
    expect(childKindOf('group')).toBe('project')
    expect(childKindOf('project')).toBe('subproject')
    expect(childKindOf('subproject')).toBeNull()
  })
})

describe('the picker offers the right level — the whole point of H1', () => {
  it('a sub-project may go under NGH A (a project), which the old picker never offered', () => {
    expect(allowedParents('subproject', rows).map(r => r.id).sort()).toEqual(['ab', 'ngh-a', 'ngh-b'])
  })
  it('a project may go under a group only; a group has no parents', () => {
    expect(allowedParents('project', rows).map(r => r.id)).toEqual(['nghg'])
    expect(allowedParents('group', rows)).toEqual([])
  })
  it('never offers the thing itself', () => {
    expect(allowedParents('subproject', rows, 'ngh-a').map(r => r.id)).not.toContain('ngh-a')
  })
})

describe('parentError — the refusal, in words', () => {
  it('accepts the three legal shapes', () => {
    expect(parentError('group', null)).toBeNull()
    expect(parentError('project', null)).toBeNull()
    expect(parentError('project', { kind: 'group' })).toBeNull()
    expect(parentError('subproject', { kind: 'project' })).toBeNull()
  })
  it('refuses the rest, naming the reason', () => {
    expect(parentError('group', { kind: 'group' })).toMatch(/always top-level/)
    expect(parentError('subproject', null)).toMatch(/must sit under a project/)
    expect(parentError('subproject', { kind: 'group' })).toMatch(/that one is a group/)
    expect(parentError('project', { kind: 'project' })).toMatch(/only sit under a group/)
  })
})

describe('kindChangeError — what sits under you decides what you can become', () => {
  it('a childless row can become anything', () => {
    for (const k of ['group', 'project', 'subproject'] as ProjectKind[]) expect(kindChangeError(k, [])).toBeNull()
  })
  it('a group holding projects must stay a group; a project holding sub-projects must stay a project', () => {
    expect(kindChangeError('group', ['project', 'project'])).toBeNull()
    expect(kindChangeError('project', ['project'])).toMatch(/must stay a group/)
    expect(kindChangeError('subproject', ['subproject'])).toMatch(/cannot/)
    expect(kindChangeError('project', ['subproject'])).toBeNull()
  })
})

describe('inferKind — reading the kind off today’s tree for the migration', () => {
  it('anchors become groups, their children projects, a project’s children sub-projects, loners projects', () => {
    expect(inferKind({ parentId: null, hasChildren: true, hasOwnData: false })).toBe('group')     // NGHG
    expect(inferKind({ parentId: null, hasChildren: true, hasOwnData: true })).toBe('project')    // AB
    expect(inferKind({ parentId: null, hasChildren: false, hasOwnData: true })).toBe('project')   // SRAH
    expect(inferKind({ parentId: 'x', hasChildren: false, hasOwnData: true, parentKind: 'group' })).toBe('project')      // NGH A
    expect(inferKind({ parentId: 'x', hasChildren: false, hasOwnData: true, parentKind: 'project' })).toBe('subproject') // ABGF
  })
})

describe('tree walks', () => {
  const byId = new Map(rows.map(r => [r.id, { id: r.id, parentId: r.parentId ?? null, label: r.id.toUpperCase() }]))
  it('topOf climbs to the group; a loner is its own top', () => {
    expect(topOf('ngh-a-ce', byId)).toBe('nghg')
    expect(topOf('abgf', byId)).toBe('ab')
    expect(topOf('ab', byId)).toBe('ab')
  })
  it('descendants reaches grandchildren — the roll-up must sum them too', () => {
    expect(descendants('nghg', rows.map(r => ({ id: r.id, parentId: r.parentId ?? null }))).sort()).toEqual(['ngh-a', 'ngh-a-ce', 'ngh-b'])
    expect(descendants('abgf', rows.map(r => ({ id: r.id, parentId: r.parentId ?? null })))).toEqual([])
  })
  it('pathOf reads top-down', () => {
    expect(pathOf('ngh-a-ce', byId)).toEqual(['NGHG', 'NGH-A', 'NGH-A-CE'])
  })
})
