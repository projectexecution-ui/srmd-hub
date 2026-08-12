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
  it('shows the note (and who wrote it) when present', () => {
    const withNote = renderNotificationEmail({
      kind: 'approval', subject: 'x', text: 'y', link: 'l',
      data: { amount: 100, stage_index: 3, note: 'Cabling for the new ICT wing as per site layout', note_by: 'Ambrish' },
    })
    expect(withNote).toContain('Cabling for the new ICT wing as per site layout')
    expect(withNote).toContain('Ambrish')
  })
  it('escapes note content and omits the block when absent', () => {
    const evil = renderNotificationEmail({
      kind: 'approval', subject: 'x', text: 'y', link: 'l',
      data: { amount: 100, stage_index: 3, note: '<script>alert(1)</script>' },
    })
    expect(evil).toContain('&lt;script&gt;')
    expect(evil).not.toContain('<script>alert(1)</script>')
    const none = renderNotificationEmail({
      kind: 'approval', subject: 'x', text: 'y', link: 'l',
      data: { amount: 100, stage_index: 3 },
    })
    expect(none).not.toContain('Cabling for')
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

describe('engineer daily digest', () => {
  it('maps the type + renders returned / drafts / awaiting + CTA', () => {
    expect(kindFromType('cc_engineer_digest')).toBe('engineer_digest')
    const html = renderNotificationEmail({
      kind: 'engineer_digest', subject: 'x', text: 'y', link: 'https://h/cost-control',
      data: {
        returned: 1, drafts: 2, awaiting: 3, awaiting_amount: 5000000, oldest_awaiting_days: 4,
        returned_items: [{ label: 'NGH B · Waterproofing', reason: 'Rate looks high' }],
        draft_items: [{ label: 'NGH A · Flooring' }, { label: 'P2 · Plumbing' }],
      },
    })
    expect(html).toContain('Returned to you')
    expect(html).toContain('NGH B · Waterproofing')
    expect(html).toContain('Rate looks high')
    expect(html).toContain('NGH A · Flooring')
    expect(html).toContain('awaiting approval')
    expect(html).toContain('Open Internal Estimate')
    expect(html).toContain('https://h/cost-control')
  })
})

describe('budget approved by Trustee (Atm Head, instant)', () => {
  it('maps the type + renders a green approved card with amount, work and CTA', () => {
    expect(kindFromType('cc_budget_approved')).toBe('cc_approved')
    const html = renderNotificationEmail({
      kind: 'cc_approved', subject: 'x', text: 'y', link: 'https://h/ws/9',
      data: { amount: 200000, per_sft: 1450, project: 'P2 A01', work: 'ICT Expense', decision: 'approved' },
    })
    expect(html).toContain('Approved by the Trustee')
    expect(html).toContain('₹2,00,000')
    expect(html).toContain('ICT Expense')
    expect(html).toContain('P2 A01')
    expect(html).toContain('View working sheet')
    expect(html).toContain('https://h/ws/9')
  })
  it('says "Partially released" when the decision is partial', () => {
    const html = renderNotificationEmail({
      kind: 'cc_approved', subject: 'x', text: 'y', link: 'l',
      data: { amount: 100000, work: 'HVAC', decision: 'partially_approved' },
    })
    expect(html).toContain('Partially released by the Trustee')
  })
})

describe('budgets approved daily digest (PH + engineer)', () => {
  it('maps the type + lists each approved budget with the total + CTA', () => {
    expect(kindFromType('cc_budget_approved_digest')).toBe('cc_approved_digest')
    const html = renderNotificationEmail({
      kind: 'cc_approved_digest', subject: 'x', text: 'y', link: 'https://h/cost-control',
      data: {
        count: 2, total: 750000, more: 0,
        items: [
          { label: 'P2 A01 · Contractor Cost', amount: 750000, decision: 'approved' },
          { label: 'P2 A01 · Deep Cleaning', amount: 35000, decision: 'partially_approved' },
        ],
      },
    })
    expect(html).toContain('2 budgets approved')
    expect(html).toContain('P2 A01 · Contractor Cost')
    expect(html).toContain('(partial)')
    expect(html).toContain('Open Internal Estimate')
    expect(html).toContain('https://h/cost-control')
  })
})

describe('@mention email', () => {
  it('maps the type + shows who tagged you, where, the comment, and a CTA', () => {
    expect(kindFromType('comment_mention')).toBe('mention')
    const html = renderNotificationEmail({
      kind: 'mention', subject: 'x', text: 'y', link: 'https://h/cost-control/working-sheets/9',
      data: { author: 'Akshay', module: 'Internal Estimate', context: 'NGH A · 3901 Contractor cost', comment: 'Please enter this in IN4 today' },
    })
    expect(html).toContain('Akshay mentioned you')
    expect(html).toContain('Internal Estimate')
    expect(html).toContain('NGH A · 3901 Contractor cost')
    expect(html).toContain('Please enter this in IN4 today')
    expect(html).toContain('View comment')
    expect(html).toContain('https://h/cost-control/working-sheets/9')
  })
})

describe('generic fallback', () => {
  it('is used for unknown kinds / missing data', () => {
    const html = renderNotificationEmail({ kind: 'generic', subject: 'New access request', text: 'Someone asked', link: 'l' })
    expect(html).toContain('New access request')
    expect(html).toContain('Open CT HUB')
  })
})
