import { describe, expect, it } from 'vitest'
import {
  rolesThatCanMove, peopleWhoCanMove, issuers,
  planRaised, planMoved, planIssued, planReturnWaived, WH_EVENTS,
} from './notify-plan'
import type { Person, RequestFacts } from './notify-plan'
import type { Rule } from './approval-matrix'

const rule = (over: Partial<Rule> = {}): Rule => ({
  fromStage: 'pending', toStage: 'approved',
  approverRole: 'head', overrideRole: 'admin',
  amountCapMax: null, requiresRemarks: false, notes: null, ...over,
})

/** The chain actually configured in production on 2026-08-20. */
const LIVE_RULES: Rule[] = [
  rule({ fromStage: 'pending', toStage: 'checked', approverRole: 'head' }),
  rule({ fromStage: 'pending', toStage: 'approved', approverRole: 'head', amountCapMax: 200000 }),
  rule({ fromStage: 'pending', toStage: 'rejected', approverRole: 'head' }),
  rule({ fromStage: 'checked', toStage: 'approved', approverRole: 'founder' }),
  rule({ fromStage: 'checked', toStage: 'rejected', approverRole: 'founder' }),
  rule({ fromStage: 'approved', toStage: 'issued', approverRole: 'store_manager' }),
  rule({ fromStage: 'approved', toStage: 'part_issued', approverRole: 'store_manager' }),
]

/** The real people, with the real shortage: nobody holds store_manager. */
const PEOPLE: Person[] = [
  { id: 'adm1', name: 'projectexecution', role: 'admin', blocked: false },
  { id: 'head1', name: 'Akshay Atmarpit', role: 'head', blocked: false },
  { id: 'head2', name: 'Amit Gala', role: 'head', blocked: false },
  { id: 'trustee', name: 'Chirag Shah', role: 'founder', blocked: false },
  { id: 'eng1', name: 'Ramesh', role: 'engineer', blocked: false },
  { id: 'eng2', name: 'Suresh', role: 'engineer', blocked: false },
  { id: 'blockedhead', name: 'Blocked Head', role: 'head', blocked: true },
]

const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  id: 'r1', reqNo: 'Rq: 20Aug26/003', status: 'pending',
  requestedById: 'eng1', requesterName: 'Ramesh',
  storeName: 'NGH A store', storeId: 's1', keeperId: null,
  projectName: 'P2 A01', purpose: 'Slab shuttering', needBy: '22 Aug 2026',
  estValue: 45000, itemCount: 3, anyReturnable: false, ...over,
})

