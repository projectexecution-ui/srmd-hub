import { describe, it, expect } from 'vitest'
import { renderNotificationEmail, kindFromType, inr, crL } from './email-templates'

describe('email currency helpers', () => {
  it('formats Indian grouping', () => {
    expect(inr(14489879)).toBe('₹1,44,89,879')
    expect(inr(0)).toBe('₹0')
  })
  it('compacts to Cr / L', () => {
    expect(crL(14489879)).toBe('₹1.45 Cr')
    expect(crL(6890000)).toBe('₹68.9 L')
    expect(crL(6500)).toBe('₹6,500')
  })
})

describe('kindFromType', () => {
  it('maps known types', () => {
    expect(kindFromType('approval_pending')).toBe('approval')
    expect(kindFromType('in4_pending')).toBe('in4_pending')
    expect(kindFromType('in4_entered')).toBe('in4_entered')
    expect(kindFromType('access_request')).toBe('generic')
    expect(kindFromType(null)).toBe('generic')
  })
})

describe('approval email', () => {
  const html = renderNotificationEmail({
    kind: 'approval', subject: 'x', text: 'y', link: 'https://h/ws/1',
    data: { amount: 14489879, per_sft: 2588, stage_label: 'Atm Head sign-off', stage_index: 3, project: 'NGH A · NGH', work: '3901 Contractor cost', raised_by: 'Ramesh Patel', waiting_days: 2, estimate: 15000000 },
  })
  it('shows the hero amount + link', () => {
    expect(html).toContain('₹1,44,89,879')
    expect(html).toContain('https://h/ws/1')
  })
  it('renders the budget bar as "under" when within estimate', () => {
    expect(html).toContain('under the internal estimate')
    expect(html).not.toContain('over the internal estimate')
  })
  it('flags over-budget in red when the ask exceeds the estimate', () => {
    const over = renderNotificationEmail({
      kind: 'approval', subject: 'x', text: 'y', link: 'l',
      data: { amount: 16000000, estimate: 15000000, stage_index: 3 },
    })
    expect(over).toContain('over the internal estimate')
  })
  it('shows the cumulative line on a revision (already approved · this ask · cumulative)', () => {
    const rev = renderNotificationEmail({
      kind: 'approval', subject: 'x', text: 'y', link: 'l',
      data: { amount: 3731280, already_approved: 3537113, cumulative: 3731280, stage_index: 3 },
    })
    expect(rev).toContain('Already approved')
    expect(rev).toContain('₹35,37,113')   // already approved
    expect(rev).toContain('₹1,94,167')    // this ask = 3731280 - 3537113
    expect(rev).toContain('₹37,31,280')   // cumulative
  })
  it('omits the cumulative line on a first version (no prior approved)', () => {
    const v1 = renderNotificationEmail({
      kind: 'approval', subject: 'x', text: 'y', link: 'l',
      data: { amount: 3537113, already_approved: 0, stage_index: 3 },
    })
    expect(v1).not.toContain('Already approved')
  })
})

describe('in4 pending digest', () => {
  const html = renderNotificationEmail({
    kind: 'in4_pending', subject: 'x', text: 'y', link: 'l',
    data: { count: 5, total_stuck: 6890000, more: 2, items: [
      { label: 'NGH A · CCTV', amount: 651921, days: 6 },
      { label: 'NGH A · Road', amount: 2775500, days: 4 },
    ] },
  })
  it('leads with the stuck total and lists items', () => {
    expect(html).toContain('₹68.9 L')
    expect(html).toContain('NGH A · CCTV')
    expect(html).toContain('+ 2 more')
  })
})

describe('generic fallback', () => {
  it('is used for unknown kinds / missing data', () => {
    const html = renderNotificationEmail({ kind: 'generic', subject: 'New access request', text: 'Someone asked', link: 'l' })
    expect(html).toContain('New access request')
    expect(html).toContain('Open CT HUB')
  })
})
