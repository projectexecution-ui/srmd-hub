import { describe, it, expect } from 'vitest'
import { inboxActionLabel } from './inbox-action'

describe('inboxActionLabel', () => {
  it('turns the final-approval stage into a clear action, not a status', () => {
    // The whole point: "approved" must not render as the misleading "Final approval".
    expect(inboxActionLabel('approved')).toBe('Approve (final)')
  })

  it('maps the known chain stages to imperative to-dos', () => {
    expect(inboxActionLabel('ph_approved')).toBe('Approve')
    expect(inboxActionLabel('atm_approved')).toBe('Approve')
    expect(inboxActionLabel('partially_approved')).toBe('Release part')
    expect(inboxActionLabel('returned')).toBe('Send back')
    expect(inboxActionLabel('deadline_set')).toBe('Set deadline')
    expect(inboxActionLabel('verify')).toBe('Verify')
  })

  it('falls back to a readable Title Case for unknown stages', () => {
    expect(inboxActionLabel('some_new_stage')).toBe('Some New Stage')
  })

  it('never renders a broken snippet for empty input', () => {
    expect(inboxActionLabel(null)).toBe('Open')
    expect(inboxActionLabel(undefined)).toBe('Open')
    expect(inboxActionLabel('')).toBe('Open')
  })
})
