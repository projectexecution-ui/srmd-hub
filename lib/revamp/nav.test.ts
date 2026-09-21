import { describe, it, expect } from 'vitest'
import { buildRevampNav, REVAMP_PRIMARY, REVAMP_OLD_SCREENS, oldScreensFor } from './nav'
import { MODULES } from '@/lib/modules'

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
  // A lane gated on a slug no module owns can never appear, because no role can
  // hold a permission for something that is not in the registry. 'budget' was
  // exactly that: the href is /budget, but the module slug is
  // 'budget-vs-actual', so the Budget (BPH) lane was invisible to everyone.
  it('gates every lane on a slug that a module actually owns', () => {
    const real = new Set(MODULES.map(m => m.slug))
    for (const item of [...REVAMP_PRIMARY, ...REVAMP_OLD_SCREENS]) {
      if (!item.slug) continue
      expect(real.has(item.slug), `${item.href} → ${item.slug}`).toBe(true)
    }
  })

  it('puts nothing under the five lanes — old screens are not in the pane since go-live', () => {
    const { groups } = buildRevampNav(
      allow('budget-vs-actual', 'jmr', 'schedule', 'warehouse'), new Set(), NOT_ADMIN)
    expect(groups).toEqual([])
  })

  it('lists the old screens a person may still open, for the Admin fold', () => {
    const labels = oldScreensFor(allow('procurement-tracker', 'stuck-bills'), new Set()).map(i => i.label)
    expect(labels).toEqual(['Indent → PO', 'Stuck Bills'])
    // A switched-off module drops out even when the role holds it.
    expect(oldScreensFor(allow('stuck-bills'), new Set(['stuck-bills']))).toEqual([])
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

  // Stores joined on 13 Sep 2026 — Material In & Out. Bills Approval joined on
  // 14 Sep 2026, out of REVAMP_PARKED: it stopped being a two-record module and
  // became the section over IN4's live certificate ledger. Both are admin-only,
  // so most people still see five.
  it('is eight lanes — Dashboard, Projects, Bills, Accounts, Stores, Bills Approval, Masters, Admin', () => {
    // Nine since 21 Sep 2026: OLD INDENT TO PO, which only Aksha ever sees.
    expect(REVAMP_PRIMARY.map(i => i.label)).toEqual(['Dashboard', 'Projects', 'Bills', 'Accounts', 'Stores', 'OLD INDENT TO PO', 'Bills Approval', 'Masters', 'Admin'])
    expect(REVAMP_OLD_SCREENS.length).toBeGreaterThan(0)
  })

  // The pages inside Bills Approval all call requirePermission(…, 'admin'),
  // and four roles hold plain `view` on the slug today. A lane gated on view
  // would be a door that refuses whoever opens it.
  it('shows Bills Approval on can_admin only, never on can_view', () => {
    const labels = (perm: Record<string, { view?: boolean; admin?: boolean }>) =>
      buildRevampNav(perm, new Set(), ADMIN).primary.map(i => i.label)
    expect(labels({ 'bills-booking': { view: true, admin: true } })).toContain('Bills Approval')
    expect(labels({ 'bills-booking': { view: true } })).not.toContain('Bills Approval')
    expect(labels({})).not.toContain('Bills Approval')
    // …and the module switch still wins over the permission.
    expect(buildRevampNav({ 'bills-booking': { view: true, admin: true } }, new Set(['bills-booking']), ADMIN)
      .primary.map(i => i.label)).not.toContain('Bills Approval')
  })

  it('hides Stores from everyone but the reviewer, including a portal admin who was not flagged', () => {
    const seen = (opts: { canSeeAdmin: boolean; canSeeStores?: boolean }) =>
      buildRevampNav(allow('cost-control'), new Set(), opts).primary.map(i => i.label)
    expect(seen({ canSeeAdmin: true })).not.toContain('Stores')
    expect(seen({ canSeeAdmin: false, canSeeStores: true })).toContain('Stores')
  })

  // Accounts is a named list in settings, not a role — four people hold
  // `head` and only one of them may see it. Absent rather than greyed: a
  // greyed lane still announces that the report exists.
  it('hides Accounts from anyone not on the list, whatever their permissions', () => {
    const { primary } = buildRevampNav(allow('cost-control'), new Set(), NOT_ADMIN)
    expect(primary.map(i => i.label)).not.toContain('Accounts')
  })

  it('shows Accounts to someone on the list', () => {
    const { primary } = buildRevampNav(allow('cost-control'), new Set(), { ...NOT_ADMIN, canSeeAccounts: true })
    expect(primary.map(i => i.label)).toContain('Accounts')
  })

  // Being an admin of the PORTAL is a different thing from being on the
  // Accounts list; one must not imply the other in the pane.
  it('does not let admin rights alone open the Accounts lane', () => {
    const { primary } = buildRevampNav(allow('cost-control'), new Set(), ADMIN)
    expect(primary.map(i => i.label)).not.toContain('Accounts')
  })

  // The lane still needs cost-control view, like every other gated lane.
  it('still refuses Accounts when cost-control itself is switched off', () => {
    const { primary } = buildRevampNav(allow('cost-control'), new Set(['cost-control']), { ...NOT_ADMIN, canSeeAccounts: true })
    expect(primary.map(i => i.label)).not.toContain('Accounts')
  })

  it('has no duplicate hrefs between the main lanes and the old branch', () => {
    const hrefs = [...REVAMP_PRIMARY, ...REVAMP_OLD_SCREENS].map(i => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

/**
 * OLD INDENT TO PO — restored 21 Sep 2026 because Aksha missed it: "it was
 * very helpful for me to check all Projects in one screen ... can u make which
 * is only visible to me only".
 *
 * "Only visible to me" is the whole requirement, so it gets its own tests: the
 * lane must be absent for everybody else, and absent is not the same as
 * greyed — a greyed lane still announces that the screen exists.
 */
describe('OLD INDENT TO PO is his alone', () => {
  const labels = (opts: Parameters<typeof buildRevampNav>[2]) =>
    buildRevampNav({}, new Set(), opts).primary.map(i => i.label)

  it('appears only when the flag says so', () => {
    expect(labels({ canSeeAdmin: true, canSeeOldIndent: true })).toContain('OLD INDENT TO PO')
    expect(labels({ canSeeAdmin: true })).not.toContain('OLD INDENT TO PO')
    expect(labels({ canSeeAdmin: true, canSeeOldIndent: false })).not.toContain('OLD INDENT TO PO')
  })

  it('is off unless asked for — a missing flag never opens a lane', () => {
    // undefined must read as "no", not as "not specified, so allow".
    expect(labels({ canSeeAdmin: false })).not.toContain('OLD INDENT TO PO')
  })

  it('does not drag the live tracker out of the old-screens fold', () => {
    // The restored V1 sits beside /procurement-tracker, it does not replace it.
    expect(REVAMP_OLD_SCREENS.map(i => i.href)).toContain('/procurement-tracker')
    expect(REVAMP_PRIMARY.map(i => i.href)).not.toContain('/procurement-tracker')
  })
})
