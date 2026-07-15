import { BP_CONFIG } from './config'
import type { ZohoTask, ZohoMoney } from './zoho'
import type { BpProject } from './projects'

export interface Bill {
  id:          string
  prefix:      string   // Zoho task ref, e.g. "B-2-T5"
  project:     string
  projectId:   string
  name:        string
  stage:       string
  vendor:      string
  building:    string
  billNo:      string
  raNo:        string
  billType:    string
  claimed:     number
  certified:   number
  paid:        number
  woNo:        string
  noWO:        boolean
  billDate:    string   // invoice / bill date (the bill's own date)
  createdDate: string   // when it entered Zoho
  ageDays:     number   // days since it entered Zoho
  delayDays:   number   // days since the bill date (how long the bill has been pending)
  idleDays:    number
  stalled:     boolean
  isTrust:     boolean
  isInternal:  boolean
  pushReason?: string
}

// Flat record persisted per run to power the interactive "Stuck Bills" table.
export interface StuckBill {
  id:         string
  prefix:     string
  zohoDate:   string   // ISO date it entered Zoho
  vendor:     string
  project:    string   // site code
  tasklist:   string   // task-list / area name, e.g. "NGH Infra", "P2 A01"
  invoiceDate: string  // bill date
  invoiceNo:  string
  amount:     number
  status:     string   // stage
  delayDays:  number   // since bill date
  stalled:    boolean
  atTrust:    boolean
}

export function toStuckBill(b: Bill, projectMap: Record<string, string>): StuckBill {
  return {
    id:          b.id,
    prefix:      b.prefix,
    zohoDate:    b.createdDate,
    vendor:      b.vendor || b.name,
    project:     projectMap[b.projectId] ?? b.project,
    tasklist:    b.building,
    invoiceDate: b.billDate,
    invoiceNo:   b.billNo,
    amount:      b.claimed,
    status:      b.stage,
    delayDays:   b.delayDays,
    stalled:     b.stalled,
    atTrust:     b.isTrust,
  }
}

export interface AgeBucket {
  label: string
  count: number
  value: number   // sum of claimed ₹
}

export interface FollowUp {
  id:        string
  project:   string
  projectId: string
  contractor: string
  billNo:    string
  stage:     string
  value:     number
  ageDays:   number
  stalled:   boolean
  noWO:      boolean
}

export interface ProjectSlice {
  code:  string
  count: number
  value: number
}

// Full per-site breakdown for the Project Scorecard report.
export interface ScorecardRow {
  code:         string
  totalCount:   number
  totalValue:   number
  ctCount:      number
  ctValue:      number
  trustCount:   number
  trustValue:   number
  stalledCount: number
  stalledValue: number
}

// Week-over-week change vs the previous run. null = no prior snapshot yet.
export interface Deltas {
  totalValue:   number | null
  ctValue:      number | null
  trustValue:   number | null
  stalledValue: number | null
}

export interface CardData {
  asOf:        string   // ISO date the snapshot represents
  generatedAt: string

  // Counts + ₹ value, side by side (management reads money first)
  totalCount:   number
  totalValue:   number
  ctCount:      number   // pending with CT (not yet at Trust, not paid)
  ctValue:      number
  trustCount:   number   // submitted to Trust Accounts
  trustValue:   number
  stalledCount: number   // idle beyond STALL_DAYS, still with CT
  stalledValue: number
  noWoCount:    number
  noWoValue:    number

  // Throughput — bills paid/closed in the trailing 7 days
  clearedCount: number
  clearedValue: number

