import { describe, it, expect, afterEach, vi } from 'vitest'
import { PROJECT_TABS, tabHref, activeTabSlug, findTab, builtCount, projectHref, visibleTabs, canOpenTab, COMING_SOON_TABS, BUILT_TABS, BLOCKED_ITEM_VIEWS } from './tabs'

const P = '11111111-2222-3333-4444-555555555555'

// The eight real roles, exactly as role_permissions had them on 2026-09-01.
const view = (...slugs: string[]) => Object.fromEntries(slugs.map(s => [s, { view: true }]))
const ROLES = {
  head:       view('cost-control', 'contractor-report', 'bills-pipeline'),
  engineer:   view('cost-control', 'procurement-tracker', 'jmr', 'warehouse'),
  contractor: view('cost-control', 'procurement-tracker'),
  admin:      view('cost-control', 'contractor-report', 'procurement-tracker', 'bills-pipeline', 'jmr', 'warehouse'),
  uploader:   view('cost-control', 'contractor-report', 'procurement-tracker', 'bills-pipeline', 'jmr', 'warehouse'),
  viewer:     view('cost-control', 'contractor-report', 'procurement-tracker'),
  founder:    view('cost-control', 'contractor-report', 'procurement-tracker'),
  backoffice: view('cost-control', 'contractor-report', 'procurement-tracker'),
}

// An admin must reach every page. If a tab is added with a permission the admin
// fixture lacks, this fails and says so — better than silently asserting less.
const ADMIN_ALL = view(...new Set(PROJECT_TABS.map(t => t.permissionSlug)))

// The mind map (docs/TEAM_PROBLEMS.md) asks for one cockpit with lanes for
// schedule, Dwg → Budget → WO, daily site entries, procurement and bills.
// Procurement and Bills exist; the other lanes are shown greyed so the plan is
// visible rather than the cockpit looking finished.
describe('coming-soon lanes', () => {
  it('carries every page from the mind map', () => {
    // Aksha's mind map, 2026-09-03: 17 pages under Projects → Project → Pages,
    // plus Setup, which is not on the map but is how a project is configured.
    expect(PROJECT_TABS).toHaveLength(18)
    for (const label of [
      'Budget vs Actual', 'Budget by WO/PO', 'Pending Approvals', 'Discussions',
      'Stake Holders', 'Drawings', 'Decisions & Specs', 'QC', 'Indents',
      'WO / POs', 'Schedules', 'JMRs', 'Material In-Out', 'Payment Reports',
      'SC Budgets', 'Reports', 'Accounts',
    ]) {
      expect(PROJECT_TABS.map(t => t.label), label).toContain(label)
    }
  })

  // These four are on the map, were already built and tested, and I had parked
  // them. Restoring one is a single row, so a test guards against it happening
  // again.
  it('has the four pages I parked back, and working', () => {
    for (const label of ['Pending Approvals', 'JMRs', 'Material In-Out', 'Schedules']) {
      expect(PROJECT_TABS.find(t => t.label === label), label).toBeDefined()
    }
    for (const label of ['Pending Approvals', 'JMRs', 'Material In-Out']) {
      expect(PROJECT_TABS.find(t => t.label === label)!.built, label).toBe(true)
    }
  })

  // "Not written yet" and "cannot be written yet" need different things from
  // Aksha — dev time versus a decision about where data comes from.
  it('separates blocked-on-data from merely unbuilt', () => {
    const blocked = PROJECT_TABS.filter(t => t.blockedBy)
    expect(blocked.map(t => t.label)).toEqual(['Payment Reports', 'Accounts'])
    for (const t of blocked) {
      expect(t.built, t.slug).toBe(false)
      expect(t.blockedBy!.length, t.slug).toBeGreaterThan(30)
    }
  })

  it('never marks a tab both blocked and built', () => {
    for (const t of PROJECT_TABS) if (t.blockedBy) expect(t.built, t.slug).toBe(false)
  })

  it('keeps every built tab before every coming-soon one', () => {
    const firstUnbuilt = PROJECT_TABS.findIndex(t => !t.built)
    expect(firstUnbuilt).toBeGreaterThan(0)
    expect(PROJECT_TABS.slice(firstUnbuilt).every(t => !t.built)).toBe(true)
  })

  it('still lands on Budget — a greyed tab never becomes the index', () => {
    expect(PROJECT_TABS[0].built).toBe(true)
    expect(PROJECT_TABS[0].slug).toBe('')
  })

  // Gating a greyed tab on its FUTURE module would hide the roadmap from
  // nearly everyone: daily-site-report is switched off portal-wide and most
  // roles have no `schedule`. It shows no data, so there is nothing to protect.
  it('gates coming-soon tabs on being in the cockpit, not on the future module', () => {
    for (const t of COMING_SOON_TABS) {
      expect(t.permissionSlug, t.slug).toBe('cost-control')
    }
  })

  it('still records which module each lane will belong to', () => {
    const withFuture = COMING_SOON_TABS.filter(t => t.futureSlug)
    // Only Schedules. The mind map folds daily site entries into "Material
    // In-Out", which is built, so there is no separate site-entries lane.
    expect(withFuture.map(t => t.futureSlug)).toEqual(['schedule'])
  })

  it('gives a lane that already has a screen somewhere a way to reach it', () => {
    for (const t of COMING_SOON_TABS) {
      if (!t.todayHref) continue
      expect(t.todayHref.startsWith('/'), t.slug).toBe(true)
      expect(t.hint, t.slug).toMatch(/today/i)
    }
  })

  it('says plainly when a lane has no screen anywhere yet', () => {
    const drawings = COMING_SOON_TABS.find(t => t.slug === 'drawings')!
    expect(drawings.todayHref).toBeUndefined()
    expect(drawings.hint).toMatch(/not captured/i)
  })

  it('shows the coming-soon lanes to every role, since they hold no data', () => {
    for (const [role, perms] of Object.entries(ROLES)) {
      const labels = visibleTabs(perms).map(t => t.label)
      for (const t of COMING_SOON_TABS) expect(labels, `${role} → ${t.label}`).toContain(t.label)
    }
  })

  it('routes every coming-soon lane, so a click is never a 404', () => {
    for (const t of COMING_SOON_TABS) {
      expect(findTab(t.slug), t.slug).toBeDefined()
      expect(activeTabSlug(`/project/${P}/${t.slug}`, P)).toBe(t.slug)
    }
  })

  it('leaves the built count honest', () => {
    const { built, total } = builtCount()
    expect(built).toBe(9)
    expect(total).toBe(18)
    expect(BUILT_TABS).toHaveLength(built)
    expect(COMING_SOON_TABS).toHaveLength(total - built)
  })

  // The deepest level of the map. Recorded as text rather than four dead tabs,
  // because all four are blocked on the same fact: 629 working sheets hold
  // summary amounts only and cc_working_sheet_items is empty.
  it('records the item-level views the map asks for and the data cannot give', () => {
    expect(BLOCKED_ITEM_VIEWS).toHaveLength(3)
    for (const v of BLOCKED_ITEM_VIEWS) expect(v).toMatch(/item wise/i)
  })
})