const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`
const ids = (ns: { userId: string }[]) => ns.map(n => n.userId).sort()

describe('which roles are being waited on', () => {
  it('takes the approver role, the override, and admin', () => {
    expect(rolesThatCanMove(LIVE_RULES, 'pending', 1000).sort())
      .toEqual(['admin', 'head'])
  })
  it('does not count a role that can only reject', () => {
    // Being able to refuse does not make you the person being waited on.
    const onlyReject: Rule[] = [rule({ fromStage: 'pending', toStage: 'rejected', approverRole: 'billing' })]
    expect(rolesThatCanMove(onlyReject, 'pending', null)).toEqual(['admin'])
  })
  it('drops a role whose cap the amount exceeds', () => {
    // head may approve to 2 lakh outright, but pending→checked has no cap, so
    // head is still waited on for a 5-lakh request — via the checking stage.
    const roles = rolesThatCanMove(LIVE_RULES, 'pending', 500000)
    expect(roles).toContain('head')
    const capOnly: Rule[] = [rule({ amountCapMax: 200000 })]
    expect(rolesThatCanMove(capOnly, 'pending', 500000)).toEqual(['admin'])
  })
  it('keeps a capped role when the amount is unknown', () => {
    const capOnly: Rule[] = [rule({ amountCapMax: 200000 })]
    expect(rolesThatCanMove(capOnly, 'pending', null).sort()).toEqual(['admin', 'head'])
  })
})

describe('who actually gets told', () => {
  it('skips a person blocked from the module', () => {
    const got = peopleWhoCanMove(PEOPLE, LIVE_RULES, 'pending', 1000).map(p => p.id)
    expect(got).not.toContain('blockedhead')
    expect(got).toContain('head1')
  })
  it('never asks somebody to approve their own request', () => {
    const asHead = facts({ requestedById: 'head1' })
    expect(ids(planRaised(asHead, PEOPLE, LIVE_RULES, inr))).not.toContain('head1')
  })
  it('tells both Atm Heads and the admin, not the engineers', () => {
    expect(ids(planRaised(facts(), PEOPLE, LIVE_RULES, inr)))
      .toEqual(['adm1', 'head1', 'head2'])
  })
  it('says nothing when the request needed no approval at all', () => {
    // Auto-approved: nobody is waiting, so nobody is chased.
    expect(planRaised(facts({ status: 'approved' }), PEOPLE, LIVE_RULES, inr)).toEqual([])
  })
})

describe('the raised message says what is being asked', () => {
  const n = planRaised(facts({ anyReturnable: true }), PEOPLE, LIVE_RULES, inr)[0]
  it('names the requester in the title', () => {
    expect(n.title).toContain('Ramesh')
    expect(n.title).toContain('Rq: 20Aug26/003')
  })
  it('carries store, project, value, purpose and need-by', () => {
    expect(n.body).toContain('NGH A store')
    expect(n.body).toContain('P2 A01')
    expect(n.body).toContain('₹45,000')
    expect(n.body).toContain('Slab shuttering')
    expect(n.body).toContain('22 Aug 2026')
  })
  it('flags a returnable up front', () => {
    expect(n.body).toMatch(/must come back/i)
  })
  it('deep-links to the request', () => {
    expect(n.url).toBe('/warehouse/requests/r1')
  })
})

describe('moving it on', () => {
  it('tells the Trustee when the first stage passes', () => {
    const out = planMoved(facts(), 'checked', 'Akshay Atmarpit', null, PEOPLE, LIVE_RULES, inr)
    const trustee = out.find(n => n.userId === 'trustee')
    expect(trustee?.type).toBe(WH_EVENTS.raised)
    expect(trustee?.title).toMatch(/needs your approval/i)
    // ...and the engineer hears it progressed.
    expect(out.find(n => n.userId === 'eng1')?.type).toBe(WH_EVENTS.decided)
  })

  it('tells the requester and the issuers on approval', () => {
    const out = planMoved(facts(), 'approved', 'Chirag Shah', null, PEOPLE, LIVE_RULES, inr)
    expect(out.find(n => n.userId === 'eng1')?.title).toMatch(/approved/i)
    // store_manager has NO accounts, so without the admin override nobody would
    // ever learn an approved request is sitting there.
    expect(out.find(n => n.userId === 'adm1')?.type).toBe(WH_EVENTS.toIssue)
  })

  it('prefers the store keeper, whatever their role', () => {
    const out = planMoved(facts({ keeperId: 'eng2' }), 'approved', null, null, PEOPLE, LIVE_RULES, inr)
    expect(out.find(n => n.userId === 'eng2')?.type).toBe(WH_EVENTS.toIssue)
  })

  it('gives the requester the rejection reason', () => {
    const out = planMoved(facts(), 'rejected', 'Amit Gala', 'Not budgeted this month',
      PEOPLE, LIVE_RULES, inr)
    expect(out).toHaveLength(1)
    expect(out[0].userId).toBe('eng1')
    expect(out[0].body).toContain('Not budgeted this month')
    expect(out[0].title).toContain('Amit Gala')
  })

  it('does not hide a missing rejection reason', () => {
    const out = planMoved(facts(), 'rejected', null, null, PEOPLE, LIVE_RULES, inr)
    expect(out[0].body).toMatch(/No reason was given/i)
  })

  it('sends nobody two copies of the same thing', () => {
    // An admin qualifies through several rules at once.
    const out = planMoved(facts(), 'approved', null, null, PEOPLE, LIVE_RULES, inr)
    const keys = out.map(n => `${n.userId}|${n.type}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('issuers when nobody holds the role', () => {
  it('falls back to the override role rather than telling nobody', () => {
    const noKeeper = issuers(facts(), PEOPLE, LIVE_RULES).map(p => p.id)
    expect(noKeeper).toEqual(['adm1'])
    expect(noKeeper.length).toBeGreaterThan(0)
  })
  it('puts the keeper first when one is named', () => {
    expect(issuers(facts({ keeperId: 'head1' }), PEOPLE, LIVE_RULES)[0].id).toBe('head1')
  })
  it('ignores a keeper who is blocked from the module', () => {
    expect(issuers(facts({ keeperId: 'blockedhead' }), PEOPLE, LIVE_RULES).map(p => p.id))
      .not.toContain('blockedhead')
  })
})

