import { describe, it, expect } from 'vitest'
import { checkHealth, type HealthInputs } from './admin-health'

// The real shape of the setup, read from the live database on 2026-09-02.
const LIVE: HealthInputs = {
  projects: 41,
  projectsNoArea: 25,
  projectsNoApprover: 3,
  rolesWithPermissions: 16,
  rolesInUse: 8,
  silentMessages: [
    { key: 'wh_request_raised', label: 'Warehouse — material request needs approval', href: '/admin/notifications' },
    { key: 'wh_request_decided', label: 'Warehouse — your request was approved or turned down', href: '/admin/notifications' },
    { key: 'wh_request_to_issue', label: 'Warehouse — approved request ready to hand over', href: '/admin/notifications' },
    { key: 'jmr_weekly_report', label: 'JMR — weekly report', href: '/jmr/admin' },
    { key: 'inventory_daily_report', label: 'Inventory — daily report', href: '/inventory/settings' },
  ],
}

const CLEAN: HealthInputs = {
  projects: 41, projectsNoArea: 0, projectsNoApprover: 0,
  rolesWithPermissions: 8, rolesInUse: 8, silentMessages: [],
}

const ids = (i: HealthInputs) => checkHealth(i).map(f => f.id)

describe('what Admin says is wrong', () => {
  it('says nothing when nothing is wrong', () => {
    expect(checkHealth(CLEAN)).toEqual([])
  })

  it('finds all four problems in the live setup', () => {
    expect(ids(LIVE).sort()).toEqual([
      'projects-no-approver', 'projects-no-area', 'silent-messages', 'unused-roles',
    ])
  })

  // Order matters more than wording here: an admin scanning the panel must hit
  // the things that stop work before the things that are merely untidy.
  it('puts blockers before warnings, and warnings before notes', () => {
    const sev = checkHealth(LIVE).map(f => f.severity)
    expect(sev).toEqual(['blocker', 'blocker', 'warn', 'info'])
  })

  it('treats a project with no approver as a blocker, and says why', () => {
    const f = checkHealth(LIVE).find(x => x.id === 'projects-no-approver')!
    expect(f.severity).toBe('blocker')
    expect(f.title).toContain('3 projects')
    expect(f.detail).toMatch(/nobody to go to/i)
  })

  it('gets the singular right for one project', () => {
    const f = checkHealth({ ...CLEAN, projectsNoApprover: 1 })[0]
    expect(f.title).toBe('1 project has no approver')
  })

  it('gets the plural right for several', () => {
    const f = checkHealth({ ...CLEAN, projectsNoApprover: 2 })[0]
    expect(f.title).toBe('2 projects have no approver')
  })

  it('states the area gap as a share of the portfolio, not a bare count', () => {
    const f = checkHealth(LIVE).find(x => x.id === 'projects-no-area')!
    expect(f.title).toBe('25 of 41 projects have no area set')
    expect(f.detail).toContain('61%')
  })

  it('names the first few silent alerts rather than only counting them', () => {
    const f = checkHealth(LIVE).find(x => x.id === 'silent-messages')!
    expect(f.title).toBe('5 alerts reach nobody')
    expect(f.detail).toContain('Warehouse — material request needs approval')
    expect(f.detail).toContain('and 2 more')
  })

  it('does not say "and N more" when it listed them all', () => {
    const f = checkHealth({ ...CLEAN, silentMessages: LIVE.silentMessages.slice(0, 2) })[0]
    expect(f.detail).not.toContain('more')
  })

  it('gets the singular right for one silent alert', () => {
    const f = checkHealth({ ...CLEAN, silentMessages: LIVE.silentMessages.slice(0, 1) })[0]
    expect(f.title).toBe('1 alert reaches nobody')
  })

  it('reports unused roles as a note, not a problem', () => {
    const f = checkHealth(LIVE).find(x => x.id === 'unused-roles')!
    expect(f.severity).toBe('info')
    expect(f.title).toBe('8 roles are set up but nobody holds them')
  })

  it('says nothing about roles when every one is in use', () => {
    expect(ids({ ...CLEAN, rolesWithPermissions: 8, rolesInUse: 8 })).not.toContain('unused-roles')
  })

  it('never divides by zero on an empty hub', () => {
    const f = checkHealth({ ...CLEAN, projects: 0, projectsNoArea: 0 })
    expect(f).toEqual([])
    const g = checkHealth({ ...CLEAN, projects: 0, projectsNoArea: 3 })
    expect(g[0].detail).not.toContain('Infinity')
    expect(g[0].detail).not.toContain('NaN')
  })

  it('gives every finding somewhere to go and a verb to press', () => {
    for (const f of checkHealth(LIVE)) {
      expect(f.href.startsWith('/'), f.id).toBe(true)
      expect(f.fixLabel.length, f.id).toBeGreaterThan(3)
      expect(f.detail.length, f.id).toBeGreaterThan(20)
    }
  })

  it('puts a number in every title, so nothing reads as vague', () => {
    for (const f of checkHealth(LIVE)) expect(f.title, f.id).toMatch(/\d/)
  })
})
