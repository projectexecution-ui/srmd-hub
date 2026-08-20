/** Who gets told what about a material request, and in what words.
 *
 *  This is the gap that killed V1. The request chain worked; nobody knew there
 *  was anything in it. An approver had to remember to open a screen, so requests
 *  sat until somebody walked over and asked — which is a phone call, not a
 *  system. Every other module in the hub notifies through `notify_user`, and
 *  this one finally does too.
 *
 *  Deliberately pure. Working out WHO should hear about a stage change is
 *  role-and-rule reasoning, which is precisely the kind of logic that has
 *  compiled cleanly and been wrong three times in this module already. The
 *  sending lives in notify.ts; the deciding lives here where tests can reach it.
 */

import type { Rule } from './approval-matrix'

/** The event types, one per audience-and-moment so each can be switched off on
 *  its own from the admin Notifications page. Must match NOTIFICATION_EVENTS. */
export const WH_EVENTS = {
  raised: 'wh_request_raised',
  decided: 'wh_request_decided',
  toIssue: 'wh_request_to_issue',
  issued: 'wh_request_issued',
  returnWaived: 'wh_return_waived',
} as const

export type WhEvent = (typeof WH_EVENTS)[keyof typeof WH_EVENTS]

/** One person to tell, and what to tell them. */
export type Notice = {
  userId: string
  type: WhEvent
  title: string
  body: string
  url: string
  data: Record<string, unknown>
}

/** A candidate recipient: their effective role on THIS module, already resolved
 *  through user_module_roles, plus whether they are blocked from it. */
export type Person = {
  id: string
  name: string | null
  /** effective_user_role(id, 'warehouse') — the override, else the base role. */
  role: string | null
  blocked: boolean
}

export type RequestFacts = {
  id: string
  reqNo: string
  status: string
  requestedById: string | null
  requesterName: string | null
  storeName: string | null
  storeId: string | null
  /** Who keeps the store this asks from; null when nobody is named. */
  keeperId: string | null
  projectName: string | null
  purpose: string | null
  needBy: string | null
  estValue: number | null
  itemCount: number
  /** True when any line must come back — worth saying up front. */
  anyReturnable: boolean
}

const url = (id: string) => `/warehouse/requests/${id}`

/** The roles that could move a request on from this stage, at this value.
 *
 *  Mirrors can_approve(): the rule's approver role, its override role, and admin
 *  always. A cap only bites when the amount is known, exactly as movesFor has
 *  it — an unpriced request is not treated as free. */
export function rolesThatCanMove(
  rules: Rule[],
  fromStage: string,
  amount: number | null,
): string[] {
  const out = new Set<string>(['admin'])
  for (const r of rules) {
    if (r.fromStage !== fromStage) continue
    // Rejecting is not "moving it on" — being able only to refuse does not make
    // somebody the person being waited on.
    if (r.toStage === 'rejected' || r.toStage === 'cancelled') continue
    if (r.amountCapMax != null && amount != null && amount > r.amountCapMax) continue
    out.add(r.approverRole)
    if (r.overrideRole) out.add(r.overrideRole)
  }
  return [...out]
}

/** Everyone who could act on a request sitting at this stage. */
export function peopleWhoCanMove(
  people: Person[],
  rules: Rule[],
  fromStage: string,
  amount: number | null,
): Person[] {
  const roles = new Set(rolesThatCanMove(rules, fromStage, amount))
  return people.filter(p => !p.blocked && p.role && roles.has(p.role))
}

const money = (n: number | null, fmt: (v: number) => string) =>
  n == null ? '' : ` · about ${fmt(n)}`

/** Raised, and somebody has to approve it. */
export function planRaised(
  r: RequestFacts,
  people: Person[],
  rules: Rule[],
  fmtINR: (v: number) => string,
): Notice[] {
  // An auto-approved request waits on nobody, so nobody is chased about it.
  if (r.status !== 'pending') return []
  const targets = peopleWhoCanMove(people, rules, 'pending', r.estValue)
    // Never ask somebody to approve their own request.
    .filter(p => p.id !== r.requestedById)

  const who = r.requesterName ?? 'An engineer'
  const what = `${r.itemCount} ${r.itemCount === 1 ? 'item' : 'items'}`
  return dedupe(targets.map(p => ({
    userId: p.id,
    type: WH_EVENTS.raised,
    title: `${r.reqNo} — ${who} needs your approval`,
    body: `${what} from ${r.storeName ?? 'a store'}`
      + (r.projectName ? ` for ${r.projectName}` : '')
      + money(r.estValue, fmtINR)
      + (r.purpose ? `. ${r.purpose}` : '')
      + (r.needBy ? ` Needed by ${r.needBy}.` : '')
      + (r.anyReturnable ? ' Some of it must come back.' : ''),
    url: url(r.id),
    data: { reqNo: r.reqNo, store: r.storeName, project: r.projectName, items: r.itemCount },
  })))
}

