import { describe, it, expect } from 'vitest'
import { parseRoleSides, DEFAULT_ROLE_SIDES } from './role-sides'
import { ALL_ROLES } from './types'
import { DEFAULT_ROLE_LABELS } from './role-labels'

describe('coordinator role', () => {
  // Coordinator = Cost Control setup/admin + full visibility, but NEVER an
  // approver (the money block is that it is absent from the approval matrix).
  it('is a registered role with a label', () => {
    expect(ALL_ROLES).toContain('coordinator')
    expect(DEFAULT_ROLE_LABELS.coordinator.label).toBeTruthy()
    expect(DEFAULT_ROLE_LABELS.coordinator.description.toLowerCase()).toContain('cannot approve')
  })
  it('sits on the management side by default (setup/back-office)', () => {
    expect(DEFAULT_ROLE_SIDES.management).toContain('coordinator')
    expect(DEFAULT_ROLE_SIDES.engineer).not.toContain('coordinator')
  })
})

describe('parseRoleSides', () => {
  it('returns defaults when no keys are set', () => {
    const s = parseRoleSides({})
    expect(s.management).toEqual(DEFAULT_ROLE_SIDES.management)
    expect(s.engineer).toEqual(DEFAULT_ROLE_SIDES.engineer)
  })

  it('reads custom CSVs', () => {
    const s = parseRoleSides({ roles_management: 'admin,founder', roles_engineer: 'engineer,site_staff' })
    expect(s.management).toEqual(['admin', 'founder'])
    expect(s.engineer).toEqual(['engineer', 'site_staff'])
  })

  it('always keeps admin on the management side', () => {
    const s = parseRoleSides({ roles_management: 'founder' })
    expect(s.management).toContain('admin')
  })

  it('a role can never sit on both sides — management wins', () => {
    const s = parseRoleSides({ roles_management: 'admin,engineer', roles_engineer: 'engineer' })
    expect(s.management).toContain('engineer')
    expect(s.engineer).not.toContain('engineer')
  })

  it('drops unknown roles and handles empty strings', () => {
    const s = parseRoleSides({ roles_management: 'admin,super_boss,,head', roles_engineer: '' })
    expect(s.management).toEqual(['admin', 'head'])
    expect(s.engineer).toEqual([])
  })
})
