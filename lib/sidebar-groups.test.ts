import { describe, it, expect } from 'vitest'
import { buildNavTree, parseSidebarGroups } from './sidebar-groups'

const links = [
  { slug: 'a', href: '/a' }, { slug: 'b', href: '/b' }, { slug: 'c', href: '/c' }, { slug: null, href: '/dash' },
]

describe('buildNavTree', () => {
  it('is flat when there are no groups', () => {
    const t = buildNavTree(links, [])
    expect(t.groups).toHaveLength(0)
    expect(t.ungrouped.map(l => l.href)).toEqual(['/a', '/b', '/c', '/dash'])
  })

  it('a group claims its members; ungrouped keeps original order', () => {
    const t = buildNavTree(links, [{ id: 'g1', name: 'G1', slugs: ['b'] }])
    expect(t.groups[0].items.map(l => l.slug)).toEqual(['b'])
    expect(t.ungrouped.map(l => l.slug)).toEqual(['a', 'c', null])
  })

  it('single membership — the first group to list a slug wins', () => {
    const t = buildNavTree(links, [
      { id: 'g1', name: 'G1', slugs: ['a'] },
      { id: 'g2', name: 'G2', slugs: ['a', 'c'] },
    ])
    expect(t.groups[0].items.map(l => l.slug)).toEqual(['a'])
    expect(t.groups[1].items.map(l => l.slug)).toEqual(['c'])
  })

  it('drops a group with no visible members (never hides access)', () => {
    const t = buildNavTree(links, [{ id: 'g1', name: 'G1', slugs: ['not-visible'] }])
    expect(t.groups).toHaveLength(0)
    expect(t.ungrouped).toHaveLength(4)
  })
})

describe('parseSidebarGroups', () => {
  it('parses a JSON string and sanitises entries', () => {
    const g = parseSidebarGroups(JSON.stringify([
      { id: 'x', name: 'X', slugs: ['a', 'b'] },
      { name: '', slugs: [] },     // no name → dropped
      { name: 'Y' },               // no slugs → []
    ]))
    expect(g).toHaveLength(2)
    expect(g[0]).toEqual({ id: 'x', name: 'X', slugs: ['a', 'b'] })
    expect(g[1].name).toBe('Y')
    expect(g[1].slugs).toEqual([])
  })

  it('bad input yields an empty list', () => {
    expect(parseSidebarGroups('not json')).toEqual([])
    expect(parseSidebarGroups(null)).toEqual([])
    expect(parseSidebarGroups(42)).toEqual([])
  })
})
