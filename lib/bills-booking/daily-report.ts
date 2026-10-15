// The Daily Bills Report, made from Bills Approval (Aksha, 14 Oct 2026: "add
// this Daily Report feature … so the Billing team can make the report and
// share to management on daily basis"; source picked: "Bills Approval only").
//
// The same shape management already reads from the Zoho report: what was paid
// that day, then what sits at each trust's accounts — here "At Trust A/c", the
// step after the Atm Head approves in IN4 — with the courier / submission date
// and a remark CT Billing types. Built from each bill's own stage history, so a
// past date shows what was really at the trust that evening.
//
// Pure: bills in, report out.

export const REMARK_OPTIONS = [
  'Cheque Received', 'Under A/c -Process', 'Online Payment',
  'Adjust Against Advance', 'Adjust Against Advance (By Purchase Dep.)', 'Hold Amount Release',
]
export const TRUSTS = ['SRET', 'SRAH', 'SRASSK', 'SRA'] as const
/** These trusts take a courier date; the others a submission date (as in the Zoho report). */
export const COURIER_TRUSTS = new Set(['SRET'])
export const UNSET = '—'

export interface ReportEvent { to: string; at: string; amount: number | null }

export interface ReportBillInput {
  id: string
  /** The hub number (WCE-9). Null before 15 Oct 2026 and on examples. */
  serial: string | null
  vendor: string
  project: string
  billNo: string | null
  /** The trust the bill's order belongs to (WO/SRASSK/… → SRASSK), if known. */
  trust: string | null
  /** IN4's payable when known, else the CT Head's net, else the claim. */
  amount: number
  events: ReportEvent[]
  /** What CT Billing typed for the report. */
  mark: { sentDate: string | null; remark: string | null; trust: string | null } | null
  /** Shown on the row: "On hold in IN4: …" / "Processed by Accounts". */
  note?: string | null
}

export interface ReportRow {
  id: string
  serial: string | null
  vendor: string
  project: string
  billNo: string | null
  amount: number
  /** Paid on (paid rows) or courier / submission date (trust rows), YYYY-MM-DD. */
  date: string | null
  /** True when the date is the day it reached the trust, not one typed in. */
  dateIsDefault: boolean
  days: number | null
  remark: string | null
  note: string | null
  trust: string
  /** The trust came from the order number, so there is nothing to choose. */
  trustFromOrder: boolean
}

export interface TrustGroup { trust: string; dateLabel: 'Courier' | 'Submission'; rows: ReportRow[]; total: number }

export interface DailyReport {
  date: string
  paid: ReportRow[]
  paidTotal: number
  groups: TrustGroup[]
  atTrustCount: number
  atTrustTotal: number
}

/** The calendar day in India for an instant. */
export const istDay = (iso: string): string => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10)
const endOfIstDay = (day: string): number => Date.parse(`${day}T23:59:59.999+05:30`)
const dayDiff = (from: string, to: string): number =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000))

function lastBy(events: ReportEvent[], end: number, pred: (e: ReportEvent) => boolean): ReportEvent | null {
  let best: ReportEvent | null = null
  for (const e of events) {
    const t = Date.parse(e.at)
    if (t > end || !pred(e)) continue
    if (!best || t >= Date.parse(best.at)) best = e
  }
  return best
}

export function buildDailyReport(bills: ReportBillInput[], date: string): DailyReport {
  const end = endOfIstDay(date)
  const paid: ReportRow[] = []
  const atTrust: ReportRow[] = []

  for (const b of bills) {
    const trust = (b.mark?.trust || b.trust || '').trim().toUpperCase() || UNSET
    const trustFromOrder = !b.mark?.trust && !!b.trust?.trim()
    const base = { id: b.id, serial: b.serial, vendor: b.vendor, project: b.project, billNo: b.billNo, remark: b.mark?.remark ?? null, note: b.note ?? null, trust, trustFromOrder }

    // Paid that day.
    const paidEv = b.events.find(e => e.to === 'paid' && istDay(e.at) === date)
    if (paidEv) {
      paid.push({ ...base, amount: Number(paidEv.amount ?? b.amount), date, dateIsDefault: true, days: null })
      continue
    }

    // At the trust at the end of that day.
    const last = lastBy(b.events, end, () => true)
    if (last?.to !== 'trust') continue
    const reached = lastBy(b.events, end, e => e.to === 'trust')
    const typed = b.mark?.sentDate || null
    const eff = typed ?? (reached ? istDay(reached.at) : null)
    atTrust.push({ ...base, amount: b.amount, date: eff, dateIsDefault: !typed, days: eff ? dayDiff(eff, date) : null })
  }

  const order = (t: string) => {
    const i = (TRUSTS as readonly string[]).indexOf(t)
    return t === UNSET ? 999 : i < 0 ? 100 : i
  }
  const trusts = [...new Set(atTrust.map(r => r.trust))].sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  const groups: TrustGroup[] = trusts.map(t => {
    // Newest first, as management reads the Zoho report today.
    const rows = atTrust.filter(r => r.trust === t).sort((a, b) => (a.days ?? 0) - (b.days ?? 0) || a.vendor.localeCompare(b.vendor))
    return { trust: t, dateLabel: COURIER_TRUSTS.has(t) ? 'Courier' : 'Submission', rows, total: rows.reduce((s, r) => s + r.amount, 0) }
  })

  paid.sort((a, b) => b.amount - a.amount)
  return {
    date,
    paid,
    paidTotal: paid.reduce((s, r) => s + r.amount, 0),
    groups,
    atTrustCount: atTrust.length,
    atTrustTotal: atTrust.reduce((s, r) => s + r.amount, 0),
  }
}
