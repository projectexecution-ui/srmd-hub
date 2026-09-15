import type { PickableOrder } from './orders'
import type { BbStage } from './stages'

/** Twenty bills to walk the flow on — ten contractor, ten vendor.
 *
 *  Aksha, 15 Sep 2026: "remove old and todays test example and make a new set
 *  of 10 Examples with this Logic / Also can u make similar for PO as well -
 *  but the process is little diff than WO."
 *
 *  THE LOGIC these are built to demonstrate is the one he set out the same day:
 *  the Site Head measures ONCE, in IN4, and CT Hub finds that measurement by
 *  the bill number the ERP clerk already typed at entry. No abstract number to
 *  re-key, no second sheet to fill. So every example below carries a REAL IN4
 *  bill number, and the sheet that appears under it is IN4's own.
 *
 *  It works because the abstract is the first document, not the last. Of 2,706
 *  abstracts in the mirror, 661 are sitting there with no certificate at all,
 *  and of those since certified 1,484 were dated BEFORE their certificate
 *  against 13 after. Six of the ten work-order examples are deliberately in
 *  that state — measured, not yet certified — because that is where a bill
 *  spends most of its life and it is exactly what the Disc Head, CT Head and
 *  Atm Head are looking at.
 *
 *  WHERE THE PO FLOW DIFFERS, which is the second half of what he asked:
 *
 *    the measurement   WO  an abstract the Site Head writes
 *                      PO  a GRN — what the store actually received. IN4
 *                          records it when the goods land, days before anyone
 *                          raises a certificate, so a PO bill has something
 *                          real to show from the moment it is entered.
 *    the numbering     WO  a running account, RA-1, RA-2
 *                      PO  no RA at all; IN4 numbers supplier certificates
 *    the advance       WO  occasional
 *                      PO  contractual and common — 215 orders, and on five of
 *                          the examples below it takes the payable to zero
 *    the scope         WO  a written description
 *                      PO  the material list
 *
 *  Pure, so the plan can be read and tested without touching the database. */

export interface ExamplePlan {
  /** 1–20, the order they are created and shown in. */
  n: number
  kind: 'WO' | 'PO'
  /** What this one is for, in one line, shown on the admin screen. */
  title: string
  /** Why it is worth looking at — the thing to check when it opens. */
  check: string
  complexity: 'simple' | 'complex'
  /** The real IN4 order, by number. Every example draws on one: figures
   *  invented for a walkthrough teach nothing about the arithmetic. */
  order: string
  /** The contractor's or supplier's own bill number, exactly as IN4 holds it.
   *
   *  This is the ONE key. IN4 writes it on the abstract (`bill_no`) and later
   *  on the payment certificate (`invoice_no`), so typing it at entry is what
   *  makes the measurement, the ladder and the reconciliation all find each
   *  other. Null where IN4 genuinely has no bill number yet — the goods have
   *  been received but the supplier has not invoiced, which is a real state and
   *  the screen has to survive it. */
  billNo: string | null
  stage: BbStage
  daysAtDesk: number
  billType: string
  /** What the bill claims, in rupees. A real figure off IN4 — the measured
   *  value of the abstract, the gross of the certificate, or the value of the
   *  goods received. */
  claimed: number
  /** Certified below the claim, so the CT Head's cut is visible. */
  netFromClaim?: boolean
  amendment?: boolean
}

