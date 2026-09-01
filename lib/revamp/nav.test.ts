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

  // Two branches on purpose: "we moved this into the project" and "we parked
  // this" are different messages. A module people still open must not be
  // filed under "old".
  it('separates screens the cockpit replaced from ones simply parked', () => {
    const { groups } = buildRevampNav(
      allow('budget', 'jmr', 'schedule', 'warehouse'), new Set(), NOT_ADMIN)
    const byName = Object.fromEntries(groups.map(g => [g.name, g.items.map(i => i.label)]))
    expect(byName['Now inside a project']).toEqual(['Budget (BPH)'])
    expect(byName['Not in the revamp']).toEqual(['Warehouse', 'Schedule', 'JMR'])
  })

  it('drops a branch entirely when none of its screens are visible', () => {
    const { groups } = buildRevampNav(allow('cost-control'), new Set(), NOT_ADMIN)
    expect(groups).toEqual([])
  })

  // Warehouse and Schedule were cut from the main lanes on 2026-08-31 —
  // reachable, but no longer competing with Projects for attention.
  it('keeps Warehouse and Schedule out of the top-level lanes', () => {
    const { primary } = buildRevampNav(
      allow('cost-control', 'warehouse', 'schedule'), new Set(), NOT_ADMIN)
    expect(primary.map(i => i.label)).not.toContain('Warehouse')
    expect(primary.map(i => i.label)).not.toContain('Schedule')
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

  // Every Masters page calls requirePermission('cost-control'), so an ungated
  // lane offered a link that then refused whoever clicked it.
  it('gates Masters on cost-control, matching what its pages require', () => {
    const withPerm = buildRevampNav(allow('cost-control'), new Set(), NOT_ADMIN)
    expect(withPerm.primary.map(i => i.label)).toContain('Masters')

    const without = buildRevampNav({}, new Set(), NOT_ADMIN)
    expect(without.primary.map(i => i.label)).not.toContain('Masters')
  })

  it('is a real reduction — far fewer top-level lanes than old screens replaced', () => {
    expect(REVAMP_PRIMARY.length).toBeLessThan(REVAMP_OLD_SCREENS.length)
  })

  it('has no duplicate hrefs between the main lanes and the old branch', () => {
    const hrefs = [...REVAMP_PRIMARY, ...REVAMP_OLD_SCREENS].map(i => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
