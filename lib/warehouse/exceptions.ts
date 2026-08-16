/** The control reports — the ones that go looking for what is WRONG.
 *
 *  The five registers list what happened. These answer the questions a register
 *  cannot: what has not moved in six months, who has not sent the rest of the
 *  order, which entry number is missing, whose material is still standing on our
 *  site. An exception report that comes back empty is good news, and each one
 *  says so rather than looking broken.
 *
 *  Everything here is pure: the shape of a finding, and the arithmetic that
 *  decides whether something IS a finding. The database reads live in
 *  exception-data.ts, and the screen only draws what these produce.
 */

export type Tone = 'bad' | 'warn' | 'good' | 'muted'

export type Cell = {
  text: string
  /** The raw number, so Excel can still add the column up. */
  num?: number | null
  tone?: Tone
}

export type ReportColumn = { header: string; align?: 'left' | 'right'; width?: number }
export type ReportGroup = { label: string; rows: Cell[][]; footer?: Cell[] }
export type ReportKpi = { label: string; value: string; tone?: Tone; hint?: string }

/** What a control report hands the screen. The server does all the domain work
 *  and the client just draws it, so one component covers every report and none of
 *  them can drift from its own export. */
export type ReportView = {
  key: string
  title: string
  blurb: string
  /** The question this report exists to answer, in the words of the person who
   *  would ask it. */
  question: string
  columns: ReportColumn[]
  groups: ReportGroup[]
  kpis: ReportKpi[]
  caveats: string[]
  /** Shown instead of an empty table. An exception report with nothing in it is
   *  the desired outcome, so it must not read like a failure. */
  emptyGood: string
  error?: string | null
}

export const cell = (text: string, num?: number | null, tone?: Tone): Cell => ({ text, num, tone })

// ---------------------------------------------------------------------------
// Dead stock ageing (#16)
// ---------------------------------------------------------------------------

export const AGE_BUCKETS = [180, 90, 60] as const
export type AgeBucket = 180 | 90 | 60 | null

/** Which "not moved in N days" bucket a line falls into — the WORST one it
 *  qualifies for, since 200 days idle is a 180-day problem, not a 60-day one. */
export function ageBucket(daysIdle: number): AgeBucket {
  for (const b of AGE_BUCKETS) if (daysIdle >= b) return b
  return null
}

/** Whole days between two yyyy-mm-dd dates. Both are IST calendar dates, so this
 *  is deliberately calendar arithmetic and not a timezone conversion. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Entry number gaps (#1)
// ---------------------------------------------------------------------------

/** The whole point of a strictly sequential register: a number that was handed
 *  out but has no entry against it means a movement happened and was not
 *  recorded — or was recorded and then removed. Either way somebody must say
 *  which.
 *
 *  `lastNo` is what the series had reached; `seen` is the numbers that actually
 *  have a live entry. */
export function seriesGaps(lastNo: number, seen: number[]): number[] {
  const have = new Set(seen)
  const gaps: number[] = []
  for (let n = 1; n <= lastNo; n++) if (!have.has(n)) gaps.push(n)
  return gaps
}