export const EXAMPLE_PLANS: ExamplePlan[] = [
  /* ── Work orders ─────────────────────────────────────────────────────── */
  {
    n: 1, kind: 'WO', complexity: 'simple',
    title: 'Just entered — and the abstract is ALREADY there',
    check: 'This is the whole point of the new flow. Nobody has touched it since entry, yet the Abstract sheet is on the page: the Site Head measured it in IN4, and CT Hub found it by the bill number CV/RU-56. It says "measured in IN4 · not yet certified", because Billing has raised nothing — so there is no certified figure and the page does not pretend there is.',
    order: 'WO/SRET/RU/2026-27/161', billNo: 'CV/RU-56',
    stage: 'submitted', daysAtDesk: 0, billType: 'Running', claimed: 71_500,
  },
  {
    n: 2, kind: 'WO', complexity: 'simple',
    title: 'With the Site Head — 23 measured items',
    check: 'The richest sheet of the twenty. Twenty-three BOQ lines with what was ordered, what is measured to date and what is left, all read out of IN4. Nothing was typed here. Abs/SRASSK/SQ/2026-27/206, made on 10 September.',
    order: 'WO/SRASSK/SQ/2026-27/105', billNo: 'SR/26-27/67',
    stage: 'site_head', daysAtDesk: 2, billType: 'Running', claimed: 11_16_653,
  },
  {
    n: 3, kind: 'WO', complexity: 'simple',
    title: 'With the Disc Head — ₹52 lakh, seven items',
    check: 'A large measured bill on P2 A02, waiting on the discipline head. Seven items against a ₹2.79 crore order. The Bills-on-this-order table below shows every earlier bill and what is left after each.',
    order: 'WO/SRASSK/P2ST/2025-26/326', billNo: 'SRASSK-PH02-A02/05',
    stage: 'disc_head', daysAtDesk: 1, billType: 'Running', claimed: 52_35_271,
  },
  {
    n: 4, kind: 'WO', complexity: 'complex',
    title: 'An awkward bill number still finds its sheet',
    check: 'The bill number is "INVOICE NO -154/Dt-05-09-2026 & INVOICE NO-156/Dt-05-09-2026" — 59 characters, two invoices in one string, spaces and slashes. It still matches IN4 exactly, and sixteen measured items appear. This is why the match is on the stored number and never on a tidied-up version of it.',
    order: 'WO/SRJT/SRAH/2024-25/47',
    billNo: 'INVOICE NO -154/Dt-05-09-2026 & INVOICE NO-156/Dt-05-09-2026',
    stage: 'ct_head', daysAtDesk: 3, billType: 'Running', claimed: 10_60_482,
  },
  {
    n: 5, kind: 'WO', complexity: 'complex',
    title: 'Nine days at the CT Head desk — past its SLA',
    check: 'Three days is the limit for this desk, so it is red on the home page, red in the desk list and red on the timeline. It is also the oldest thing waiting, which is why its desk sorts to the top.',
    order: 'WO/SRASSK/VVST/2026-27/74', billNo: 'SRASSK-PH2-VVK/4',
    stage: 'ct_head', daysAtDesk: 9, billType: 'Running', claimed: 4_82_448,
  },
  {
    n: 6, kind: 'WO', complexity: 'complex',
    title: 'With the Atm Head — certified, and the advance bites',
    check: 'A real certificate exists for this one, so the full ladder shows: ₹98.07 L basic, ₹1.16 Cr gross, ₹4.76 L retention held and ₹9.52 L of advance recovered. Fifteen measured items that add up to the certified figure to the rupee. It also appears in My Approvals.',
    order: 'WO/SRASSK/NGH/2024-25/271', billNo: 'SRASSK-GHA/10',
    stage: 'atm_approval', daysAtDesk: 4, billType: 'Running', claimed: 1_15_72_438,
  },
  {
    n: 7, kind: 'WO', complexity: 'complex',
    title: 'On a building CT Hub has no project for',
    check: 'Common Facility Block has no CT Hub project, and the bill still books — against its IN4 sub-project, shown as "Books under: Bills Approval project". This is the case covering most of the money: 887 of the 1,228 numbered work orders are on buildings with no CT Hub project at all.',
    order: 'WO/SRET/RU/2025-26/271', billNo: '53',
    stage: 'atm_approval', daysAtDesk: 6, billType: 'Running', claimed: 8_86_542,
  },
  {
    n: 8, kind: 'WO', complexity: 'complex',
    title: 'Takes the work order past its value',
    check: 'The order is ₹88,949 and it is already fully measured; this claims 20% more. The red amendment banner spells out the arithmetic and says an IN4 amendment is needed before payment — and the bill still goes for checking rather than being blocked.',
    order: 'WO/SRET/RU/2026-27/153', billNo: 'BILL NO 04',
    stage: 'ct_head', daysAtDesk: 2, billType: 'Running', claimed: 1_06_739, amendment: true,
  },
  {
    n: 9, kind: 'WO', complexity: 'complex',
    title: 'At CT Billing — 41 measured items, certificate raised',
    check: 'The longest sheet in the set: 41 items on one bill. Billing has keyed the certificate, so the ladder is real and the sheet now reconciles against a certified figure instead of saying there is nothing to compare. The whole ₹26.6 L was taken by advance recovery — net payable is nil.',
    order: 'WO/SRJT/SRAH/2025-26/111', billNo: 'KC/BHI/015/26-27',
    stage: 'ct_billing', daysAtDesk: 2, billType: 'Running', claimed: 26_59_165,
  },
  {
    n: 10, kind: 'WO', complexity: 'complex',
    title: 'Certified down, now with the Trust',
    check: 'Net payable is under the claim — the CT Head cut it, and both figures are shown. Days at the Trust are counted but never coloured red: the bill has left CT and nobody here can move it. IN4 has it as Partially Paid with ₹87,861 still outstanding.',
    order: 'WO/SRASSK/NGH/2024-25/270', billNo: 'SRASSK-GHB/11',
    stage: 'trust', daysAtDesk: 12, billType: 'Full & Final', claimed: 51_83_822, netFromClaim: true,
  },

  /* ── Purchase orders ─────────────────────────────────────────────────── */
  {
    n: 11, kind: 'PO', complexity: 'simple',
    title: 'PO just entered — the goods arrived today',
    check: 'The PO answer to example 1. No supplier certificate exists, but seven materials worth ₹10.66 L were received against this order on 15 September and the panel shows them: "Goods received, not yet billed". A purchase order is measured by what arrived, not by a measurement sheet.',
    order: 'PO/SRASSK/NGH/2026-27/88', billNo: null,
    stage: 'submitted', daysAtDesk: 0, billType: 'Running', claimed: 10_65_979,
  },
  {
    n: 12, kind: 'PO', complexity: 'simple',
    title: 'PO with the Site Head — 43 materials received',
    check: 'Forty-three electrical items received in one GRN against a ₹2.6 L order, every one with its ordered quantity, what has been received to date and the balance. No RA number anywhere: a supplier bill is not a running account.',
    order: 'PO/SRASSK/AB/2026-27/94', billNo: null,
    stage: 'site_head', daysAtDesk: 1, billType: 'Running', claimed: 2_59_919,
  },
  {
    n: 13, kind: 'PO', complexity: 'simple',
    title: 'PO with the Disc Head — eighteen small items',
    check: 'A ₹22,562 order of machinery-store consumables, fully received. Small money, eighteen lines — the case where the material list matters more than the total, and where the scope on the bill is read off the order rather than typed.',
    order: 'PO/SRASSK/NGH/2026-27/91', billNo: null,
    stage: 'disc_head', daysAtDesk: 2, billType: 'Running', claimed: 22_562,
  },
  {
    n: 14, kind: 'PO', complexity: 'complex',
    title: 'PO with the Atm Head — 70 billed lines, one GRN',
    check: 'A certified supplier bill: 70 pay lines folded into one row per material, all from a single goods receipt, adding up to ₹4.70 L — which is what IN4 bills, to the rupee. Supplier bills reconcile on 1,376 of 1,376 certificates, better than the contractor side manages.',
    order: 'PO/SRET/RU/2025-26/300', billNo: '2951',
    stage: 'atm_approval', daysAtDesk: 3, billType: 'Running', claimed: 4_70_446,
  },
  {
    n: 15, kind: 'PO', complexity: 'complex',
    title: 'The advance takes the whole bill',
    check: 'Gross ₹2,99,666 and payable ZERO — every rupee recovered against the advance. The Advance panel shows ₹17.59 L taken on this order, what has come back and what is still to recover. Without that panel a bill worth nothing looks like a mistake instead of a recovery.',
    order: 'PO/SRASSK/NGH/2026-27/9', billNo: 'SI26-27260502128',
    stage: 'atm_approval', daysAtDesk: 5, billType: 'Running', claimed: 2_99_666,
  },
  {
    n: 16, kind: 'PO', complexity: 'complex',
    title: 'Part of the advance recovered, part paid',
    check: 'The same order, a later bill: ₹3,07,838 gross, ₹2,42,642 recovered against the advance, ₹65,196 actually payable. Read it next to example 15 to see the advance running down.',
    order: 'PO/SRASSK/NGH/2026-27/9', billNo: 'SI26-27260502328',
    stage: 'ct_head', daysAtDesk: 4, billType: 'Running', claimed: 3_07_838,
  },
  {
    n: 17, kind: 'PO', complexity: 'complex',
    title: 'A PO that buys for three sub-projects',
    check: 'Granite across three sub-projects on one order. The entry form offers all three as chips and books to the one carrying the most value; forty-nine purchase orders are like this. It has also taken two advances totalling ₹4.94 L with nothing billed against it yet.',
    order: 'PO/SRET/RU/2025-26/253', billNo: null,
    stage: 'site_head', daysAtDesk: 6, billType: 'Advance', claimed: 3_01_471,
  },
  {
    n: 18, kind: 'PO', complexity: 'complex',
    title: 'PO billed out in full',
    check: 'Ordered ₹5,50,210, billed ₹5,50,208 — two rupees left, so Balance to bill is effectively nil and a further bill would be flagged. Forty-two plumbing materials on one certificate.',
    order: 'PO/SRASSK/NGH/2025-26/120', billNo: '604',
    stage: 'ct_billing', daysAtDesk: 2, billType: 'Full & Final', claimed: 5_50_208,
  },
  {
    n: 19, kind: 'PO', complexity: 'complex',
    title: 'A ₹1,770 bill, nine days late',
    check: 'Small money still has to move. Three materials, ₹1,500 basic plus ₹270 GST, sitting nine days at a two-day desk. It proves the SLA colouring is about time, not size — and it is the kind of bill that quietly rots because nobody thinks it is worth chasing.',
    order: 'PO/SRJT/SRAH/2026-27/27', billNo: '847/26-27',
    stage: 'ct_head', daysAtDesk: 9, billType: 'Running', claimed: 1_770,
  },
  {
    n: 20, kind: 'PO', complexity: 'complex',
    title: 'PO paid, sitting with the Trust',
    check: 'Certificate 1315, ₹3.42 L, paid in full in IN4. The days at the Trust are counted and never called late. This is the end state the whole chain is aiming at, and the figure came straight from IN4 rather than being typed here.',
    order: 'PO/SRASSK/NGH/2026-27/20', billNo: '605',
    stage: 'trust', daysAtDesk: 14, billType: 'Running', claimed: 3_42_776,
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
  bill_no: string | null
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

/** Turn the plans plus the orders they name into rows to insert.
 *
 *  `today` is passed in rather than read, so the same plan always produces the
 *  same rows in a test. A plan whose order is missing from IN4 is skipped
 *  rather than invented — a walkthrough built on an order that does not exist
 *  would teach the wrong arithmetic. */
export function buildExamples(
  plans: ExamplePlan[],
  orders: Map<string, PickableOrder>,
  resolve: (o: PickableOrder) => { projectId: string | null; subprojectId: number | null; discipline: string | null },
  today: Date = new Date(),
): ExamplePayload[] {
  const out: ExamplePayload[] = []
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  for (const p of plans) {
    const o = orders.get(p.order)
    if (!o) continue

    const billDate = new Date(today)
    billDate.setDate(billDate.getDate() - p.daysAtDesk - 2)

    const r = resolve(o)
    out.push({
      // The one field the whole page branches on. A vendor bill entered as a
      // work-order bill would look right and read the wrong IN4 tables.
      order_type: o.kind,
      bill_type: p.billType,
      order_no: o.orderNo,
      project_id: r.projectId,
      in4_subproject_id: r.subprojectId,
      vendor_text: o.party || (o.kind === 'WO' ? 'Contractor not named in IN4' : 'Supplier not named in IN4'),
      work: o.workDescription,
      // The key. Not a made-up "EX-01" — without the real number nothing links
      // and the example would demonstrate the opposite of the point.
      bill_no: p.billNo,
      // A running account is a work-order idea. IN4 numbers supplier
      // certificates instead, so a PO bill carries no RA number rather than an
      // invented one.
      ra_no: o.kind === 'WO' ? `RA-${o.bills + 1}` : null,
      bill_date: iso(billDate),
      claimed_amount: p.claimed,
      // Only where the CT Head has already locked it — before that desk there
      // is no certified figure, and inventing one would misread the flow.
      net_amount: p.netFromClaim ? Math.round(p.claimed * 0.93) : null,
      trust: o.trust,
      wo_value: Math.round(o.orderedGross),
      paid_till_date: Math.round(o.billedGross),
      // Never asked for at entry and never seeded: the abstract is found by the
      // bill number now, which is the whole change these examples demonstrate.
      abstract_no_in4: null,
      wo_pending: false,
      amendment_flag: p.amendment ?? false,
      stage: p.stage,
      days_at_desk: p.daysAtDesk,
      note: `Example ${p.n}: ${p.title}`,
    })
  }
  return out
}