describe('a tab never grants what the module refuses', () => {
  // The bug this locks shut: the cockpit gated EVERY tab on cost-control,
  // which all eight roles hold. /project/<id>/reports therefore served
  // contractor and supplier billing to the two contractor accounts and the two
  // engineers, and /project/<id>/procurement served the tracker to everyone.
  it('hides Reports from engineers and contractors, who have no contractor-report', () => {
    for (const role of ['engineer', 'contractor'] as const) {
      const labels = visibleTabs(ROLES[role]).map(t => t.label)
      expect(labels, role).not.toContain('Reports')
    }
  })

  it('hides Indent → PO from the Atm Heads, who have no procurement-tracker', () => {
    expect(visibleTabs(ROLES.head).map(t => t.label)).not.toContain('Indent → PO')
  })

  it('still gives an admin every tab', () => {
    expect(visibleTabs(ROLES.admin)).toHaveLength(PROJECT_TABS.length)
  })

  it('always keeps Budget, Discussions and Setup — every role holds cost-control', () => {
    for (const [role, perms] of Object.entries(ROLES)) {
      const labels = visibleTabs(perms).map(t => t.label)
      expect(labels, role).toEqual(expect.arrayContaining(['Budget vs Actual', 'Discussions', 'Setup']))
    }
  })

  it('keeps the index tab first for everyone, so the cockpit always has a landing tab', () => {
    for (const [role, perms] of Object.entries(ROLES)) {
      expect(visibleTabs(perms)[0]?.slug, role).toBe('')
    }
  })

  it('respects the Portal Owner switch as well as the permission', () => {
    expect(visibleTabs(ROLES.admin, new Set(['contractor-report'])).map(t => t.label))
      .not.toContain('Reports')
  })

  it('canOpenTab agrees with visibleTabs for every role and tab', () => {
    for (const perms of Object.values(ROLES)) {
      const shown = new Set(visibleTabs(perms).map(t => t.slug))
      for (const t of PROJECT_TABS) expect(canOpenTab(t, perms)).toBe(shown.has(t.slug))
    }
  })

  it('refuses someone with no permissions at all', () => {
    expect(visibleTabs({})).toEqual([])
  })

  // Setup's own page redirects a non-reviewer to /cost-control. Showing the tab
  // anyway meant an engineer clicked it and was thrown clean out of the project
  // with nothing said — a silent blocker, and the tab bar went with it.
  it('hides Setup from an engineer, who is not a Cost Control reviewer', () => {
    const labels = visibleTabs(ROLES.engineer, new Set(), false).map(t => t.label)
    expect(labels).not.toContain('Setup')
    // The built tabs they may open — the greyed coming-soon lanes show to
    // everyone and are asserted separately.
    expect(labels.filter(l => BUILT_TABS.some(t => t.label === l)))
      .toEqual(['Budget vs Actual', 'Pending Approvals', 'Discussions', 'Indents', 'WO / POs', 'JMRs', 'Material In-Out'])
  })

  it('keeps Setup for a reviewer', () => {
    expect(visibleTabs(ROLES.head, new Set(), true).map(t => t.label)).toContain('Setup')
  })

  it('leaves a non-reviewer a working cockpit, not an empty one', () => {
    for (const role of ['engineer', 'contractor'] as const) {
      const tabs = visibleTabs(ROLES[role], new Set(), false)
      expect(tabs.length, role).toBeGreaterThan(0)
      expect(tabs[0].slug, role).toBe('')
    }
  })
})