describe('handing it over', () => {
  it('tells the requester when it is all out', () => {
    const [n] = planIssued(facts(), 'Out: 20Aug26/007', true)
    expect(n.userId).toBe('eng1')
    expect(n.title).toMatch(/handed over/i)
    expect(n.body).toContain('Out: 20Aug26/007')
  })
  it('says plainly that a part-issue is not finished', () => {
    const [n] = planIssued(facts(), 'Out: 20Aug26/007', false)
    expect(n.title).toMatch(/part-issued/i)
    expect(n.body).toMatch(/still to come/i)
  })
  it('reminds them when it has to come back', () => {
    expect(planIssued(facts({ anyReturnable: true }), 'E1', true)[0].body)
      .toMatch(/must come back/i)
  })
  it('stays silent when nobody is recorded as the requester', () => {
    expect(planIssued(facts({ requestedById: null }), 'E1', true)).toEqual([])
  })
})

describe('releasing the return', () => {
  it('tells the requester who released it and why', () => {
    const [n] = planReturnWaived(facts(), 'Akshay Atmarpit', 'Consumed on site')
    expect(n.userId).toBe('eng1')
    expect(n.type).toBe(WH_EVENTS.returnWaived)
    expect(n.body).toContain('Akshay Atmarpit')
    expect(n.body).toContain('Consumed on site')
  })
})

describe('a request that names no store — the normal case now', () => {
  const noStore = () => facts({ storeName: null, storeId: null })

  it('leaves the store clause out rather than saying "a store"', () => {
    const n = planRaised(noStore(), PEOPLE, LIVE_RULES, inr)[0]
    expect(n.body).toContain('3 items')
    expect(n.body).not.toMatch(/from (a|the|your) store/)
    expect(n.body).not.toContain('null')
  })

  it('still names the store when the request has one', () => {
    const n = planRaised(facts(), PEOPLE, LIVE_RULES, inr)[0]
    expect(n.body).toContain('from NGH A store')
  })

  it('tells the requester it can be handed over without inventing a store', () => {
    const n = planMoved(noStore(), 'approved', null, null, PEOPLE, LIVE_RULES, inr)
      .find(x => x.userId === 'eng1')
    expect(n?.body).toContain('can be handed over now')
    expect(n?.body).not.toMatch(/from (a|the|your) store/)
  })

  it('tells the keeper what to hand over without claiming it is his store', () => {
    // He keeps one of nine. "from your store" was a guess, and a wrong one.
    const n = planMoved(noStore(), 'approved', null, null, PEOPLE, LIVE_RULES, inr)
      .filter(x => x.userId !== 'eng1')
    expect(n.length).toBeGreaterThan(0)
    for (const x of n) expect(x.body).not.toContain('your store')
  })
})
