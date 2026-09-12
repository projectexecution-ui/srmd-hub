import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_TABS, RIBBON_GROUPS, ABSORBED, SETUP_TAB,
  findWorkspaceTab, activeWorkspaceSlug, activeSubTab, workspaceHref,
  visibleWorkspaceTabs, ribbonFor, unroutedSlugs,
} from './workspace'

const ALL_VIEW = new Proxy({}, { get: () => ({ view: true }) }) as Record<string, { view: boolean }>

// Twelve since 10 Sep 2026: Material, JMR and Schedule left with their modules (clean-up round 1).
describe('the ribbon is twelve tabs in five groups', () => {
  it('has exactly twelve', () => {
    expect(WORKSPACE_TABS).toHaveLength(12)
  })

  // 4 · 2 · 1 · 3 · 2 since 12 Sep 2026: Decisions & Specifications joined
  // Documents (a specification is a document), and Consultants left People to
  // become a group inside Stakeholders. The ribbon stays at twelve.
  it('groups them 4 · 2 · 1 · 3 · 2', () => {
    const counts = RIBBON_GROUPS.map(g => WORKSPACE_TABS.filter(t => t.group === g.id).length)
    expect(counts).toEqual([4, 2, 1, 3, 2])
  })

  it('puts every tab in a declared group', () => {
    const ids = new Set(RIBBON_GROUPS.map(g => g.id))
    expect(WORKSPACE_TABS.every(t => ids.has(t.group))).toBe(true)
  })

  it('gives each tab a unique slug, with Budget as the index', () => {
    const slugs = WORKSPACE_TABS.map(t => t.slug)
    expect(new Set(slugs).size).toBe(12)
    expect(slugs[0]).toBe('')
  })

  it('gives every tab at least one sub-tab — two levels, never three', () => {
    // Accounts is the one exception: one screen of four sections, no pills.
    expect(WORKSPACE_TABS.every(t => t.slug === 'accounts' || t.subs.length >= 2)).toBe(true)
    expect(WORKSPACE_TABS.every(t => t.subs.every(s => s.trim().length > 0))).toBe(true)
  })

  it('opens Budget on the category view — short pill names, long name as the heading (UX 10)', () => {
    // "By CT" was the third pill until 9 Sep 2026 — removed as of no use.
    expect(WORKSPACE_TABS[0].subs).toEqual(['By category', 'By order'])
  })

  it('names a slug the cockpit can actually route', () => {
    expect(unroutedSlugs()).toEqual([])
  })

  it('keeps ribbon labels short enough not to wrap', () => {
    expect(WORKSPACE_TABS.every(t => t.ribbon.length <= 12)).toBe(true)
  })
})

describe('permissions still decide what is shown', () => {
  it('hides a tab whose module the role cannot view', () => {
    const perms = { 'cost-control': { view: true } }
    const tabs = visibleWorkspaceTabs(perms, new Set(), false)
    expect(tabs.map(t => t.slug)).not.toContain('procurement') // needs procurement-tracker
    expect(tabs.map(t => t.slug)).not.toContain('reports')   // needs contractor-report
    expect(tabs.map(t => t.slug)).toContain('')              // Budget
  })

  it('hides SC Budget from anyone without budget-vs-actual-v2', () => {
    const tabs = visibleWorkspaceTabs({ 'cost-control': { view: true } }, new Set(), true)
    expect(tabs.map(t => t.slug)).not.toContain('sc-budgets')
  })

  it('hides a tab whose module is switched off portal-wide', () => {
    const tabs = visibleWorkspaceTabs(ALL_VIEW, new Set(['contractor-report']), true)
    expect(tabs.map(t => t.slug)).not.toContain('reports')
  })

  it('keeps unbuilt tabs visible — they are the roadmap, and carry no data', () => {
    const tabs = visibleWorkspaceTabs({ 'cost-control': { view: true } }, new Set(), false)
    expect(tabs.map(t => t.slug)).toEqual(expect.arrayContaining(['qc', 'drawings']))
    // Accounts is built and reviewer-only now, so a non-reviewer does not see it.
    expect(tabs.map(t => t.slug)).not.toContain('accounts')
  })

  it('shows all twelve to someone who holds everything', () => {
    expect(visibleWorkspaceTabs(ALL_VIEW, new Set(), true)).toHaveLength(12)
  })

  it('never lets an unbuilt tab be gated on a module that is off', () => {
    // An unbuilt tab is gated on cost-control, so switching off (say) the tracker
    // must not make the roadmap vanish.
    const tabs = visibleWorkspaceTabs(ALL_VIEW, new Set(['procurement-tracker']), true)
    expect(tabs.map(t => t.slug)).toContain('qc')             // unbuilt → still shown
    expect(tabs.map(t => t.slug)).not.toContain('procurement') // built → follows its module
  })
})

describe('Setup is reachable but not one of the fifteen', () => {
  it('is not in the ribbon', () => {
    expect(WORKSPACE_TABS.map(t => t.slug)).not.toContain('setup')
  })

  it('still resolves by slug', () => {
    expect(findWorkspaceTab('setup')).toBe(SETUP_TAB)
  })

  it('needs reviewer standing', () => {
    expect(SETUP_TAB.reviewerOnly).toBe(true)
  })
})

describe('routing', () => {
  const P = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('reads the active tab off the path', () => {
    expect(activeWorkspaceSlug(`/project/${P}`, P)).toBe('')
    expect(activeWorkspaceSlug(`/project/${P}/jmr`, P)).toBe('jmr')
    expect(activeWorkspaceSlug(`/project/${P}/wo-po/anything`, P)).toBe('wo-po')
  })

  it('returns the index for a path outside this project', () => {
    expect(activeWorkspaceSlug('/dashboard', P)).toBe('')
  })

  it('keeps the cockpit URL clean on the index tab', () => {
    expect(workspaceHref(P, WORKSPACE_TABS[0])).toBe(`/project/${P}`)
    expect(workspaceHref(P, WORKSPACE_TABS[0], 0)).toBe(`/project/${P}`)
    expect(workspaceHref(P, WORKSPACE_TABS[0], 2)).toBe(`/project/${P}?view=2`)
  })

  it('clamps a nonsense ?view= to the first sub-tab', () => {
    const budget = WORKSPACE_TABS[0]
    expect(activeSubTab(budget, '1')).toBe(1)
    expect(activeSubTab(budget, '99')).toBe(0)
    expect(activeSubTab(budget, 'banana')).toBe(0)
    expect(activeSubTab(budget, undefined)).toBe(0)
    expect(activeSubTab(budget, '-1')).toBe(0)
  })

  it('sends every absorbed old tab somewhere real', () => {
    for (const [from, to] of Object.entries(ABSORBED)) {
      const tab = findWorkspaceTab(to.slug)
      expect(tab, `${from} → ${to.slug}`).toBeDefined()
      expect(to.sub).toBeLessThan(Math.max(1, tab!.subs.length))
    }
  })
})

describe('ribbonFor', () => {
  it('drops a group whose tabs are all hidden', () => {
    const tabs = visibleWorkspaceTabs({ 'procurement-tracker': { view: true }, 'cost-control': { view: false } }, new Set(), false)
    const groups = ribbonFor(tabs)
    expect(groups.map(g => g.id)).toEqual(['procurement'])
  })

  it('keeps the declared group order', () => {
    expect(ribbonFor(WORKSPACE_TABS).map(g => g.id))
      .toEqual(['money', 'procurement', 'site', 'documents', 'people'])
  })
})
