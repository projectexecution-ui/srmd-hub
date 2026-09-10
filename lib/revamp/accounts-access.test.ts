import { describe, it, expect } from 'vitest'
import { accountsAllowed } from './accounts-access'

const AKSHAY = '465e6bfe-b348-48d6-9346-836b0d444ec7'
const CHIRAG = 'd64adae2-429d-4879-a14a-c9efa98a16b5'
const LIST = [AKSHAY, CHIRAG]

describe('accountsAllowed — Accounts is for named people, not a role', () => {
  it('lets an admin and the Portal Owner in whatever the list says', () => {
    expect(accountsAllowed({ id: 'x', role: 'admin', portalOwner: false }, [])).toBe(true)
    expect(accountsAllowed({ id: 'x', role: 'viewer', portalOwner: true }, [])).toBe(true)
  })
  it('lets a listed person in and keeps an unlisted one out, even another Atm Head', () => {
    expect(accountsAllowed({ id: AKSHAY, role: 'head', portalOwner: false }, LIST)).toBe(true)
    expect(accountsAllowed({ id: CHIRAG, role: 'founder', portalOwner: false }, LIST)).toBe(true)
    expect(accountsAllowed({ id: 'another-head', role: 'head', portalOwner: false }, LIST)).toBe(false)
    expect(accountsAllowed({ id: 'parimal', role: 'coordinator', portalOwner: false }, LIST)).toBe(false)
  })
  it('an empty list means admins only', () => {
    expect(accountsAllowed({ id: AKSHAY, role: 'head', portalOwner: false }, [])).toBe(false)
  })
})
