import { describe, it, expect } from 'vitest'
import { oldIndentAllowed } from './old-indent-to-po'

/**
 * "Only visible to me" became "me and Ambrish" within the hour, which is
 * exactly why this is a named list and not a role: Ambrish is one of three
 * engineers, and letting the role in would hand the screen to two people
 * nobody asked about.
 */
describe('who may open OLD INDENT TO PO', () => {
  const AKSHA = { id: 'aksha', role: 'admin' }
  const AMBRISH = { id: 'ambrish', role: 'engineer' }
  const OTHER_ENGINEER = { id: 'akshay-p', role: 'engineer' }

  it('lets an admin in with nobody named', () => {
    expect(oldIndentAllowed(AKSHA, [])).toBe(true)
  })

  it('lets a named person in, whatever their role', () => {
    expect(oldIndentAllowed(AMBRISH, ['ambrish'])).toBe(true)
  })

  it('does NOT let the rest of their role in with them', () => {
    expect(oldIndentAllowed(OTHER_ENGINEER, ['ambrish'])).toBe(false)
  })

  it('keeps everybody else out', () => {
    expect(oldIndentAllowed({ id: 'chirag', role: 'founder' }, ['ambrish'])).toBe(false)
    expect(oldIndentAllowed({ id: 'hiten', role: 'head' }, ['ambrish'])).toBe(false)
    expect(oldIndentAllowed({ id: 'mayank', role: 'backoffice' }, [])).toBe(false)
  })

  it('refuses somebody with no id rather than matching an empty string', () => {
    expect(oldIndentAllowed({ id: null, role: 'engineer' }, [''])).toBe(false)
  })

  it('an empty list means the admin alone', () => {
    expect(oldIndentAllowed(AMBRISH, [])).toBe(false)
    expect(oldIndentAllowed(AKSHA, [])).toBe(true)
  })
})
