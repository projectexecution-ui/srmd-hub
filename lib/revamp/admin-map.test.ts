import { describe, it, expect } from 'vitest'
import { ADMIN_AREAS, ADMIN_SCREENS, screensByArea, areaCounts } from './admin-map'
import { MODULES } from '@/lib/modules'

describe('admin map', () => {
  it('has no duplicate screens', () => {
    const hrefs = ADMIN_SCREENS.map(s => s.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('files every screen under a real area', () => {
    const ids = new Set(ADMIN_AREAS.map(a => a.id))
    for (const s of ADMIN_SCREENS) expect(ids.has(s.area), s.href).toBe(true)
  })

  it('leaves no area empty', () => {
    for (const a of ADMIN_AREAS) expect(screensByArea(a.id).length, a.id).toBeGreaterThan(0)
  })

  it('accounts for every screen exactly once across the areas', () => {
    const counts = areaCounts()
    const summed = Object.values(counts).reduce((s, n) => s + n, 0)
    expect(summed).toBe(ADMIN_SCREENS.length)
  })

  it('gives every screen a hint, so no card is a bare link', () => {
    for (const s of ADMIN_SCREENS) expect(s.hint.length, s.href).toBeGreaterThan(10)
  })

  it('starts every href at the root', () => {
    for (const s of ADMIN_SCREENS) expect(s.href.startsWith('/'), s.href).toBe(true)
  })

  // The point of the exercise: most admin screens are NOT under /admin, and
  // that is exactly why 34 of them were never found.
  // A screen inside a switched-off module only produces a permission refusal,
  // which reads as a bug rather than as "that module is off".
  it('hides screens whose module is switched off', () => {
    const on = screensByArea('lists').map(s => s.href)
    expect(on).toContain('/vendors')

    const off = screensByArea('lists', new Set(['vendors', 'established-rates'])).map(s => s.href)
    expect(off).not.toContain('/vendors')
    expect(off).not.toContain('/established-rates/admin')
    expect(off).toContain('/masters')
  })

  it('gathers the screens that live inside modules', () => {
    const inModules = ADMIN_SCREENS.filter(s => !s.href.startsWith('/admin/'))
    expect(inModules.length).toBeGreaterThan(ADMIN_SCREENS.length / 2)
  })
})

// Each of these encodes a specific complaint about the first Admin: it read as
// a directory of links rather than something you could act on.
describe('the things that made Admin hard to use', () => {
  it('never lets a hint just restate the label', () => {
    for (const s of ADMIN_SCREENS) {
      expect(s.hint.toLowerCase(), s.href).not.toBe(s.label.toLowerCase())
      // "JMR items — JMR items list" tells you nothing you did not have.
      const label = s.label.toLowerCase()
      const hint = s.hint.toLowerCase()
      expect(hint.startsWith(label), s.href).toBe(false)
    }
  })

  it('keeps labels short enough to scan — five words at most', () => {
    for (const s of ADMIN_SCREENS) {
      expect(s.label.trim().split(/\s+/).length, s.href).toBeLessThanOrEqual(5)
    }
  })

  it('has no two screens with the same label', () => {
    const labels = ADMIN_SCREENS.map(s => s.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('files every screen against a module the hub actually has', () => {
    const slugs = new Set(MODULES.map(m => m.slug))
    for (const s of ADMIN_SCREENS) {
      if (!s.module) continue // portal-wide, correct
      expect(slugs.has(s.module), `${s.href} → ${s.module}`).toBe(true)
    }
  })

  it('checks visibility against a module the hub actually has', () => {
    const slugs = new Set(MODULES.map(m => m.slug))
    for (const s of ADMIN_SCREENS) {
      if (!s.visibilitySlug) continue
      expect(slugs.has(s.visibilitySlug), `${s.href} → ${s.visibilitySlug}`).toBe(true)
    }
  })

  // "System" was a junk drawer holding a third of everything. Areas only help
  // if they are roughly comparable in size.
  it('has no single area swallowing most of the screens', () => {
    for (const a of ADMIN_AREAS) {
      expect(screensByArea(a.id).length, a.id).toBeLessThan(ADMIN_SCREENS.length / 2)
    }
  })

  it('gives every area a distinct hint', () => {
    const hints = ADMIN_AREAS.map(a => a.hint)
    expect(new Set(hints).size).toBe(hints.length)
  })

  it('only marks portal-wide screens as admin-only', () => {
    for (const s of ADMIN_SCREENS) {
      if (!s.adminOnly) continue
      expect(s.module, s.href).toBe('')
    }
  })

  // The duplicate item lists are the clearest evidence that the masters need
  // consolidating — the map must keep naming them rather than smoothing it over.
  it('still shows that more than one module keeps its own item list', () => {
    const itemLists = ADMIN_SCREENS.filter(s => /items|masters/i.test(s.label))
    expect(itemLists.length).toBeGreaterThanOrEqual(3)
    const modules = new Set(itemLists.map(s => s.module))
    expect(modules.size).toBeGreaterThanOrEqual(3)
  })

  it('says plainly which item lists are the older ones', () => {
    const legacy = ADMIN_SCREENS.filter(s => /older/i.test(s.hint))
    expect(legacy.map(s => s.href).sort()).toEqual([
      '/inventory/admin/items',
      '/inventory/admin/warehouses',
    ])
  })

  it('never points two screens at the same place', () => {
    const hrefs = ADMIN_SCREENS.map(s => s.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('keeps every href free of a query string, so links stay stable', () => {
    for (const s of ADMIN_SCREENS) expect(s.href, s.href).not.toContain('?')
  })

  it('separates the email roof from the on/off switches', () => {
    const hrefs = ADMIN_SCREENS.map(s => s.href)
    expect(hrefs).toContain('/admin/email')
    expect(hrefs).toContain('/admin/notifications')
    const roof = ADMIN_SCREENS.find(s => s.href === '/admin/email')!
    expect(roof.hint).toMatch(/who receives|all modules/i)
  })

  it('counts what it claims to count', () => {
    const summed = ADMIN_AREAS.reduce((n, a) => n + screensByArea(a.id).length, 0)
    expect(summed).toBe(ADMIN_SCREENS.length)
  })

  it('shows fewer screens once the switched-off modules are removed', () => {
    const off = new Set(['vendors', 'established-rates'])
    const shown = ADMIN_AREAS.reduce((n, a) => n + screensByArea(a.id, off).length, 0)
    expect(shown).toBe(ADMIN_SCREENS.length - 2)
  })
})