  ageBuckets:      AgeBucket[]     // ageing of bills pending with CT
  byProject:       ProjectSlice[]  // value pending with CT, per site
  projectScorecard: ScorecardRow[] // full per-site breakdown (Project Scorecard report)
  followUps:       FollowUp[]      // priority list (oldest with CT)
  deltas:          Deltas          // week-over-week change
  projectMap:      Record<string, string>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function normalizeStage(raw: string): string {
  return (raw ?? '').trim().replace(/Under\s*:\s*/g, 'Under: ')
}

// Zoho task names / descriptions carry HTML entities + tags.
function cleanText(raw: string): string {
  return (raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function money(m: ZohoMoney | undefined | null): number {
  const n = m?.amount
  return typeof n === 'number' && isFinite(n) ? n : 0
}

// Bills paid/closed within the trailing `days` window — a throughput read.
export function clearedThisWeek(tasks: ZohoTask[], now: Date, days = 7): { count: number; value: number } {
  const cutoff = now.getTime() - days * 86_400_000
  let count = 0, value = 0
  for (const t of tasks) {
    const stage  = normalizeStage(t.status?.name ?? '')
    const closed = t.is_completed === true || t.status?.is_closed_type === true || stage === BP_CONFIG.DONE_STAGE
    if (!closed) continue
    const done = t.completed_on ? new Date(t.completed_on).getTime() : NaN
    if (!Number.isFinite(done) || done < cutoff) continue
    count++
    value += money(t.this_bill_amt)
  }
  return { count, value }
}

function daysSince(iso: string | undefined, now: Date): number {
  if (!iso) return 0
  const diff = now.getTime() - new Date(iso).getTime()
  return Number.isFinite(diff) ? Math.max(0, Math.floor(diff / 86_400_000)) : 0
}

// ─── parseBill ───────────────────────────────────────────────────────────────

export function parseBill(
  task: ZohoTask, project: string, projectId: string, now: Date,
): Bill | null {
  const stage = normalizeStage(task.status?.name ?? '')

  // Drop paid/closed bills — the card is about what's still live.
  const closed = task.is_completed === true
    || task.status?.is_closed_type === true
    || stage === BP_CONFIG.DONE_STAGE
  if (closed) return null

  const woNo = (task.wo_po_no ?? '').trim()
  const orderType = (task.order_type ?? '').trim()
  const noWO =
    !woNo
    || (BP_CONFIG.NO_WO_VALUES as readonly string[]).includes(woNo)
    || /without\s*wo/i.test(orderType)

  const vendorRaw = task.vendor_from_module_2?.value ?? ''
  const vendor = /not created/i.test(vendorRaw) ? '' : vendorRaw

  const ageDays  = daysSince(task.created_time, now)
  const idleDays = daysSince(task.last_modified_time, now)
  // Delay = days since the bill's own date (falls back to Zoho create date).
  const billDate = task.bill_date ?? ''
  const delayDays = daysSince(billDate || task.created_time, now)

  const isTrust    = stage === BP_CONFIG.TRUST_STAGE
  const isInternal = !isTrust   // not-trust + not-closed (closed already returned)

  return {
    id:        task.id,
    prefix:    task.prefix ?? '',
    project,
    projectId,
    name:      cleanText(task.name) || '(untitled bill)',
    stage,
    vendor,
    building:  task.tasklist?.name ?? '',
    billNo:    task.bill_number ?? '',
    raNo:      task.task_cf_0002 ?? '',
    billType:  task.bill_type ?? '',
    claimed:   money(task.this_bill_amt),
    certified: money(task.certified_payment_amount),
    paid:      money(task.paid_till_date),
    woNo,
    noWO,
    billDate,
    createdDate: task.created_time ?? '',
    ageDays,
    delayDays,
    idleDays,
    stalled:   idleDays > BP_CONFIG.STALL_DAYS,
    isTrust,
    isInternal,
  }
}

// ─── deriveReason ────────────────────────────────────────────────────────────

export function deriveReason(comments: string[]): string {
  if (!comments.length) return 'No update'
  const latest = comments[0].toLowerCase()
  if (/revision|correct|wrong/.test(latest)) return 'Vendor to revise'
  if (/budget|sanction|wo|hold|approval/.test(latest)) return 'Budget / WO hold'
  return 'No reason logged'
}

// ─── aggregateCard ────────────────────────────────────────────────────────────

const sumClaimed = (arr: Bill[]) => arr.reduce((s, b) => s + b.claimed, 0)

export function aggregateCard(bills: Bill[], asOf: string, generatedAt: string, projects: BpProject[]): CardData {
  const ct      = bills.filter(b => b.isInternal)   // pending with CT
  const trust   = bills.filter(b => b.isTrust)      // with Trust Accounts
  const stalled = ct.filter(b => b.stalled)
  const noWo    = bills.filter(b => b.noWO)

  // Ageing of bills pending with CT — the classic management view.
  const BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
    { label: '0-15 days',  lo: 0,  hi: 15 },
    { label: '16-30 days', lo: 16, hi: 30 },
    { label: '31-45 days', lo: 31, hi: 45 },
    { label: '45+ days',   lo: 46, hi: Infinity },
  ]
  const ageBuckets: AgeBucket[] = BUCKETS.map(b => {
    const group = ct.filter(x => x.ageDays >= b.lo && x.ageDays <= b.hi)
    return { label: b.label, count: group.length, value: sumClaimed(group) }
  })

  // Value pending with CT, per site — which project is heaviest.
  const projectMap: Record<string, string> = {}
  for (const p of projects) projectMap[p.id] = p.code
  const sliceMap = new Map<string, ProjectSlice>()
  for (const b of ct) {
    const code = projectMap[b.projectId] ?? b.project
    const s = sliceMap.get(code) ?? { code, count: 0, value: 0 }
    s.count++; s.value += b.claimed
    sliceMap.set(code, s)
  }
  const byProject = [...sliceMap.values()].sort((a, b) => b.value - a.value)

  // Full per-site scorecard — all sites in a fixed order (even zero rows) so
  // the recurring report is predictable and every HOD sees their site.
  const projectScorecard: ScorecardRow[] = projects.map(({ code, id }) => {
    const own = bills.filter(b => b.projectId === id)
    const oct = own.filter(b => b.isInternal)
    const otr = own.filter(b => b.isTrust)
    const ost = oct.filter(b => b.stalled)
    return {
      code,
      totalCount: own.length, totalValue: sumClaimed(own),
      ctCount: oct.length,    ctValue: sumClaimed(oct),
      trustCount: otr.length, trustValue: sumClaimed(otr),
      stalledCount: ost.length, stalledValue: sumClaimed(ost),
    }
  })

  // Priority follow-ups: oldest bills still with CT (highest management value).
  const followUps: FollowUp[] = [...ct]
    .sort((a, b) => (b.ageDays - a.ageDays) || (b.claimed - a.claimed))
    .slice(0, BP_CONFIG.PUSH_LIST_MAX)
    .map(b => ({
      id:         b.id,
      project:    b.project,
      projectId:  b.projectId,
      contractor: b.name,
      billNo:     b.billNo,
      stage:      b.stage,
      value:      b.claimed,
      ageDays:    b.ageDays,
      stalled:    b.stalled,
      noWO:       b.noWO,
    }))

  return {
    asOf,
    generatedAt,
    totalCount:   bills.length,
    totalValue:   sumClaimed(bills),
    ctCount:      ct.length,
    ctValue:      sumClaimed(ct),
    trustCount:   trust.length,
    trustValue:   sumClaimed(trust),
    stalledCount: stalled.length,
    stalledValue: sumClaimed(stalled),
    noWoCount:    noWo.length,
    noWoValue:    sumClaimed(noWo),
    clearedCount: 0,                                    // filled by the route
    clearedValue: 0,
    ageBuckets,
    byProject,
    projectScorecard,
    followUps,
    deltas: { totalValue: null, ctValue: null, trustValue: null, stalledValue: null },
    projectMap,
  }
}
