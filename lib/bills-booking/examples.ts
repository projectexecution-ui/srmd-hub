import type { PickableOrder } from './orders'
import type { BbStage } from './stages'

/** Ten bills to walk the flow on — simple first, awkward after.
 *
 *  Aksha, 14 Sep 2026: "make few 10 Live Examples - simple and complex in the
 *  Admin page which i can check and review and then we decide to remove."
 *
 *  bb_bills holds three real records. Nobody can judge an approval chain from
 *  three, and nobody should have to learn it by typing ten bills first. So
 *  these are seeded — but from REAL IN4 work orders, with the contractor, the
 *  ordered value and what has already been billed read off the ERP, because a
 *  walkthrough on invented figures teaches you nothing about the arithmetic.
 *
 *  Deliberately spread across the desks, so the timeline, the waiting columns
 *  and the SLA colouring all have something to show, and deliberately
 *  including the cases that go wrong in real life: over the work-order value,
 *  no WO yet, a building CT Hub has no project for, held, rejected, paid.
 *
 *  Pure, so the plan can be read and tested without touching the database. */

export interface ExamplePlan {
  /** 1–10, the order they are created and shown in. */
  n: number
  /** What this one is for, in one line, shown on the admin screen. */
  title: string
  /** Why it is worth looking at — the thing to check when it opens. */
  check: string
  complexity: 'simple' | 'complex'
  /** Which of the picked work orders to draw from, by index. Null = no order. */
  woIndex: number | null
  /** A specific work order, by number, where the example has to land on one —
   *  the four that carry a real abstract sheet in IN4. The seeder looks it up
   *  and puts it at `woIndex`; without it the measurement on screen would
   *  belong to somebody else's order. */
  pinnedWo?: string
  stage: BbStage
  daysAtDesk: number
  billType: string
  /** A share of what is left to bill on that work order. 1.2 deliberately
   *  overshoots, to raise the amendment flag. */
  shareOfBalance: number
  woPending?: boolean
  amendment?: boolean
  /** The IN4 certificate this example points at, where the flow says one would
   *  exist by now. A REAL ENP number on the same work order, so the bill page
   *  shows the certified ladder — basic, tax, retention, advance recovery, what
   *  is left — instead of an estimate. */
  abstract?: string
  netFromClaim?: boolean
  orderType?: string
  work?: string
  vendor?: string
}

export const EXAMPLE_PLANS: ExamplePlan[] = [
  {
    n: 1, complexity: 'simple',
    title: 'A plain running bill, just entered',
    check: 'It sits at Entered — your own desk — not at the Site Head. That is what the form now says it does.',
    woIndex: 0, stage: 'submitted', daysAtDesk: 0, billType: 'Running', shareOfBalance: 0.18,
  },
  {
    n: 2, complexity: 'simple',
    title: 'The ABSTRACT MAKER — the sheet filled here, not in IN4',
    check: 'Six BOQ lines off the work order, five of them measured. You type only This Qty; This Amt, Cumulative, Balance, GST, Retention and the green Net Payable all compute. Line 3 is already finished and says "done". Saving writes the figures onto the bill and leaves a line in its history.',
    woIndex: 1, stage: 'site_head', daysAtDesk: 3, billType: 'Running', shareOfBalance: 0.22,
    pinnedWo: 'WO/SRJT/SRAH/2024-25/50',
  },
  {
    n: 3, complexity: 'simple',
    title: 'With the Disc Head, abstract recorded',
    check: 'The ABSTRACT SHEET — two measured items with their ordered quantity, what is measured to date and what is left. It adds up to the certified figure to the rupee.',
    woIndex: 2, stage: 'disc_head', daysAtDesk: 1, billType: 'Running', shareOfBalance: 0.3,
    pinnedWo: 'WO/SRASSK/NGH/2025-26/271', abstract: 'ENP/SRASSK/NGH/2025-26/500',
  },
  {
    n: 4, complexity: 'simple',
    title: 'Waiting on the Atm Head',
    check: 'In My Approvals saying Approve — a 5-line abstract sheet, and the calculation showing why payable collapses: 29.8 lakh of advance recovered against 33.8 lakh certified.',
    woIndex: 3, stage: 'atm_approval', daysAtDesk: 4, billType: 'Running', shareOfBalance: 0.25,
    pinnedWo: 'WO/SRJT/SRAH/2025-26/5', abstract: 'ENP/SRJT/SRAH/2025-26/103',
  },
  {
    n: 5, complexity: 'complex',
    title: 'Past its SLA at the CT Head desk',
    check: 'Nine days against a three-day limit. It counts in Over SLA on the home page and the timeline segment is red.',
    woIndex: 4, stage: 'ct_head', daysAtDesk: 9, billType: 'Running', shareOfBalance: 0.2,
    abstract: 'ABS/SQ/2026-27/094',
  },
  {
    n: 6, complexity: 'complex',
    title: 'Takes the work order past its value',
    check: 'The red amendment banner with the arithmetic spelled out — and its certificate is one of the 20% where IN4 own figures do not add up, so the calculation shows both totals and says so rather than picking one.',
    woIndex: 5, stage: 'ct_head', daysAtDesk: 2, billType: 'Running', shareOfBalance: 1.2,
    pinnedWo: 'WO/SRASSK/P2ST/2025-26/326', amendment: true, abstract: 'ENP/SRASSK/P2ST/2026-27/2',
  },
  {
    n: 7, complexity: 'complex',
    title: 'The bill came before the work order',
    check: 'Marked to be regularised. About a third of bills arrive this way; it ages from its own bill date and has no order number.',
    woIndex: null, stage: 'site_head', daysAtDesk: 11, billType: 'Running', shareOfBalance: 0,
    woPending: true, orderType: 'Without WO/PO',
    vendor: 'Shreeji Enterprise', work: 'Shuttering and staging, block C',
  },
  {
    n: 8, complexity: 'complex',
    title: 'Petty cash, no order and no abstract',
    check: 'Goes straight to Billing. No work order, no measurement, and the IN4 side of the form is skipped entirely.',
    woIndex: null, stage: 'ct_billing', daysAtDesk: 2, billType: 'Petty Cash', shareOfBalance: 0,
    orderType: 'Without WO/PO', vendor: 'Site petty cash', work: 'Tanker water, fortnight',
  },
  {
    n: 9, complexity: 'complex',
    title: 'On a building CT Hub has no project for',
    check: 'No CT Hub project, and it still books against its IN4 sub-project — the case covering 887 of the 1,228 work orders. The richest sheet of the ten: 9 measured items, 83 lakh certified, 55 lakh of advance recovered.',
    woIndex: 6, stage: 'atm_approval', daysAtDesk: 6, billType: 'Running', shareOfBalance: 0.15,
    pinnedWo: 'WO/SRASSK/SQ/2023-24/7', abstract: 'ENP/SRASSK/SQ/2024-25/42',
  },
  {
    n: 10, complexity: 'complex',
    title: 'Certified down, sitting with the Trust',
    check: 'Net payable is under the claim — the CT Head cut it. Days at the Trust are counted, never called late. And its certificate carries NO GST: 60% of IN4 bills do not.',
    woIndex: 7, stage: 'trust', daysAtDesk: 21, billType: 'Full & Final', shareOfBalance: 0.4,
    netFromClaim: true, abstract: 'ENA/SRASSK/NGH/2026-27/5',
  },
]

