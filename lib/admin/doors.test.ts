import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DOORS, canOpen, visibleDoors, visibleTabs, resolveTab, legacyTarget, legacyPaths, searchTabs, tabHref, type Viewer,
} from './doors'

const APP = join(__dirname, '..', '..', 'app', '(app)')
const routeExists = (href: string) => existsSync(join(APP, ...href.split('?')[0].split('/').filter(Boolean), 'page.tsx'))

const OWNER: Viewer = { admin: true, owner: true, settingsView: true, ccAdmin: true, ccView: true, intake: true }
const ADMIN: Viewer = { admin: true, owner: false, settingsView: true, ccAdmin: true, ccView: true, intake: true }
const TRUSTEE: Viewer = { admin: false, owner: false, settingsView: true, ccAdmin: true, ccView: true, intake: false }   // founder today
const BACKOFFICE: Viewer = { admin: false, owner: false, settingsView: true, ccAdmin: false, ccView: true, intake: false }
const ENGINEER: Viewer = { admin: false, owner: false, settingsView: false, ccAdmin: false, ccView: true, intake: false }
const NOBODY: Viewer = { admin: false, owner: false, settingsView: false, ccAdmin: false, ccView: false, intake: false }
/** Parimal: an uploader named under People › Powers › Bring in from IN4. */
const PARIMAL: Viewer = { admin: false, owner: false, settingsView: false, ccAdmin: false, ccView: true, intake: true }

describe('one list', () => {
  it('is five doors, each with a route, and every tab id is unique within its door', () => {
    expect(DOORS.map(d => d.id)).toEqual(['people', 'projects', 'messages', 'data', 'hub'])
    for (const d of DOORS) {
      expect(routeExists(d.href), `${d.href} has no page.tsx`).toBe(true)
      expect(new Set(d.tabs.map(t => t.id)).size).toBe(d.tabs.length)
    }
  })
  it('no two tabs share a label — one name per screen', () => {
    const labels = DOORS.flatMap(d => d.tabs.map(t => t.label))
    expect(new Set(labels).size).toBe(labels.length)
    // The names that used to differ between the two homes are settled.
    expect(labels).toContain('Internal Estimate settings')
    expect(labels).not.toContain('Cost Control settings')
    expect(labels).not.toContain('Notification switches')
  })
  it('every old address still has a route file, so no bookmark breaks', () => {
    const olds = legacyPaths()
    expect(new Set(olds).size).toBe(olds.length)
    for (const p of olds) expect(routeExists(p), `${p} has no page.tsx`).toBe(true)
  })
  it('legacyTarget sends each old address to its tab, and leaves the rest alone', () => {
    expect(legacyTarget('/admin/users')).toBe('/admin/people?tab=accounts')
    expect(legacyTarget('/admin/email')).toBe('/admin/messages?tab=recipients')
    expect(legacyTarget('/admin/notifications/recipients')).toBe('/admin/messages?tab=recipients')
    expect(legacyTarget('/admin/recycle-bin?x=1')).toBe('/admin/data?tab=deleted')
    expect(legacyTarget('/admin/settings')).toBe('/admin/hub?tab=general')
    expect(legacyTarget('/cost-control/settings')).toBeNull()
  })
})

describe('gates never widen access', () => {
  it('owner sees everything; admin sees everything but Modules on / off', () => {
    const all = DOORS.flatMap(d => d.tabs).length
    expect(visibleDoors(OWNER).flatMap(d => visibleTabs(d, OWNER)).length).toBe(all)
    const admin = visibleDoors(ADMIN).flatMap(d => visibleTabs(d, ADMIN)).map(t => t.id)
    expect(admin).not.toContain('modules')
    expect(admin.length).toBe(all - 1)
  })
  it('the Trustee (settings view + cost-control admin) gets reports, health, IN4, imports, masters and the estimate settings — not People', () => {
    const ids = visibleDoors(TRUSTEE).flatMap(d => visibleTabs(d, TRUSTEE)).map(t => t.id).sort()
    expect(ids).toEqual(['estimate', 'health', 'imports', 'in4', 'masters', 'scheduled'])
    expect(visibleDoors(TRUSTEE).map(d => d.id)).not.toContain('people')
  })
  it('Back Office (settings view only) gets reports, health, IN4 and masters', () => {
    const ids = visibleDoors(BACKOFFICE).flatMap(d => visibleTabs(d, BACKOFFICE)).map(t => t.id).sort()
    expect(ids).toEqual(['health', 'in4', 'masters', 'scheduled'])
  })
  it('Parimal gets From IN4 and Masters — the named grant, not his role, opens the intake', () => {
    expect(visibleDoors(PARIMAL).flatMap(d => visibleTabs(d, PARIMAL)).map(t => t.id).sort()).toEqual(['intake', 'masters'])
  })
  it('an engineer gets Masters and nothing else; a viewer with nothing gets no door', () => {
    expect(visibleDoors(ENGINEER).flatMap(d => visibleTabs(d, ENGINEER)).map(t => t.id)).toEqual(['masters'])
    expect(visibleDoors(NOBODY)).toEqual([])
  })
  it('canOpen — owner is the only gate an admin fails', () => {
    expect(canOpen('owner', ADMIN)).toBe(false)
    expect(canOpen('admin', ADMIN)).toBe(true)
    expect(canOpen('settings-view', BACKOFFICE)).toBe(true)
    expect(canOpen('cc-admin', BACKOFFICE)).toBe(false)
  })
})

describe('resolveTab and search', () => {
  const data = DOORS.find(d => d.id === 'data')!
  it('lands on the asked-for tab when it opens, else the first that does, else nothing', () => {
    expect(resolveTab(data, 'deleted', ADMIN)?.id).toBe('deleted')
    expect(resolveTab(data, 'deleted', BACKOFFICE)?.id).toBe('in4')     // asked for a tab they cannot open
    expect(resolveTab(data, 'nonsense', ENGINEER)?.id).toBe('masters')
    expect(resolveTab(data, undefined, NOBODY)).toBeNull()
  })
  it('search matches label, hint or door name and respects the gates', () => {
    expect(searchTabs('desk', OWNER).map(h => h.tab.id)).toContain('desks')
    expect(searchTabs('projects', OWNER).map(h => h.tab.id)).toContain('signing')   // door name matches too
    expect(searchTabs('recycle', OWNER).map(h => h.href)).toEqual([tabHref('data', 'deleted')])
    expect(searchTabs('recycle', BACKOFFICE)).toEqual([])
    expect(searchTabs('', OWNER).length).toBe(DOORS.flatMap(d => d.tabs).length)
  })
})
