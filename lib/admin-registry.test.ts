import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_SCREENS, ADMIN_AREAS, screensFor, allScreens } from './admin-registry'
import { MODULES } from './modules'

const APP = join(__dirname, '..', 'app', '(app)')

describe('admin registry', () => {
  it('every screen points at a route that exists', () => {
    for (const s of ADMIN_SCREENS) {
      const dir = join(APP, ...s.href.split('/').filter(Boolean))
      expect(existsSync(join(dir, 'page.tsx')), `${s.href} has no page.tsx`).toBe(true)
    }
  })
  it('every module named is a real module slug', () => {
    const slugs = new Set(MODULES.map(m => m.slug))
    for (const s of ADMIN_SCREENS) if (s.module) expect(slugs.has(s.module), `${s.href}: unknown module ${s.module}`).toBe(true)
  })
  it('hrefs are unique and every area is used', () => {
    expect(new Set(ADMIN_SCREENS.map(s => s.href)).size).toBe(ADMIN_SCREENS.length)
    for (const a of ADMIN_AREAS) expect(ADMIN_SCREENS.some(s => s.area === a.id), `area ${a.id} is empty`).toBe(true)
  })
  it('hides screens of switched-off modules and owner-only screens for non-owners', () => {
    const off = new Set(['jmr'])
    const forAdmin = allScreens({ disabled: off, portalOwner: false })
    expect(forAdmin.some(s => s.module === 'jmr')).toBe(false)
    expect(forAdmin.some(s => s.ownerOnly)).toBe(false)
    expect(screensFor('system', { disabled: new Set(), portalOwner: true }).some(s => s.href === '/admin/dashboard-modules')).toBe(true)
  })
})
