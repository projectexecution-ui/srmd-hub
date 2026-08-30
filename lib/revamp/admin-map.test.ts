import { describe, it, expect } from 'vitest'
import { ADMIN_AREAS, ADMIN_SCREENS, screensByArea, areaCounts } from './admin-map'

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
  it('gathers the screens that live inside modules', () => {
    const inModules = ADMIN_SCREENS.filter(s => !s.href.startsWith('/admin/'))
    expect(inModules.length).toBeGreaterThan(ADMIN_SCREENS.length / 2)
  })
})
