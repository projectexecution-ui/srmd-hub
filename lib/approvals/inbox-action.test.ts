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

describe('Bills Approval', () => {
  // Bills route on desks, not on approval_rules, so the inbox carries no
  // next_stage for them and the verb comes from the stage they are AT.
  it('names the action at each desk', () => {
    const at = (s: string) => inboxActionLabel(null, { moduleSlug: 'bills-booking', fromStage: s })
    expect(at('atm_approval')).toBe('Approve')
    expect(at('ct_head')).toBe('Verify & forward')
    expect(at('site_head')).toBe('Check & forward')
    expect(at('ct_billing')).toBe('Make the certificate')
  })

  it('falls back to Open rather than printing a stage code', () => {
    expect(inboxActionLabel(null, { moduleSlug: 'bills-booking', fromStage: 'on_hold' })).toBe('Open')
    expect(inboxActionLabel(null, { moduleSlug: 'bills-booking' })).toBe('Open')
  })

  it('leaves every other module exactly as it was', () => {
    expect(inboxActionLabel('ph_approved', { moduleSlug: 'cost-control', fromStage: 'submitted' })).toBe('Approve')
    expect(inboxActionLabel('atm_approved')).toBe('Approve')
  })
})
