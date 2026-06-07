import { describe, it, expect } from 'vitest'
import { isPendingAccessRequest, allowedEmailSet } from './access-requests'

const allowed = allowedEmailSet([{ email: 'staff@srmd.org' }, { email: 'Boss@SRMD.org' }])
const ADMIN = 'projectexecution@construction.srmd.org'

describe('isPendingAccessRequest', () => {
  it('flags a fresh, non-allowlisted, inactive sign-in', () => {
    expect(isPendingAccessRequest(
      { email: 'newperson@gmail.com', is_active: false, access_state: null }, allowed, ADMIN,
    )).toBe(true)
  })

  it('ignores active users', () => {
    expect(isPendingAccessRequest(
      { email: 'newperson@gmail.com', is_active: true, access_state: null }, allowed, ADMIN,
    )).toBe(false)
  })

  it('ignores anyone already approved or denied', () => {
    expect(isPendingAccessRequest(
      { email: 'a@gmail.com', is_active: false, access_state: 'denied' }, allowed, ADMIN,
    )).toBe(false)
    expect(isPendingAccessRequest(
      { email: 'b@gmail.com', is_active: false, access_state: 'approved' }, allowed, ADMIN,
    )).toBe(false)
  })

  it('ignores allowlisted emails (case-insensitive) — they are intentional, not requests', () => {
    expect(isPendingAccessRequest(
      { email: 'staff@srmd.org', is_active: false, access_state: null }, allowed, ADMIN,
    )).toBe(false)
    expect(isPendingAccessRequest(
      { email: 'boss@srmd.org', is_active: false, access_state: null }, allowed, ADMIN,
    )).toBe(false)
  })

  it('ignores the admin email and anonymous quick-signins', () => {
    expect(isPendingAccessRequest(
      { email: ADMIN.toUpperCase(), is_active: false, access_state: null }, allowed, ADMIN,
    )).toBe(false)
    expect(isPendingAccessRequest(
      { email: 'anon-abc123@srmd.local', is_active: false, access_state: null }, allowed, ADMIN,
    )).toBe(false)
  })

  it('handles a missing admin email + empty email gracefully', () => {
    expect(isPendingAccessRequest(
      { email: 'x@gmail.com', is_active: false, access_state: null }, allowed, null,
    )).toBe(true)
    expect(isPendingAccessRequest(
      { email: '', is_active: false, access_state: null }, allowed, ADMIN,
    )).toBe(false)
  })
})