/** The trailing number out of an entry number like "In: 13Aug26/001". */
export function entrySeq(entryNo: string): number | null {
  const m = entryNo.match(/\/(\d+)\s*$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Rate variance (#19)
// ---------------------------------------------------------------------------

export type RateObservation = { entity: string | null; party: string | null; rate: number; day: string }

export type RateSpread = {
  low: number
  high: number
  /** high − low. */
  spread: number
  /** As a share of the low rate: 0.25 means the dearest is 25% above the cheapest. */
  spreadPct: number
  cheapest: RateObservation
  dearest: RateObservation
}

/** The spread of rates paid for ONE item. Null when there is nothing to compare
 *  — one rate is not a variance, and reporting it would bury the real ones. */
export function rateSpread(obs: RateObservation[]): RateSpread | null {
  const rated = obs.filter(o => o.rate > 0)
  if (rated.length < 2) return null
  let cheapest = rated[0]
  let dearest = rated[0]
  for (const o of rated) {
    if (o.rate < cheapest.rate) cheapest = o
    if (o.rate > dearest.rate) dearest = o
  }
  if (dearest.rate === cheapest.rate) return null
  return {
    low: cheapest.rate,
    high: dearest.rate,
    spread: dearest.rate - cheapest.rate,
    spreadPct: (dearest.rate - cheapest.rate) / cheapest.rate,
    cheapest,
    dearest,
  }
}

/** Below this the spread is noise — freight, a small order, a different month.
 *  Above it, somebody should be able to say why. */
export const RATE_SPREAD_FLOOR = 0.05

// ---------------------------------------------------------------------------
// Cross-entity consumption (#18)
// ---------------------------------------------------------------------------

export type EntitySpend = { projectName: string; entity: string; qtyLines: number; amount: number }

/** A project whose consumption was charged to more than one entity needs a
 *  settlement between them. One entity is normal and is not a finding.
 *
 *  Note this is what was CHARGED on each issue, not a trace of which truck's
 *  material was used — stock is fungible and pretending otherwise would invent
 *  precision that does not exist. */
export function crossEntity(rows: EntitySpend[]): Array<{
  projectName: string
  entities: EntitySpend[]
  total: number
}> {
  const byProject = new Map<string, EntitySpend[]>()
  for (const r of rows) {
    if (!byProject.has(r.projectName)) byProject.set(r.projectName, [])
    byProject.get(r.projectName)!.push(r)
  }
  return [...byProject.entries()]
    .filter(([, es]) => es.length > 1)
    .map(([projectName, es]) => ({
      projectName,
      entities: [...es].sort((a, b) => b.amount - a.amount || a.entity.localeCompare(b.entity)),
      total: es.reduce((s, e) => s + e.amount, 0),
    }))
    .sort((a, b) => b.total - a.total || a.projectName.localeCompare(b.projectName))
}

// ---------------------------------------------------------------------------
// Returnables (#7)
// ---------------------------------------------------------------------------

export type ReturnableLine = {
  entryNo: string
  day: string
  projectName: string | null
  engineerName: string | null
  itemName: string
  unit: string
  qty: number
  returnedQty: number
  dueDate: string | null
}

export type ReturnableFinding = ReturnableLine & {
  outstanding: number
  daysOut: number
  /** Past its due date, or out with no due date at all. */
  overdueDays: number | null
}

/** Only what is still out counts. A returnable that came back is closed, however
 *  late it was. */
export function outstandingReturnables(lines: ReturnableLine[], today: string): ReturnableFinding[] {
  return lines
    .map(l => {
      const outstanding = l.qty - l.returnedQty
      const daysOut = daysBetween(l.day, today)
      const overdueDays = l.dueDate ? Math.max(0, daysBetween(l.dueDate, today)) : null
      return { ...l, outstanding, daysOut, overdueDays: overdueDays && overdueDays > 0 ? overdueDays : null }
    })
    .filter(l => l.outstanding > 0)
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || b.daysOut - a.daysOut)
}

// ---------------------------------------------------------------------------
// PO follow-up (#21)
// ---------------------------------------------------------------------------

/** Nothing has arrived against this order for a week — the vendor follow-up
 *  threshold from the review. */
export const STALE_PO_DAYS = 7

export type PoLineState = {
  poNo: string
  vendor: string | null
  entity: string | null
  itemName: string
  unit: string
  ordered: number
  received: number
  rate: number | null
  status: string
  /** Last delivery against this PO, any line. Null when nothing has ever come. */
  lastDeliveryDay: string | null
}

export type PoPending = PoLineState & {
  pending: number
  pendingValue: number | null
  daysSinceDelivery: number | null
  stale: boolean
  overReceived: number
}

export function poPending(lines: PoLineState[], today: string): PoPending[] {
  return lines.map(l => {
    const pending = Math.max(0, l.ordered - l.received)
    const days = l.lastDeliveryDay ? daysBetween(l.lastDeliveryDay, today) : null
    return {
      ...l,
      pending,
      pendingValue: l.rate == null ? null : pending * l.rate,
      daysSinceDelivery: days,
      // Never delivered at all is stale too — that is the worst case, not an
      // exemption from the check.
      stale: pending > 0 && (days === null || days >= STALE_PO_DAYS),
      overReceived: Math.max(0, l.received - l.ordered),
    }
  })
}

// ---------------------------------------------------------------------------
// The catalogue. One place that knows every control report, so the hub, the
// routes and the "what is still to come" list can never disagree.
// ---------------------------------------------------------------------------

export type ReportKey =
  | 'count-variance' | 'vendor-balance' | 'shortage-damage' | 'no-po'
  | 'dead-stock' | 'returnables' | 'entity-settlement' | 'rate-variance'
  | 'number-gaps' | 'po-pending' | 'over-receipt' | 'differs-from-in4'
  | 'voided'

export type ReportMeta = {
  key: ReportKey
  title: string
  blurb: string
  question: string
  /** Reads a from/to period, rather than being a position as at today. */
  usesPeriod: boolean
  /** Needs the money columns to be worth opening at all. */
  moneyLed?: boolean
}

export const CONTROL_REPORTS: ReportMeta[] = [
  {
    key: 'count-variance',
    title: 'Physical count & variance',
    blurb: 'Book vs counted, the shortage value, and who signed it off',
    question: 'What did the counts find, and did anybody stand behind it?',
    usesPeriod: true,
  },
  {
    key: 'vendor-balance',
    title: 'Vendor material balance',
    blurb: 'Brought in vs taken back, per vendor',
    question: 'Whose material is still on our site — and has anyone taken back more than he brought?',
    usesPeriod: false,
  },
  {
    key: 'shortage-damage',
    title: 'Shortage & damage',
    blurb: 'Challan vs received, and what arrived broken, by supplier',
    question: 'Which supplier keeps sending short or damaged loads?',
    usesPeriod: true,
  },
  {
    key: 'no-po',
    title: 'No-PO entries',
    blurb: 'Material taken in with no purchase order, and the reason given',
    question: 'How much is coming in without an order, and who keeps doing it?',
    usesPeriod: true,
  },
  {
    key: 'differs-from-in4',
    title: 'Differs from IN4',
    blurb: 'What the gate received was not what IN4 ordered',
    question: 'What needs fixing in IN4 and checking against the bill?',
    usesPeriod: true,
  },
  {
    key: 'dead-stock',
    title: 'Dead stock ageing',
    blurb: 'In stock but not moved in 60 / 90 / 180 days',
    question: 'What is sitting there tying up money and space?',
    usesPeriod: false,
  },
  {
    key: 'returnables',
    title: 'Returnables outstanding',
    blurb: 'Sent out to come back, still not returned',
    question: 'What went out on the promise of coming back, and how long ago?',
    usesPeriod: false,
  },
  {
    key: 'po-pending',
    title: 'PO-wise pending',
    blurb: 'Ordered · received · pending · days since the last delivery',
    question: 'Which vendor owes us material, and for how long?',
    usesPeriod: false,
  },
  {
    key: 'over-receipt',
    title: 'Over-receipt',
    blurb: 'More delivered than was ever ordered',
    question: 'What came in beyond the order, and has anybody settled it?',
    usesPeriod: false,
  },
  {
    key: 'rate-variance',
    title: 'Rate variance',
    blurb: 'The same item taken in at different rates',
    question: 'Are we paying two prices for one material?',
    usesPeriod: true,
    moneyLed: true,
  },
  {
    key: 'entity-settlement',
    title: 'Entity vs project',
    blurb: 'A project whose consumption was charged to more than one entity',
    question: 'Which entities need to settle between themselves?',
    usesPeriod: true,
    moneyLed: true,
  },
  {
    key: 'number-gaps',
    title: 'Entry number gaps',
    blurb: 'A number was handed out but has no entry against it',
    question: 'Did a truck come in or go out without being written down?',
    usesPeriod: true,
  },
  {
    key: 'voided',
    title: 'Voided entries',
    blurb: 'Every entry undone — what it said, who undid it, and why',
    question: 'What has been taken back out of the register, and does the reason hold up?',
    usesPeriod: true,
  },
]

export function reportMeta(key: string): ReportMeta | null {
  return CONTROL_REPORTS.find(r => r.key === key) ?? null
}

/** The three from the design review that cannot be answered yet, and the honest
 *  reason why. Listed rather than dropped: a menu that quietly loses items is
 *  how a requirement gets forgotten. */
export const DEFERRED_REPORTS: Array<{ title: string; blurb: string; why: string }> = [
  {
    title: 'Issued vs estimate',
    blurb: 'Consumption against the Internal Estimate, per discipline',
    why: 'Needs each warehouse item tied to a Cost Control estimate line. Nothing links them yet, '
      + 'and the Internal Estimate is management-confidential, so it cannot be shown on a storekeeper screen.',
  },
  {
    title: 'Stock as on period-end',
    blurb: 'A frozen figure for the accounts',
    why: 'The Stock screen already gives stock as on any date. "Frozen" needs the period lock — '
      + 'nobody able to add or change an entry dated before a closed date — which is a Settings switch (S8).',
  },
]
