import { describe, it, expect } from 'vitest'
import { parseRoleSides, DEFAULT_ROLE_SIDES } from './role-sides'

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
