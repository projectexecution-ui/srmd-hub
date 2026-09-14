/** Comparing what the Atm Head sanctioned here against what IN4 ended up with.
 *
 *  Runs on every sanctioned bill, on every sweep, until the bill is paid —
 *  not once when the approval lands. About one certificate in eight moves
 *  again after being approved: 91 go back for re-submission, 80 are put on
 *  hold, 70 are approved a second time, 32 are cancelled. A match taken at the
 *  moment of entry and never re-checked would miss every one of those.
 *
 *  Pure. The sweep reads and writes; this only decides. */

export type Verdict = 'matched' | 'amount_differs' | 'awaiting_in4' | 'gone'

export interface Sanction {
  id: string
  certificateId: number
  displayNo: string | null
  sanctionedAmount: number
  sanctionedAt: string
  /** Null on the first check. */
  verdict: Verdict | null
  notifiedAt: string | null
}

/** The certificate as IN4 has it now, or null if it is no longer in the mirror. */
export interface In4Cert {
  certificateId: number
  statusName: string | null
  /** Payable — what the contractor actually gets, after GST, retention and
   *  recoveries. The sanction is on this figure, never on the bill value: a
   *  bill of ₹1.13 crore with ₹1.03 crore of advance recovered is ₹0 payable,
   *  and comparing bill values would call that a match. */
  payable: number
}

/** The approval movement on that certificate, if it has happened. */
export interface In4Approval {
  at: string
  actorName: string | null
}

export interface Check {
  sanctionId: string
  certificateId: number
  displayNo: string | null
  verdict: Verdict
  sanctionedAmount: number
  in4Amount: number | null
  in4Status: string | null
  in4ApprovedAt: string | null
  in4ApprovedBy: string | null
  /** The gap, positive when IN4 is higher. Null unless the verdict is a difference. */
  difference: number | null
  /** True when this verdict is new, or is a difference nobody has been told
   *  about yet. A matched bill is told once and then stays quiet. */
  shouldNotify: boolean
}

/** Rupees. Below this the two sides are treated as equal — IN4 stores paise on
 *  some certificates and the app rounds for display, so an exact comparison
 *  would raise a false alarm on a half-rupee. Anything a person would notice
 *  is far above this. */
export const TOLERANCE = 1

const LIVE_BEFORE_APPROVAL = new Set(['submitted', 'verify', 'resubmit', 'hold'])

export function checkOne(
  s: Sanction,
  cert: In4Cert | null,
  approval: In4Approval | null,
): Check {
  const base = {
    sanctionId: s.id,
    certificateId: s.certificateId,
    displayNo: s.displayNo,
    sanctionedAmount: s.sanctionedAmount,
    in4ApprovedAt: approval?.at ?? null,
    in4ApprovedBy: approval?.actorName ?? null,
  }

  // The certificate has left the mirror entirely — cancelled and pruned, or a
  // sync that dropped it. Either way somebody sanctioned money against a
  // document that is no longer there, and that is never a quiet outcome.
  if (!cert) {
    return {
      ...base, verdict: 'gone', in4Amount: null, in4Status: null, difference: null,
      shouldNotify: s.verdict !== 'gone',
    }
  }

  const status = (cert.statusName ?? '').trim().toLowerCase()

  // Still working its way up to the approval. Nothing to compare yet, and
  // nothing worth saying.
  if (!approval && LIVE_BEFORE_APPROVAL.has(status)) {
    return {
      ...base, verdict: 'awaiting_in4', in4Amount: cert.payable, in4Status: cert.statusName,
      difference: null, shouldNotify: false,
    }
  }

  const difference = cert.payable - s.sanctionedAmount
  if (Math.abs(difference) <= TOLERANCE) {
    return {
      ...base, verdict: 'matched', in4Amount: cert.payable, in4Status: cert.statusName,
      difference: null,
      // Said once, when it first matches. After that silence is the message.
      shouldNotify: s.verdict !== 'matched',
    }
  }

  return {
    ...base, verdict: 'amount_differs', in4Amount: cert.payable, in4Status: cert.statusName,
    difference,
    // A difference is repeated whenever it changes or has never been sent —
    // being told once about ₹396 and then never again is how it gets lost.
    shouldNotify: s.verdict !== 'amount_differs' || !s.notifiedAt,
  }
}

export function checkAll(
  sanctions: Sanction[],
  certs: Map<number, In4Cert>,
  approvals: Map<number, In4Approval>,
): Check[] {
  return sanctions.map(s => checkOne(s, certs.get(s.certificateId) ?? null, approvals.get(s.certificateId) ?? null))
}

const inr = (n: number) => '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN')

/** What the Atm Head and CT Billing actually read. */
export function noticeFor(c: Check): { title: string; body: string } | null {
  const id = c.displayNo || `certificate ${c.certificateId}`
  const by = c.in4ApprovedBy ? ` Entered by ${c.in4ApprovedBy}.` : ''

  if (c.verdict === 'matched') return {
    title: `${id} matched`,
    body: `Live in IN4 at ${inr(c.sanctionedAmount)}, exactly what was sanctioned.${by} Nothing to do.`,
  }
  if (c.verdict === 'amount_differs') {
    const d = c.difference ?? 0
    return {
      title: `${id} does not match — ${inr(d)} ${d > 0 ? 'higher' : 'lower'} in IN4`,
      body: `Sanctioned ${inr(c.sanctionedAmount)}; IN4 says ${inr(c.in4Amount ?? 0)}, a difference of ${inr(d)}.${by} Open it.`,
    }
  }
  if (c.verdict === 'gone') return {
    title: `${id} has disappeared from IN4`,
    body: `${inr(c.sanctionedAmount)} was sanctioned against this certificate and it is no longer in IN4 — cancelled, or never keyed in. Check before anything is paid.`,
  }
  return null
}
