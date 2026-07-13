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

export interface StageBar {
  stage:  string
  count:  number
  total:  number   // sum of claimed
  maxAge: number
}

export interface PushItem {
  id:        string
  project:   string
  projectId: string
  name:      string
  vendor:    string
  claimed:   number
  ageDays:   number
  reason:    string
}

export interface CardData {
  weekOf:        string
  generatedAt:   string
  totalBills:    number
  internalCount: number
  trustCount:    number
  stalledCount:  number
  noWOcount:     number
  perStage:      StageBar[]
  pushList:      PushItem[]
  projectMap:    Record<string, string>
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

export function aggregateCard(bills: Bill[], weekOf: string, generatedAt: string): CardData {
  const internal = bills.filter(b => b.isInternal)
  const trust    = bills.filter(b => b.isTrust)
  const stalled  = internal.filter(b => b.stalled)
  const noWOcount = bills.filter(b => b.noWO).length

  // Dynamic per-stage bars over whatever internal stages actually appear.
  const byStage = new Map<string, Bill[]>()
  for (const b of internal) {
    const arr = byStage.get(b.stage) ?? []
    arr.push(b)
    byStage.set(b.stage, arr)
  }
  let perStage: StageBar[] = [...byStage.entries()].map(([stage, group]) => ({
    stage,
    count:  group.length,
    total:  group.reduce((s, b) => s + b.claimed, 0),
    maxAge: group.reduce((m, b) => Math.max(m, b.ageDays), 0),
  })).sort((a, b) => b.count - a.count)

  // Collapse the long tail into "Other" so the chart stays readable.
  if (perStage.length > BP_CONFIG.MAX_STAGE_BARS) {
    const head = perStage.slice(0, BP_CONFIG.MAX_STAGE_BARS - 1)
    const tail = perStage.slice(BP_CONFIG.MAX_STAGE_BARS - 1)
    head.push({
      stage:  `Other (${tail.length})`,
      count:  tail.reduce((s, x) => s + x.count, 0),
      total:  tail.reduce((s, x) => s + x.total, 0),
      maxAge: tail.reduce((m, x) => Math.max(m, x.maxAge), 0),
    })
    perStage = head
  }

  const pushList: PushItem[] = internal
    .filter(b => b.ageDays >= BP_CONFIG.PUSH_MIN_AGE_DAYS && b.claimed >= BP_CONFIG.PUSH_MIN_CLAIMED)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, BP_CONFIG.PUSH_LIST_MAX)
    .map(b => ({
      id:        b.id,
      project:   b.project,
      projectId: b.projectId,
      name:      b.name,
      vendor:    b.vendor,
      claimed:   b.claimed,
      ageDays:   b.ageDays,
      reason:    b.pushReason ?? 'No update',
    }))

  const projectMap: Record<string, string> = {}
  for (const [code, id] of Object.entries(BP_CONFIG.PROJECTS)) projectMap[id] = code

  return {
    weekOf,
    generatedAt,
    totalBills:    bills.length,
    internalCount: internal.length,
    trustCount:    trust.length,
    stalledCount:  stalled.length,
    noWOcount,
    perStage,
    pushList,
    projectMap,
  }
}
