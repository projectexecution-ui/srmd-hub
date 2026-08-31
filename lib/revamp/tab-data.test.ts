import { describe, it, expect } from 'vitest'
import { subProjectOfLine } from './tab-data'
import { matchSubProjects } from './subproject-match'
import { PROJECT_ALIASES } from './alias-seed'

// The real strings out of procurement_tracker_state.
describe('subProjectOfLine', () => {
  it('strips the leading project name', () => {
    expect(subProjectOfLine({
      project: 'New Guest House',
      subProject: 'New Guest House - New Guest House B-Execution',
    })).toBe('New Guest House B-Execution')
  })

  // The project name appears TWICE here — only the first must go, or the
  // remainder stops matching anything.
  it('removes only the first occurrence when the name repeats', () => {
    expect(subProjectOfLine({
      project: 'P2 Stepped Terraces',
      subProject: 'P2 Stepped Terraces - P2 Stepped Terraces - Execution A-01',
    })).toBe('P2 Stepped Terraces - Execution A-01')
  })

  it('handles a sub-project that is itself a stage of the project', () => {
    expect(subProjectOfLine({
      project: 'New Guest House',
      subProject: 'New Guest House - New Guest House - Infra Work - Execution',
    })).toBe('New Guest House - Infra Work - Execution')
  })

  it('leaves the value alone when it carries no prefix', () => {
    expect(subProjectOfLine({ project: 'Admin Block', subProject: 'Something Else' }))
      .toBe('Something Else')
  })

  it('returns empty for a line with no sub-project', () => {
    expect(subProjectOfLine({ project: 'X' })).toBe('')
    expect(subProjectOfLine({})).toBe('')
  })
})

// The point of the whole exercise: indents can now reach the individual tower,
// which the project-level figures could never do.
describe('indent lines resolve to the right building', () => {
  const HUB = [
    { id: 'nghg', code: 'NGHG', name: 'NGH' },
    { id: 'ngh-a', code: 'NGH A', name: 'NGH A' },
    { id: 'ngh-b', code: 'NGH B', name: 'NGH B' },
    { id: 'ngh-infra', code: 'NGH', name: 'NGH Infra' },
    { id: 'p2-a01', code: 'P2 A01', name: 'P2 A01' },
  ]

  const resolve = (project: string, subProject: string) =>
    matchSubProjects([subProjectOfLine({ project, subProject })], HUB, PROJECT_ALIASES)[0].projectId

  it('sends an NGH A line to NGH A, not to the NGH group', () => {
    expect(resolve('New Guest House', 'New Guest House - New Guest House A-Execution')).toBe('ngh-a')
  })

  it('sends an NGH B line to NGH B', () => {
    expect(resolve('New Guest House', 'New Guest House - New Guest House B-Execution')).toBe('ngh-b')
  })

  it('sends the Infra line to NGH Infra, which is its own project', () => {
    expect(resolve('New Guest House', 'New Guest House - New Guest House - Infra Work - Execution'))
      .toBe('ngh-infra')
  })

  it('sends an A-01 line to the P2 A01 tower', () => {
    expect(resolve('P2 Stepped Terraces', 'P2 Stepped Terraces - P2 Stepped Terraces - Execution A-01'))
      .toBe('p2-a01')
  })
})
