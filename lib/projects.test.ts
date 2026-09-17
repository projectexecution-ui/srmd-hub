import { describe, it, expect } from 'vitest'
import { groupProjects, groupProjectRows, UNGROUPED } from './projects'

/** The real shape, read off the live database on 17 Sep 2026.
 *
 *  Nine projects have children. THREE of them are bins that exist only to
 *  gather the others — they are the only three rows carrying `group_label`,
 *  and between them they have no approvers, no working sheets, no bills, no
 *  BPH link and no IN4 sub-project. The other six have children AND real work
 *  of their own (Ekant Kutir 29 working sheets, New Row House Infra 41,
 *  Welcome Centre Extension 37), so they must stay pickable. */
const ROWS = [
  { id: 'nghg', code: 'NGHG', name: 'NGH', parent_project_id: null, group_label: 'NGH' },
  { id: 'nghi', code: 'NGH', name: 'NGH Infra', parent_project_id: 'nghg', group_label: null },
  { id: 'ngha', code: 'NGH A', name: 'NGH A', parent_project_id: 'nghg', group_label: null },
  { id: 'nghb', code: 'NGH B', name: 'NGH B', parent_project_id: 'nghg', group_label: null },
  { id: 'ek', code: 'EK', name: 'Ekant Kutir', parent_project_id: null, group_label: null },
  { id: 'ekce', code: 'EKCE', name: 'Ekant Kutir - Common Expenses', parent_project_id: 'ek', group_label: null },
  { id: 'wh', code: 'WH', name: 'Warehouse', parent_project_id: null, group_label: null },
]

describe('projects, arranged the way people say them', () => {
  it('marks a grouping shell as a heading and nothing else', () => {
    const o = groupProjectRows(ROWS)
    expect(o.find(x => x.id === 'nghg')!.heading).toBe(true)
    // Ekant Kutir has a child too, but it is a real project — real work is
    // booked to it, so it stays pickable.
    expect(o.find(x => x.id === 'ek')!.heading).toBe(false)
    expect(o.filter(x => x.heading).map(x => x.id)).toEqual(['nghg'])
  })

  it('still puts the children under the shell’s name', () => {
    const o = groupProjectRows(ROWS)
    expect(o.find(x => x.id === 'nghb')!.group).toBe('NGH')
    expect(o.find(x => x.id === 'ekce')!.group).toBe('Ekant Kutir')
    // A project with no parent and no children stands on its own.
    expect(o.find(x => x.id === 'wh')!.group).toBe(UNGROUPED)
  })

  it('keeps the parent first inside its own group', () => {
    const ids = groupProjectRows(ROWS).map(x => x.id)
    expect(ids.indexOf('ek')).toBeLessThan(ids.indexOf('ekce'))
    expect(ids.indexOf('nghg')).toBeLessThan(ids.indexOf('ngha'))
  })

  it('sends standalone projects to the end', () => {
    const o = groupProjectRows(ROWS)
    expect(o[o.length - 1].id).toBe('wh')
  })

  it('is not fooled by a label with only spaces in it', () => {
    const o = groupProjects([
      { id: 'a', name: 'A', parentId: null, groupLabel: '   ' },
      { id: 'b', name: 'B', parentId: 'a' },
    ])
    expect(o.find(x => x.id === 'a')!.heading).toBe(false)
  })

  it('never calls a childless project a heading, whatever its label says', () => {
    const o = groupProjects([{ id: 'a', name: 'A', parentId: null, groupLabel: 'A' }])
    expect(o[0].heading).toBe(false)
    expect(o[0].group).toBe(UNGROUPED)
  })

  it('keeps a project whose parent has been deleted rather than losing it', () => {
    const o = groupProjects([{ id: 'x', name: 'X', parentId: 'gone' }])
    expect(o).toHaveLength(1)
    expect(o[0].group).toBe(UNGROUPED)
  })
})
