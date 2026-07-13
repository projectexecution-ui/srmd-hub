import { BP_CONFIG } from './config'
import type { ZohoTask } from './zoho'

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
  pushReason?: string   // populated after comment fetch
}

export interface StageBar {
  stage:    string
  count:    number
  total:    number   // sum of claimed amounts
  maxAge:   number   // oldest bill age in days
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
  weekOf:      string          // ISO date of the Monday the card was generated
  generatedAt: string          // ISO timestamp
  totalBills:  number          // all non-done
  internalCount: number
  trustCount:  number
  stalledCount: number
  noWOcount:   number
  perStage:    StageBar[]
  pushList:    PushItem[]
  projectMap:  Record<string, string>  // id → code (NGH, P2 …)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function normalizeStage(raw: string): string {
  return raw.trim().replace(/Under\s*:\s*/g, 'Under: ')
}

function cf(task: ZohoTask, label: string): string {
  return (
    task.custom_fields?.find(f => f.label === label)?.value?.toString() ?? ''
  )
}

function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

function daysBetween(a: string, b: string): number {
  const diff = new Date(b).getTime() - new Date(a).getTime()
  return Math.max(0, Math.floor(diff / 86_400_000))
}

// ─── parseBill ───────────────────────────────────────────────────────────────

export function parseBill(
  task: ZohoTask,
  project: string,
  projectId: string,
  now: Date,
): Bill | null {
  const stage = normalizeStage(task.status?.name ?? '')
  if (stage === BP_CONFIG.DONE_STAGE) return null

  const claimed   = parseAmount(cf(task, BP_CONFIG.CUSTOM_FIELDS.CLAIMED_AMOUNT))
  const certified = parseAmount(cf(task, BP_CONFIG.CUSTOM_FIELDS.CERTIFIED_AMT))
  const paid      = parseAmount(cf(task, BP_CONFIG.CUSTOM_FIELDS.PAID_AMOUNT))
  const woNo      = cf(task, BP_CONFIG.CUSTOM_FIELDS.WO_NO)

  const nowMs     = now.getTime()
  const ageDays   = daysBetween(task.created_time,      now.toISOString())
  const idleDays  = daysBetween(task.last_updated_time, now.toISOString())

  const noWO =
    !woNo || (BP_CONFIG.NO_WO_VALUES as readonly string[]).includes(woNo)

  return {
    id:        task.id,
    project,
    projectId,
    name:      task.name,
    stage,
    vendor:    cf(task, BP_CONFIG.CUSTOM_FIELDS.VENDOR),
    building:  cf(task, BP_CONFIG.CUSTOM_FIELDS.BUILDING) || task.tasklist?.name || '',
    billNo:    cf(task, BP_CONFIG.CUSTOM_FIELDS.BILL_NO),
    raNo:      cf(task, BP_CONFIG.CUSTOM_FIELDS.RA_NO),
    billType:  cf(task, BP_CONFIG.CUSTOM_FIELDS.BILL_TYPE),
    claimed,
    certified,
    paid,
    woNo,
    noWO,
    billDate:  cf(task, BP_CONFIG.CUSTOM_FIELDS.BILL_DATE),
    ageDays,
    idleDays,
    stalled:   idleDays > BP_CONFIG.STALL_DAYS,
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
  const internalSet = new Set(BP_CONFIG.INTERNAL_STAGES as unknown as string[])

  const internal = bills.filter(b => internalSet.has(b.stage))
  const trust    = bills.filter(b => b.stage === BP_CONFIG.TRUST_STAGE)
  const stalled  = internal.filter(b => b.stalled)
  const noWOcount = bills.filter(b => b.noWO).length

  // Per-stage bar data (internal stages only, in defined order)
  const perStage: StageBar[] = (BP_CONFIG.INTERNAL_STAGES as unknown as string[]).map(stage => {
    const group = internal.filter(b => b.stage === stage)
    return {
      stage,
      count:  group.length,
      total:  group.reduce((s, b) => s + b.claimed, 0),
      maxAge: group.reduce((m, b) => Math.max(m, b.ageDays), 0),
    }
  })

  // Push list: internal, aged ≥ threshold, claimed ≥ threshold
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

  // projectId → project code map for display
  const projectMap: Record<string, string> = {}
  for (const [code, id] of Object.entries(BP_CONFIG.PROJECTS)) {
    projectMap[id] = code
  }

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