/** Moved on: the requester hears the outcome, and whoever is waited on next. */
export function planMoved(
  r: RequestFacts,
  toStage: string,
  actorName: string | null,
  reason: string | null,
  people: Person[],
  rules: Rule[],
  fmtINR: (v: number) => string,
): Notice[] {
  const out: Notice[] = []
  const by = actorName ? ` by ${actorName}` : ''

  // 1 · The person who asked always hears what happened to their ask.
  if (r.requestedById) {
    if (toStage === 'rejected') {
      out.push({
        userId: r.requestedById, type: WH_EVENTS.decided,
        title: `${r.reqNo} was turned down${by}`,
        body: reason ? `Reason: ${reason}` : 'No reason was given.',
        url: url(r.id), data: { reqNo: r.reqNo, outcome: 'rejected', reason },
      })
    } else if (toStage === 'approved') {
      out.push({
        userId: r.requestedById, type: WH_EVENTS.decided,
        title: `${r.reqNo} was approved${by}`,
        body: `The store can hand it over now — ${r.itemCount} `
          + `${r.itemCount === 1 ? 'item' : 'items'} from ${r.storeName ?? 'the store'}.`
          + (r.anyReturnable ? ' Some of it must come back.' : ''),
        url: url(r.id), data: { reqNo: r.reqNo, outcome: 'approved' },
      })
    } else if (toStage === 'checked') {
      out.push({
        userId: r.requestedById, type: WH_EVENTS.decided,
        title: `${r.reqNo} passed the first approval${by}`,
        body: 'It now needs one more sign-off before the store can hand it over.',
        url: url(r.id), data: { reqNo: r.reqNo, outcome: 'checked' },
      })
    }
  }

  // 2 · Whoever is waited on NEXT.
  if (toStage === 'checked') {
    // A second stage exists, so tell the people who fill it.
    for (const p of peopleWhoCanMove(people, rules, 'checked', r.estValue)) {
      if (p.id === r.requestedById) continue
      out.push({
        userId: p.id, type: WH_EVENTS.raised,
        title: `${r.reqNo} needs your approval`,
        body: `Already passed the first stage${by}. `
          + `${r.itemCount} ${r.itemCount === 1 ? 'item' : 'items'} from ${r.storeName ?? 'a store'}`
          + money(r.estValue, fmtINR) + '.',
        url: url(r.id),
        data: { reqNo: r.reqNo, stage: 'checked' },
      })
    }
  } else if (toStage === 'approved') {
    for (const p of issuers(r, people, rules)) {
      if (p.id === r.requestedById) continue
      out.push({
        userId: p.id, type: WH_EVENTS.toIssue,
        title: `${r.reqNo} is approved — ready to hand over`,
        body: `${r.itemCount} ${r.itemCount === 1 ? 'item' : 'items'} from `
          + `${r.storeName ?? 'your store'}`
          + (r.requesterName ? ` for ${r.requesterName}` : '')
          + (r.needBy ? `, needed by ${r.needBy}` : '') + '.'
          + (r.anyReturnable ? ' Returnable — it has to come back.' : ''),
        url: url(r.id),
        data: { reqNo: r.reqNo, store: r.storeName },
      })
    }
  }
  return dedupe(out)
}

/** Who can actually hand the material over.
 *
 *  The store's named keeper first. There are no store_manager accounts at all,
 *  so relying on the role alone would mean nobody is ever told an approved
 *  request is waiting — the admin override_role is what saves it. */
export function issuers(r: RequestFacts, people: Person[], rules: Rule[]): Person[] {
  const byRole = peopleWhoCanMove(people, rules, 'approved', r.estValue)
  const keeper = r.keeperId ? people.find(p => p.id === r.keeperId && !p.blocked) : null
  return keeper ? uniqueById([keeper, ...byRole]) : byRole
}

/** Handed over, in full or in part. The requester is the one waiting. */
export function planIssued(
  r: RequestFacts,
  entryNo: string,
  fullyIssued: boolean,
): Notice[] {
  if (!r.requestedById) return []
  return [{
    userId: r.requestedById,
    type: WH_EVENTS.issued,
    title: fullyIssued
      ? `${r.reqNo} has been handed over`
      : `${r.reqNo} was part-issued`,
    body: fullyIssued
      ? `Everything you asked for is out on ${entryNo}.`
        + (r.anyReturnable ? ' Some of it must come back.' : '')
      : `Some of it is out on ${entryNo}; the rest is still to come.`,
    url: url(r.id),
    data: { reqNo: r.reqNo, entryNo, fully: fullyIssued },
  }]
}

/** The Atm Head released the material from having to come back. */
export function planReturnWaived(
  r: RequestFacts,
  actorName: string | null,
  reason: string,
): Notice[] {
  if (!r.requestedById) return []
  return [{
    userId: r.requestedById,
    type: WH_EVENTS.returnWaived,
    title: `${r.reqNo} — you need not return it`,
    body: (actorName ? `${actorName} decided it need not come back. ` : 'It need not come back. ')
      + `Reason: ${reason}`,
    url: url(r.id),
    data: { reqNo: r.reqNo, reason },
  }]
}

/** One notice per person per type. Two rules naming the same role would
 *  otherwise send the same person the same thing twice. */
function dedupe(notices: Notice[]): Notice[] {
  const seen = new Set<string>()
  return notices.filter(n => {
    const k = `${n.userId}|${n.type}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function uniqueById(people: Person[]): Person[] {
  const seen = new Set<string>()
  return people.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)))
}
