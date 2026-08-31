import { describe, it, expect } from 'vitest'
import { descendantIds, hasChildren, childCount } from './hierarchy'

// The real NGH shape.
const NGH = [
  { id: 'ngh', parentId: null },
  { id: 'ngh-a', parentId: 'ngh' },
  { id: 'ngh-b', parentId: 'ngh' },
  { id: 'ngh-c', parentId: 'ngh' },
  { id: 'ngh-infra', parentId: 'ngh' },
  { id: 'ngh-ce', parentId: 'ngh' },
  { id: 'srah', parentId: null },
]

describe('descendantIds', () => {
  it('returns the parent and everything under it', () => {
    expect(descendantIds(NGH, 'ngh').sort()).toEqual(
      ['ngh', 'ngh-a', 'ngh-b', 'ngh-c', 'ngh-ce', 'ngh-infra'].sort(),
    )
  })

  it('always includes the project itself, so a leaf needs no special case', () => {
    expect(descendantIds(NGH, 'ngh-a')).toEqual(['ngh-a'])
    expect(descendantIds(NGH, 'srah')).toEqual(['srah'])
  })

  it('does not leak into a sibling group', () => {
    expect(descendantIds(NGH, 'ngh')).not.toContain('srah')
  })

  it('goes deeper than one level', () => {
    const deep = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ]
    expect(descendantIds(deep, 'a').sort()).toEqual(['a', 'b', 'c'])
  })

  // Bad data must not hang the request — this would be an infinite loop.
  it('survives a parent cycle', () => {
    const cyclic = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]
    expect(descendantIds(cyclic, 'x').sort()).toEqual(['x', 'y'])
  })

  it('handles a project that is not in the list at all', () => {
    expect(descendantIds(NGH, 'nowhere')).toEqual(['nowhere'])
  })
})

describe('hasChildren / childCount', () => {
  it('recognises a group', () => {
    expect(hasChildren(NGH, 'ngh')).toBe(true)
    expect(childCount(NGH, 'ngh')).toBe(5)
  })

  it('recognises a leaf', () => {
    expect(hasChildren(NGH, 'ngh-a')).toBe(false)
    expect(childCount(NGH, 'ngh-a')).toBe(0)
  })
})