describe('project cockpit tabs', () => {
  it('has exactly one index tab, and it is first', () => {
    const idx = PROJECT_TABS.filter(t => t.slug === '')
    expect(idx).toHaveLength(1)
    expect(PROJECT_TABS[0].slug).toBe('')
  })

  // Aksha's call: opening a project shows the Internal Estimate, not a summary.
  it('lands on Budget', () => {
    expect(PROJECT_TABS[0].label).toBe('Budget vs Actual')
  })

  it('has unique slugs', () => {
    const slugs = PROJECT_TABS.map(t => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  // Aksha's V1-layout rule: short labels, or the bar wraps and looks unfinished.
  it('keeps every label to 5 words or fewer', () => {
    for (const t of PROJECT_TABS) {
      expect(t.label.split(/\s+/).length, `"${t.label}"`).toBeLessThanOrEqual(5)
    }
  })

  it('gives every tab a permission slug, so the migration has a map not a guess', () => {
    for (const t of PROJECT_TABS) expect(t.permissionSlug.length).toBeGreaterThan(0)
  })

  it('builds a clean href for the index tab and for the rest', () => {
    expect(tabHref(P, PROJECT_TABS[0])).toBe(`/project/${P}`)
    expect(tabHref(P, findTab('reports')!)).toBe(`/project/${P}/reports`)
  })

  describe('activeTabSlug', () => {
    it('reports the index tab on the bare cockpit URL', () => {
      expect(activeTabSlug(`/project/${P}`, P)).toBe('')
      expect(activeTabSlug(`/project/${P}/`, P)).toBe('')
    })

    it('reports the tab actually open', () => {
      expect(activeTabSlug(`/project/${P}/procurement`, P)).toBe('procurement')
      expect(activeTabSlug(`/project/${P}/reports`, P)).toBe('reports')
    })

    // A deep link inside a tab must keep that tab lit, not fall back to Budget.
    it('stays on the tab for a nested path', () => {
      expect(activeTabSlug(`/project/${P}/reports/detail/abc`, P)).toBe('reports')
    })

    it('falls back to the index tab for an unknown segment', () => {
      expect(activeTabSlug(`/project/${P}/nonsense`, P)).toBe('')
    })

    it('falls back when the path is for a different project entirely', () => {
      expect(activeTabSlug('/cost-control/projects/xyz', P)).toBe('')
    })
  })

  // The revamp must not change where a live click lands until it is adopted.
  describe('projectHref', () => {
    afterEach(() => { vi.unstubAllEnvs() })

    it('keeps the live site on today\'s Internal Estimate page', () => {
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '')
      expect(projectHref(P)).toBe(`/cost-control/projects/${P}`)
    })

    it('sends the trial site into the new cockpit', () => {
      vi.stubEnv('VERCEL_ENV', 'preview')
      expect(projectHref(P)).toBe(`/project/${P}`)
    })

    it('defaults to today\'s page when nothing is set (local dev)', () => {
      vi.stubEnv('VERCEL_ENV', '')
      vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '')
      expect(projectHref(P)).toBe(`/cost-control/projects/${P}`)
    })
  })

  it('counts what is actually built', () => {
    const { built, total } = builtCount()
    expect(total).toBe(PROJECT_TABS.length)
    expect(built).toBe(PROJECT_TABS.filter(t => t.built).length)
    expect(built).toBeGreaterThan(0)
    expect(built).toBeLessThanOrEqual(total)
  })
})
