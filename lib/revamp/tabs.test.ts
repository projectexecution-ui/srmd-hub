import { describe, it, expect, afterEach, vi } from 'vitest'
import { PROJECT_TABS, tabHref, activeTabSlug, findTab, builtCount, projectHref, visibleTabs, canOpenTab } from './tabs'

const P = '11111111-2222-3333-4444-555555555555'

// The eight real roles, exactly as role_permissions had them on 2026-09-01.
const view = (...slugs: string[]) => Object.fromEntries(slugs.map(s => [s, { view: true }]))
const ROLES = {
  head:       view('cost-control', 'contractor-report', 'bills-pipeline'),
  engineer:   view('cost-control', 'procurement-tracker'),
  contractor: view('cost-control', 'procurement-tracker'),
  admin:      view('cost-control', 'contractor-report', 'procurement-tracker', 'bills-pipeline'),
  uploader:   view('cost-control', 'contractor-report', 'procurement-tracker', 'bills-pipeline'),
  viewer:     view('cost-control', 'contractor-report', 'procurement-tracker'),
  founder:    view('cost-control', 'contractor-report', 'procurement-tracker'),
  backoffice: view('cost-control', 'contractor-report', 'procurement-tracker'),
}

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
      expect(labels, role).toEqual(expect.arrayContaining(['Budget', 'Discussions', 'Setup']))
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
    expect(labels).toEqual(['Budget', 'Indent → PO', 'Discussions'])
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
    expect(PROJECT_TABS[0].label).toBe('Budget')
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
