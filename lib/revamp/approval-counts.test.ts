import { describe, it, expect } from 'vitest'
import { tallyInbox, rollUpCounts } from './approval-counts'

describe('tallyInbox', () => {
  it('counts per project, and Cost Control separately', () => {
    const t = tallyInbox([
      { module_slug: 'cost-control', project_id: 'A' },
      { module_slug: 'cost-control', project_id: 'A' },
      { module_slug: 'cost-control', project_id: 'B' },
      { module_slug: 'jmr', project_id: 'B' },
      { module_slug: 'warehouse', project_id: null },
    ])
    expect(t.byProject).toEqual({ A: 2, B: 2 })
    expect(t.costControl).toBe(3)
    // The total is everything on their desk, including the item with no project.
    expect(t.total).toBe(5)
  })

  it('does not invent a project bucket for items that have none', () => {
    const t = tallyInbox([{ module_slug: 'warehouse', project_id: null }])
    expect(t.byProject).toEqual({})
    expect(t.total).toBe(1)
  })

  it('is all zeroes for an empty queue', () => {
    expect(tallyInbox([])).toEqual({ byProject: {}, total: 0, costControl: 0 })
  })
})

describe('rollUpCounts — a collapsed group must not read as empty', () => {
  const projects = [
    { id: 'NGH', parentId: null },
    { id: 'NGH-A', parentId: 'NGH' },
    { id: 'NGH-B', parentId: 'NGH' },
    { id: 'P2', parentId: null },
  ]

  it("adds the children's queue to the parent", () => {
    // The case that matters: nothing is waiting on the group itself, so
    // without this the collapsed NGH row would show no badge at all while two
    // of its buildings have budgets on your desk.
    const r = rollUpCounts({ 'NGH-A': 2, 'NGH-B': 1 }, projects)
    expect(r['NGH']).toBe(3)
    expect(r['NGH-A']).toBe(2)
    expect(r['NGH-B']).toBe(1)
  })

  it("keeps the parent's own items and adds the children on top", () => {
    const r = rollUpCounts({ 'NGH': 1, 'NGH-A': 2 }, projects)
    expect(r['NGH']).toBe(3)
  })

  it('leaves a top-level project with no children alone', () => {
    const r = rollUpCounts({ P2: 4 }, projects)
    expect(r['P2']).toBe(4)
  })

  it('adds nothing for a child with an empty queue', () => {
    const r = rollUpCounts({ 'NGH-A': 0 }, projects)
    expect(r['NGH']).toBeUndefined()
  })

  it('does not mutate what it was given', () => {
    const src = { 'NGH-A': 2 }
    rollUpCounts(src, projects)
    expect(src).toEqual({ 'NGH-A': 2 })
  })

  it('ignores a child whose parent is not in the list', () => {
    const r = rollUpCounts({ orphan: 3 }, [{ id: 'orphan', parentId: 'gone' }])
    expect(r['orphan']).toBe(3)
    // The missing parent gets a bucket rather than throwing; it is never rendered.
    expect(r['gone']).toBe(3)
  })
})
