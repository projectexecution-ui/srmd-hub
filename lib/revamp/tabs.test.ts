import { describe, it, expect, afterEach, vi } from 'vitest'
import { PROJECT_TABS, tabHref, activeTabSlug, findTab, builtCount, projectHref } from './tabs'

const P = '11111111-2222-3333-4444-555555555555'

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
