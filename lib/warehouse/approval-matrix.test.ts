import { describe, expect, it } from 'vitest'
import {
  movesFor, needsApproval, describeChain, waitingOn, personBlocker, STAGE_LABEL,
} from './approval-matrix'
import type { Rule } from './approval-matrix'

const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`
const label = (r: string) => ({
  head: 'Atm Head', founder: 'Trustee', store_manager: 'Storekeeper', admin: 'Admin',
}[r] ?? r)

const rule = (o: Partial<Rule> & { fromStage: string; toStage: string; approverRole: string }): Rule => ({
  overrideRole: 'admin', amountCapMax: null, requiresRemarks: false, notes: null, ...o,
})

/** The chain the migration seeds: an Atm Head alone up to 2 lakh, otherwise he
 *  checks it and a Trustee releases it. */
const SEEDED: Rule[] = [
  rule({ fromStage: 'pending', toStage: 'approved', approverRole: 'head', amountCapMax: 200_000 }),
  rule({ fromStage: 'pending', toStage: 'checked', approverRole: 'head' }),
  rule({ fromStage: 'checked', toStage: 'approved', approverRole: 'founder' }),
  rule({ fromStage: 'pending', toStage: 'rejected', approverRole: 'head', requiresRemarks: true }),
  rule({ fromStage: 'checked', toStage: 'rejected', approverRole: 'founder', requiresRemarks: true }),
  rule({ fromStage: 'approved', toStage: 'issued', approverRole: 'store_manager' }),
]

describe('what a person may do, read from the rules', () => {
  it('lets an Atm Head release a small request outright', () => {
    const m = movesFor(SEEDED, 'pending', 'head', 50_000)
    expect(m.map(x => x.toStage).sort()).toEqual(['approved', 'checked', 'rejected'])
  })

  it('takes the outright release away once the value is over his cap', () => {
    // This is the whole point of a cap: the same person, the same stage, a
    // bigger number, and one door closes.
    const m = movesFor(SEEDED, 'pending', 'head', 500_000)
    expect(m.map(x => x.toStage).sort()).toEqual(['checked', 'rejected'])
  })

  it('treats exactly the cap as within it', () => {
    const m = movesFor(SEEDED, 'pending', 'head', 200_000)
    expect(m.map(x => x.toStage)).toContain('approved')
  })

  it('gives an admin every configured hop', () => {
    const m = movesFor(SEEDED, 'checked', 'admin', null)
    expect(m.map(x => x.toStage).sort()).toEqual(['approved', 'rejected'])
  })

  it('honours an override role as well as the approver role', () => {
    const rules = [rule({ fromStage: 'pending', toStage: 'approved', approverRole: 'head', overrideRole: 'founder' })]
    expect(movesFor(rules, 'pending', 'founder', null)).toHaveLength(1)
    expect(movesFor(rules, 'pending', 'engineer', null)).toHaveLength(0)
  })

  it('gives a storekeeper nothing at the approval stage', () => {
    expect(movesFor(SEEDED, 'pending', 'store_manager', 10_000)).toHaveLength(0)
  })

  it('gives nobody anything without a role', () => {
    expect(movesFor(SEEDED, 'pending', null, 10_000)).toHaveLength(0)
  })

  it('ignores a cap when the value is unknown, rather than guessing', () => {
    // The request is separately forced to need approval when it cannot be
    // priced, so this cannot become a way through.
    const m = movesFor(SEEDED, 'pending', 'head', null)
    expect(m.map(x => x.toStage)).toContain('approved')
  })

  it('never offers the same destination twice, however many rules allow it', () => {
    const rules = [
      rule({ fromStage: 'pending', toStage: 'approved', approverRole: 'head' }),
      rule({ fromStage: 'pending', toStage: 'approved', approverRole: 'admin' }),
    ]
    expect(movesFor(rules, 'pending', 'admin', null)).toHaveLength(1)
  })

  it('carries the compulsory-remark flag through from the rule', () => {
    const m = movesFor(SEEDED, 'pending', 'head', 10_000)
    expect(m.find(x => x.toStage === 'rejected')!.needsRemarks).toBe(true)
    expect(m.find(x => x.toStage === 'approved')!.needsRemarks).toBe(false)
  })
})

describe('whether approval applies at all', () => {
  it('says yes while a rule leads somewhere other than an issue', () => {
    expect(needsApproval(SEEDED, 'pending')).toBe(true)
  })

  it('says no once nothing but issuing is left', () => {
    expect(needsApproval(SEEDED, 'approved')).toBe(false)
  })

  it('says no when an admin has removed the approval rules entirely', () => {
    // This is how "no approval, the keeper issues it" is expressed now — by
    // configuration, not by a setting I chose the shape of.
    const issueOnly = SEEDED.filter(r => r.fromStage === 'approved')
    expect(needsApproval(issueOnly, 'pending')).toBe(false)
  })
})

describe('telling the requester what it waits for', () => {
  it('names the role from the rules, not a hard-coded title', () => {
    const custom = [rule({ fromStage: 'pending', toStage: 'approved', approverRole: 'project_head' })]
    expect(waitingOn(custom, 'pending', null, label, money)).toContain('project_head')
  })

  it('mentions the limit when the request sits inside one', () => {
    const s = waitingOn(SEEDED, 'pending', 50_000, label, money)
    expect(s).toContain('Atm Head')
    expect(s).toContain('2,00,000')
  })

  it('says it is over the single-approval limit when it is', () => {
    const s = waitingOn(SEEDED, 'pending', 500_000, label, money)
    expect(s).toContain('over the limit')
  })

  it('says it goes straight through when nothing is configured', () => {
    expect(waitingOn([], 'pending', null, label, money)).toContain('straight to the storekeeper')
  })
})

describe('describing the chain for Settings', () => {
  it('reads the rules rather than a fixed description', () => {
    const lines = describeChain(SEEDED, label, money)
    expect(lines.join(' | ')).toContain('Atm Head')
    expect(lines.join(' | ')).toContain('Trustee')
    expect(lines.join(' | ')).toContain('2,00,000')
  })

  it('says plainly when there is no chain', () => {
    expect(describeChain([], label, money)[0]).toContain('No approval is configured')
  })

  it('leaves rejection hops out of the chain description', () => {
    expect(describeChain(SEEDED, label, money).join(' ')).not.toContain('Rejected')
  })
})

describe('the two rules no row could express', () => {
  it('stops the requester approving his own request', () => {
    expect(personBlocker('eng', 'eng', [])).toContain('cannot approve it')
  })

  it('stops one person filling two stages', () => {
    expect(personBlocker('head1', 'eng', ['head1'])).toContain('somebody else')
  })

  it('lets a different person take the next stage', () => {
    expect(personBlocker('trustee', 'eng', ['head1'])).toBeNull()
  })

  it('is silent when there is nobody to compare', () => {
    expect(personBlocker(null, 'eng', [])).toBeNull()
  })
})

describe('stage labels', () => {
  it('names every stage in words, including the new checked stage', () => {
    for (const k of ['pending', 'checked', 'approved', 'rejected', 'part_issued', 'issued', 'cancelled']) {
      expect(STAGE_LABEL[k]).toBeTruthy()
      expect(STAGE_LABEL[k]).not.toMatch(/_/)
    }
  })
})
