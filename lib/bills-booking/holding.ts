import { stageDef, isTerminal, daysAtStage, isOverSla, slaFor, type BbStage } from './stages'

/** Who is holding which bill, and how long they have had it.
 *
 *  Aksha, 15 Sep 2026, on the Bills Approval landing page: "does these Blocks
 *  are really needed to be in front or rather when Managmnet wants can refer -
 *  better keep my Approvals and Pending Bills to be on More concenrated and
 *  similar which can track the Bills and respective Heads can push the same."
 *
 *  Fair. The page opened with eight report tiles — In flight, Money waiting,
 *  Retention, Never closed, Sanctions, Daily report, No work order, Where bills
 *  book. Every one is a place to look BACK at what happened. None of them tells
 *  the person in front of the screen what is sitting on their own desk, and
 *  none names the head who has to move the next one. Those are reference; this
 *  is the job.
 *
 *  So the page now opens on one list: every bill still moving, grouped by the
 *  desk that holds it, with that desk's people named. The desk that has been
 *  sitting longest comes first, because that is the one somebody has to push.
 *
 *  A desk with nobody on it is not hidden. A bill nobody owns is the worst
 *  case in the whole flow — it does not chase itself and no SLA badge will ever
 *  be read by the person who should have acted — so it is called out rather
 *  than left to look like an empty queue.
 *
 *  Pure: the page fetches and resolves the desks, this decides. */

export interface PendingBill {
  id: string
  vendor: string
  billNo: string | null
  orderType: string
  projectLabel: string
  amount: number
  stage: BbStage
  stageSince: string
  isExample: boolean
  woPending: boolean
  amendmentFlag: boolean
}

export interface HeldBill extends PendingBill {
  days: number
  late: boolean
  /** The one thing wrong with it, if anything is. Ranked: a bill that cannot be
   *  paid without an IN4 amendment beats one that is merely late. */
  flag: 'amendment' | 'no_wo' | 'late' | null
}

export interface DeskHold {
  stage: BbStage
  label: string
  /** Who has to act. */
  holders: string[]
  /** Nobody is on this desk — the bills here cannot move until somebody is. */
  orphan: boolean
  /** The person looking at the screen is one of the holders. */
  mine: boolean
  bills: HeldBill[]
  /** Money at this desk. Example bills are excluded, exactly as they are from
   *  every other figure in the section — a demo row counted as money is worse
   *  than no demo at all. */
  value: number
  lateCount: number
  /** The longest anything has waited here. What the order is decided on. */
  oldestDays: number
  /** The section's own SLA for this desk, for the "3 of 5 days" line. */
  slaDays: number | undefined
}

export interface DeskKeyed {
  holders: string[]
  mine: boolean
}

/** Group the bills still moving by the desk that holds them.
 *
 *  `deskOf` answers "who is on this bill's desk" — resolved by the page
 *  through `bb_stage_members`, which is the one place that logic lives. It is
 *  passed in rather than reimplemented here: a second copy of the desk rules in
 *  TypeScript would drift from the SQL the day somebody changed one of them. */
export function whoHoldsWhat(
  bills: PendingBill[],
  deskOf: (b: PendingBill) => DeskKeyed,
  now: number = Date.now(),
): DeskHold[] {
  const groups = new Map<BbStage, DeskHold>()

  for (const b of bills) {
    if (isTerminal(b.stage)) continue
    const days = daysAtStage(b.stageSince, now)
    const late = isOverSla(b.stage, b.stageSince, now)

    let g = groups.get(b.stage)
    if (!g) {
      const { holders, mine } = deskOf(b)
      g = {
        stage: b.stage,
        label: stageDef(b.stage).label,
        holders,
        orphan: holders.length === 0,
        mine,
        bills: [],
        value: 0,
        lateCount: 0,
        oldestDays: 0,
        slaDays: slaFor(b.stage),
      }
      groups.set(b.stage, g)
    } else {
      // Two bills at the same stage can sit on different desks — a different
      // project, a different sub-project. The group names everybody who holds
      // any of them rather than only the first bill's desk.
      const { holders, mine } = deskOf(b)
      for (const h of holders) if (!g.holders.includes(h)) g.holders.push(h)
      g.orphan = g.holders.length === 0
      g.mine = g.mine || mine
    }

    g.bills.push({
      ...b,
      days,
      late,
      flag: b.amendmentFlag ? 'amendment' : b.woPending ? 'no_wo' : late ? 'late' : null,
    })
    if (!b.isExample) g.value += b.amount
    if (late) g.lateCount += 1
    if (days > g.oldestDays) g.oldestDays = days
  }

  for (const g of groups.values()) {
    // Oldest first inside a desk: the top of a queue is the thing that has been
    // waiting longest, not the thing that arrived last.
    g.bills.sort((a, b) => b.days - a.days || b.amount - a.amount)
  }

  // The desk sitting longest comes first — that is the one to push. A tie goes
  // to the one holding more money.
  return [...groups.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.value - a.value)
}

export interface HoldSummary {
  bills: number
  /** Live money, examples excluded. */
  value: number
  late: number
  /** Bills sitting at a desk with nobody on it. */
  orphaned: number
  /** Bills on a desk this person is on. */
  mine: number
}

export function summarise(desks: DeskHold[]): HoldSummary {
  return {
    bills: desks.reduce((s, d) => s + d.bills.length, 0),
    value: desks.reduce((s, d) => s + d.value, 0),
    late: desks.reduce((s, d) => s + d.lateCount, 0),
    orphaned: desks.filter(d => d.orphan).reduce((s, d) => s + d.bills.length, 0),
    mine: desks.filter(d => d.mine).reduce((s, d) => s + d.bills.length, 0),
  }
}