/** One row's worth of payload for `bb_rpc_add_example`. */
export interface ExamplePayload extends Record<string, unknown> {
  order_type: string
  bill_type: string
  order_no: string | null
  project_id: string | null
  in4_subproject_id: number | null
  vendor_text: string
  work: string | null
  bill_no: string
  ra_no: string | null
  bill_date: string
  claimed_amount: number
  net_amount: number | null
  trust: string | null
  wo_value: number | null
  paid_till_date: number
  abstract_no_in4: string | null
  wo_pending: boolean
  amendment_flag: boolean
  stage: string
  days_at_desk: number
  note: string
}

/** Turn a plan plus the work orders it draws on into rows to insert.
 *
 *  `today` is passed in rather than read, so the same plan always produces the
 *  same rows in a test. A plan whose work order is missing is skipped rather
 *  than invented — a walkthrough built on a WO that does not exist would teach
 *  the wrong arithmetic. */
export function buildExamples(
  plans: ExamplePlan[],
  wos: PickableOrder[],
  resolve: (wo: PickableOrder) => { projectId: string | null; subprojectId: number | null; discipline: string | null },
  today: Date = new Date(),
): ExamplePayload[] {
  const out: ExamplePayload[] = []
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  for (const p of plans) {
    const wo = p.woIndex == null ? null : wos[p.woIndex]
    if (p.woIndex != null && !wo) continue

    const billDate = new Date(today)
    billDate.setDate(billDate.getDate() - p.daysAtDesk - 2)

    let claimed: number
    let woValue: number | null = null
    let paidTill = 0
    let trust: string | null = null
    let orderNo: string | null = null
    let vendor = p.vendor ?? 'Example contractor'
    let work = p.work ?? null
    let projectId: string | null = null
    let subprojectId: number | null = null
    let discipline: string | null = null

    if (wo) {
      const r = resolve(wo)
      projectId = r.projectId
      subprojectId = r.subprojectId
      discipline = r.discipline
      orderNo = wo.orderNo
      vendor = wo.party || vendor
      work = wo.workDescription ?? work
      trust = wo.trust
      woValue = Math.round(wo.orderedGross)
      paidTill = Math.round(wo.billedGross)
      // A share of what is genuinely left, so the figures sit inside the real
      // order rather than beside it. Floored so a fully-billed WO still gives
      // a usable number.
      const base = wo.balance > 0 ? wo.balance : wo.orderedGross
      claimed = Math.max(1, Math.round(base * p.shareOfBalance))
    } else {
      // No order to read from, so a plain round figure — which is what a petty
      // cash or pre-order bill actually looks like.
      claimed = p.billType === 'Petty Cash' ? 18_500 : 742_000
    }

    out.push({
      order_type: p.orderType ?? 'WO',
      bill_type: p.billType,
      order_no: orderNo,
      project_id: projectId,
      in4_subproject_id: subprojectId,
      vendor_text: vendor,
      work,
      bill_no: `EX-${String(p.n).padStart(2, '0')}`,
      ra_no: wo ? `RA-${wo.bills + 1}` : null,
      bill_date: iso(billDate),
      claimed_amount: claimed,
      // Only where the CT Head has already locked it — before that desk there
      // is no certified figure, and inventing one would misread the flow.
      net_amount: p.netFromClaim ? Math.round(claimed * 0.93) : null,
      trust,
      wo_value: woValue,
      paid_till_date: paidTill,
      abstract_no_in4: p.abstract ?? null,
      wo_pending: p.woPending ?? false,
      amendment_flag: p.amendment ?? false,
      stage: p.stage,
      days_at_desk: p.daysAtDesk,
      note: `Example ${p.n}: ${p.title}`,
    })
  }
  return out
}
