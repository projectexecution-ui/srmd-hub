import { BP_CONFIG } from './config'
import type { ZohoTask, ZohoMoney } from './zoho'

export interface Bill {
  id:          string
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
  billDate:    string
  ageDays:     number
  idleDays:    number
  stalled:     boolean
  isTrust:     boolean
  isInternal:  boolean
  pushReason?: string
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
  value:     number
  ageDays:   number
  stalled:   boolean
  noWO:      boolean
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

  ageBuckets:  AgeBucket[]   // ageing of bills pending with CT
  followUps:   FollowUp[]    // priority list (oldest with CT)
  projectMap:  Record<string, string>
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

  const isTrust    = stage === BP_CONFIG.TRUST_STAGE
  const isInternal = !isTrust   // not-trust + not-closed (closed already returned)

  return {
    id:        task.id,
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
    billDate:  task.bill_date ?? '',
    ageDays,
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

export function aggregateCard(bills: Bill[], asOf: string, generatedAt: string): CardData {
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
      value:      b.claimed,
      ageDays:    b.ageDays,
      stalled:    b.stalled,
      noWO:       b.noWO,
    }))

  const projectMap: Record<string, string> = {}
  for (const [code, id] of Object.entries(BP_CONFIG.PROJECTS)) projectMap[id] = code

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
    ageBuckets,
    followUps,
    projectMap,
  }
}
