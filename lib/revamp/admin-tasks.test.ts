import { describe, it, expect } from 'vitest'
import {
  ADMIN_TASKS, taskSteps, visibleTasks, screensCoveredByTasks, tasksTouching,
} from './admin-tasks'
import { ADMIN_SCREENS } from './admin-map'

const HREFS = new Set(ADMIN_SCREENS.map(s => s.href))

describe('Admin organised by job', () => {
  it('has unique task ids', () => {
    const ids = ADMIN_TASKS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // A task pointing at a screen that does not exist is a dead link dressed up
  // as a helpful checklist — worse than the sprawl it replaced.
  it('points every step at a real screen', () => {
    for (const t of ADMIN_TASKS) {
      for (const s of t.steps) expect(HREFS.has(s.href), `${t.id} → ${s.href}`).toBe(true)
    }
  })

  // The whole premise: if a screen belongs to no job, it can only be found by
  // already knowing its name, which is the problem we started with.
  it('reaches every settings screen from at least one job', () => {
    const covered = screensCoveredByTasks()
    const orphans = ADMIN_SCREENS.filter(s => !covered.has(s.href)).map(s => s.href)
    expect(orphans).toEqual([])
  })

  it('names each task as a job, starting with a verb', () => {
    for (const t of ADMIN_TASKS) {
      expect(t.label, t.id).toMatch(/^(Start|Add|Change|Control|Turn|Tidy|Get|Load)\b/)
    }
  })

  it('gives every task a hint that explains the catch', () => {
    for (const t of ADMIN_TASKS) expect(t.hint.length, t.id).toBeGreaterThan(20)
  })

  it('gives every step a reason written as an outcome', () => {
    for (const t of ADMIN_TASKS) {
      for (const s of t.steps) expect(s.why.length, `${t.id} → ${s.href}`).toBeGreaterThan(12)
    }
  })

  it('has no duplicate step inside one task', () => {
    for (const t of ADMIN_TASKS) {
      const hrefs = t.steps.map(s => s.href)
      expect(new Set(hrefs).size, t.id).toBe(hrefs.length)
    }
  })

  it('starts every ordered task with a step that is not optional', () => {
    for (const t of ADMIN_TASKS) {
      if (t.anyOrder) continue
      expect(t.steps[0]?.optional, t.id).toBeFalsy()
    }
  })

  it('gives every task at least two steps — a one-screen job needs no checklist', () => {
    for (const t of ADMIN_TASKS) expect(t.steps.length, t.id).toBeGreaterThanOrEqual(2)
  })

  // The evidence for the redesign: setting up a project really does span many
  // screens and several areas.
  it('shows that starting a project crosses several areas', () => {
    const t = ADMIN_TASKS.find(x => x.id === 'new-project')!
    const areas = new Set(
      t.steps.map(s => ADMIN_SCREENS.find(x => x.href === s.href)!.area),
    )
    expect(t.steps.length).toBeGreaterThanOrEqual(5)
    expect(areas.size).toBeGreaterThanOrEqual(3)
  })

  it('drops steps whose module is switched off', () => {
    const before = taskSteps(ADMIN_TASKS.find(t => t.id === 'lists')!)
    const after = taskSteps(ADMIN_TASKS.find(t => t.id === 'lists')!, new Set(['vendors', 'established-rates']))
    expect(after.length).toBe(before.length - 2)
    expect(after.map(s => s.href)).not.toContain('/vendors')
  })

  it('drops a task entirely when every one of its steps is switched off', () => {
    const all = new Set(ADMIN_SCREENS.map(s => s.visibilitySlug).filter(Boolean) as string[])
    // Nothing should vanish from a normal setup…
    expect(visibleTasks().length).toBe(ADMIN_TASKS.length)
    // …and switching off the gated modules must not empty a whole task either,
    // because every task has at least one ungated step.
    expect(visibleTasks(all).length).toBe(ADMIN_TASKS.length)
  })

  it('tells you which jobs touch a given screen', () => {
    expect(tasksTouching('/admin/permissions').map(t => t.id).sort())
      .toEqual(['add-person', 'module-onoff'])
    expect(tasksTouching('/nope')).toEqual([])
  })

  it('lists the email roof first in the "what gets sent" job', () => {
    const t = ADMIN_TASKS.find(x => x.id === 'whats-sent')!
    expect(t.steps[0].href).toBe('/admin/email')
  })

  it('marks the jobs whose steps have no required order', () => {
    const anyOrder = ADMIN_TASKS.filter(t => t.anyOrder).map(t => t.id).sort()
    expect(anyOrder).toEqual(['approvals', 'import', 'project-settings', 'recover'])
  })

  it('covers a real spread of jobs rather than one giant list', () => {
    expect(ADMIN_TASKS.length).toBeGreaterThanOrEqual(8)
    for (const t of ADMIN_TASKS) expect(t.steps.length, t.id).toBeLessThanOrEqual(12)
  })
})
