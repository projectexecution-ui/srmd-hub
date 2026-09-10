import { describe, it, expect } from 'vitest'
import { nameIndex, resolveName, shownOr, skillKey, SCOPES_FOR, type NameRow } from './names'

const row = (scope: NameRow['scope'], scope_id: string, display_name: string, key = skillKey(338)): NameRow =>
  ({ kind: 'skill', key, scope, scope_id, display_name })

const NGH_B = 'aaaaaaaa-0000-0000-0000-000000000001'
const P2 = 'aaaaaaaa-0000-0000-0000-000000000002'

describe('resolveName — project beats module beats everywhere', () => {
  const idx = nameIndex([
    row('all', '', 'Finishes'),
    row('module', 'procurement', 'Finishing (site)'),
    row('project', NGH_B, 'Interiors'),
  ])
  it('a project name wins on that project, wherever it is shown', () => {
    expect(resolveName(idx, 'skill', skillKey(338), { projectId: NGH_B, module: 'procurement' })?.display_name).toBe('Interiors')
    expect(resolveName(idx, 'skill', skillKey(338), { projectId: NGH_B, module: 'wo-po' })?.display_name).toBe('Interiors')
  })
  it('another project falls through to the module name, then everywhere', () => {
    expect(resolveName(idx, 'skill', skillKey(338), { projectId: P2, module: 'procurement' })?.display_name).toBe('Finishing (site)')
    expect(resolveName(idx, 'skill', skillKey(338), { projectId: P2, module: 'wo-po' })?.display_name).toBe('Finishes')
  })
  it('no context at all still gets the everywhere name', () => {
    expect(resolveName(idx, 'skill', skillKey(338))?.display_name).toBe('Finishes')
  })
  it('an unknown key is null, and shownOr hands back the caller’s fallback (IN4 text)', () => {
    expect(resolveName(idx, 'skill', skillKey(999), { projectId: NGH_B })).toBeNull()
    expect(shownOr(idx, 'skill', skillKey(999), { projectId: NGH_B }, 'Fire Fighting Works')).toBe('Fire Fighting Works')
  })
  it('a project-only name never leaks to other projects when there is no everywhere row', () => {
    const only = nameIndex([row('project', NGH_B, 'Interiors')])
    expect(resolveName(only, 'skill', skillKey(338), { projectId: P2 })).toBeNull()
    expect(resolveName(only, 'skill', skillKey(338), {})).toBeNull()
  })
})

describe('scopes per kind', () => {
  it('categories can be scoped three ways; tabs and pills only everywhere or per project', () => {
    expect(SCOPES_FOR.skill).toEqual(['all', 'module', 'project'])
    expect(SCOPES_FOR.tab).toEqual(['all', 'project'])
    expect(SCOPES_FOR.pill).toEqual(['all', 'project'])
  })
})
