import { describe, it, expect } from 'vitest'
import { buildRevampNav, REVAMP_PRIMARY, REVAMP_OLD_SCREENS } from './nav'

const allow = (...slugs: string[]) =>
  Object.fromEntries(slugs.map(s => [s, { view: true }]))

const ADMIN = { canSeeAdmin: true }
const NOT_ADMIN = { canSeeAdmin: false }

describe('revamped left pane', () => {
  it('puts Projects directly under Dashboard — it is the main lane now', () => {
    const { primary } = buildRevampNav(allow('cost-control'), new Set(), NOT_ADMIN)
    expect(primary.map(i => i.label).slice(0, 2)).toEqual(['Dashboard', 'Projects'])
  })

  it('collapses the replaced screens into one branch rather than deleting them', () => {
    const { groups } = buildRevampNav(allow('jmr', 'schedule'), new Set(), NOT_ADMIN)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Old screens')
    expect(groups[0].items.map(i => i.label)).toEqual(['JMR', 'Schedule'])
  })

  it('drops the branch entirely when none of the old screens are visible', () => {
    const { groups } = buildRevampNav(allow('cost-control'), new Set(), NOT_ADMIN)
    expect(groups).toEqual([])
  })

  // The revamp must never widen access — same two gates as today's sidebar.
  it('hides a lane the person cannot view', () => {
    const { primary } = buildRevampNav(allow('cost-control'), new Set(), NOT_ADMIN)
    expect(primary.map(i => i.label)).not.toContain('Warehouse')
  })

  it('hides a lane whose module is switched off, even with permission', () => {
    const { primary } = buildRevampNav(
      allow('cost-control', 'warehouse'), new Set(['warehouse']), NOT_ADMIN)
    expect(primary.map(i => i.label)).not.toContain('Warehouse')
  })

  it('respects module_visibility for the old screens too', () => {
    const { groups } = buildRevampNav(allow('jmr'), new Set(['jmr']), NOT_ADMIN)
    expect(groups).toEqual([])
  })

  it('shows Admin only to someone who can see it', () => {
    expect(buildRevampNav({}, new Set(), ADMIN).primary.map(i => i.label)).toContain('Admin')
    expect(buildRevampNav({}, new Set(), NOT_ADMIN).primary.map(i => i.label)).not.toContain('Admin')
  })

  it('keeps Masters visible even though it is not built, so the plan is honest', () => {
    const masters = buildRevampNav({}, new Set(), NOT_ADMIN).primary.find(i => i.label === 'Masters')
    expect(masters).toBeDefined()
    expect(masters!.built).toBe(false)
  })

  it('is a real reduction — far fewer top-level lanes than old screens replaced', () => {
    expect(REVAMP_PRIMARY.length).toBeLessThan(REVAMP_OLD_SCREENS.length)
  })

  it('has no duplicate hrefs between the main lanes and the old branch', () => {
    const hrefs = [...REVAMP_PRIMARY, ...REVAMP_OLD_SCREENS].map(i => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
