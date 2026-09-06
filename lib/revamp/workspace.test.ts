import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_TABS, RIBBON_GROUPS, ABSORBED, SETUP_TAB,
  findWorkspaceTab, activeWorkspaceSlug, activeSubTab, workspaceHref,
  visibleWorkspaceTabs, ribbonFor, unroutedSlugs,
} from './workspace'

const ALL_VIEW = new Proxy({}, { get: () => ({ view: true }) }) as Record<string, { view: boolean }>

describe('the ribbon is fifteen tabs in five groups', () => {
  it('has exactly fifteen', () => {
    expect(WORKSPACE_TABS).toHaveLength(15)
  })

  it('groups them 4 · 3 · 3 · 2 · 3', () => {
    const counts = RIBBON_GROUPS.map(g => WORKSPACE_TABS.filter(t => t.group === g.id).length)
    expect(counts).toEqual([4, 3, 3, 2, 3])
  })

  it('puts every tab in a declared group', () => {
    const ids = new Set(RIBBON_GROUPS.map(g => g.id))
    expect(WORKSPACE_TABS.every(t => ids.has(t.group))).toBe(true)
  })

  it('gives each tab a unique slug, with Budget as the index', () => {
    const slugs = WORKSPACE_TABS.map(t => t.slug)
    expect(new Set(slugs).size).toBe(15)
    expect(slugs[0]).toBe('')
  })

  it('gives every tab at least one sub-tab — two levels, never three', () => {
    expect(WORKSPACE_TABS.every(t => t.subs.length >= 2)).toBe(true)
    expect(WORKSPACE_TABS.every(t => t.subs.every(s => s.trim().length > 0))).toBe(true)
  })

  it('opens Budget on Category / sub-category wise', () => {
    expect(WORKSPACE_TABS[0].subs[0]).toBe('Category / sub-category wise')
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
    expect(tabs.map(t => t.slug)).not.toContain('jmr')       // needs jmr
    expect(tabs.map(t => t.slug)).not.toContain('reports')   // needs contractor-report
    expect(tabs.map(t => t.slug)).toContain('')              // Budget
  })

  it('hides SC Budget from anyone without budget-vs-actual-v2', () => {
    const tabs = visibleWorkspaceTabs({ 'cost-control': { view: true } }, new Set(), true)
    expect(tabs.map(t => t.slug)).not.toContain('sc-budgets')
  })

  it('hides a tab whose module is switched off portal-wide', () => {
    const tabs = visibleWorkspaceTabs(ALL_VIEW, new Set(['warehouse']), true)
    expect(tabs.map(t => t.slug)).not.toContain('material')
  })

  it('keeps unbuilt tabs visible — they are the roadmap, and carry no data', () => {
    const tabs = visibleWorkspaceTabs({ 'cost-control': { view: true } }, new Set(), false)
    expect(tabs.map(t => t.slug)).toEqual(expect.arrayContaining(['qc', 'drawings', 'accounts']))
  })

  it('shows all fifteen to someone who holds everything', () => {
    expect(visibleWorkspaceTabs(ALL_VIEW, new Set(), true)).toHaveLength(15)
  })

  it('never lets an unbuilt tab be gated on a module that is off', () => {
    // An unbuilt tab is gated on cost-control, so switching off (say) schedule
    // must not make the roadmap vanish.
    const tabs = visibleWorkspaceTabs(ALL_VIEW, new Set(['schedule', 'jmr']), true)
    expect(tabs.map(t => t.slug)).toContain('schedule')  // unbuilt → still shown
    expect(tabs.map(t => t.slug)).not.toContain('jmr')   // built → follows its module
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
      expect(to.sub).toBeLessThan(tab!.subs.length)
    }
  })
})

describe('ribbonFor', () => {
  it('drops a group whose tabs are all hidden', () => {
    const tabs = visibleWorkspaceTabs({ 'jmr': { view: true }, 'cost-control': { view: false } }, new Set(), false)
    const groups = ribbonFor(tabs)
    expect(groups.map(g => g.id)).toEqual(['site'])
  })

  it('keeps the declared group order', () => {
    expect(ribbonFor(WORKSPACE_TABS).map(g => g.id))
      .toEqual(['money', 'procurement', 'site', 'documents', 'people'])
  })
})
