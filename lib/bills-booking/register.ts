/** The register as a desk reads it — filters, the tags on a row, the one line
 *  that says why a bill is on your desk, and the CSV that goes out.
 *
 *  Aksha, 16 Sep 2026, screen A of the look-and-feel preview: "Build it".
 *  Search, project and WO/PO filters, late-only, saved views, export — none of
 *  it existed, and at ten example rows it did not matter. At two hundred bills
 *  a month it is the whole screen.
 *
 *  Pure: the page fetches, this decides. */

import { ageTone, isTerminal, type AgeTone, type BbStage } from './stages'

export interface RegisterRow {
  id: string
  vendor: string
  billNo: string | null
  orderType: string
  orderNo: string | null
  /** The building, as CT Hub can name it. */
  project: string | null
  amount: number
  stage: BbStage
  stageSince: string
  isExample: boolean
  /** Nobody typed it: created by the IN4 sweep, actor null. */
  autoRaised: boolean
  /** A document of kind 'bill' or 'stamped_bill' is attached. */
  hasStampedBill: boolean
  /** The last thing said about it — the send-back reason, the IN4 note. */
  lastComment: string | null
  lastAction: string | null
  /** True when the caller sits on the desk holding it. */
  mine: boolean
}

export type View = 'mine' | 'all' | 'late' | 'sent_back' | 'arrived'

export interface RegisterFilters {
  q?: string | null
  project?: string | null
  type?: 'WO' | 'PO' | null
  late?: boolean
  view?: View | null
}

export type Tag = 'arrived' | 'stamped_missing' | 'duplicate' | 'example' | 'sent_back'

/** Same order, same bill number, more than once — a warning, never a block:
 *  IN4 itself files one abstract against three bill numbers. */
export function duplicateKeys(rows: RegisterRow[]): Set<string> {
  const seen = new Map<string, number>()
  for (const r of rows) {
    if (!r.orderNo || !r.billNo) continue
    const k = `${r.orderNo.trim().toLowerCase()}|${r.billNo.trim().toLowerCase()}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k))
}

export function tagsFor(r: RegisterRow, dupes: Set<string>): Tag[] {
  const t: Tag[] = []
  if (r.isExample) t.push('example')
  if (r.autoRaised) t.push('arrived')
  // The stamped bill is asked for at the Disc Head, and the row says so before
  // anyone opens it and finds the button will not go.
  if (r.stage === 'disc_head' && !r.hasStampedBill) t.push('stamped_missing')
  if (r.orderNo && r.billNo && dupes.has(`${r.orderNo.trim().toLowerCase()}|${r.billNo.trim().toLowerCase()}`)) t.push('duplicate')
  if (r.lastAction === 'send_back') t.push('sent_back')
  return t
}

/** One line under the name: why this is on your desk. */
export function whyHere(r: RegisterRow): string | null {
  if (r.lastAction === 'send_back' && r.lastComment) return `Sent back — "${r.lastComment}"`
  if (r.lastComment) return r.lastComment
  return null
}

export function matches(r: RegisterRow, f: RegisterFilters, now: number): boolean {
  if (f.type && r.orderType !== f.type) return false
  if (f.project && r.project !== f.project) return false
  const tone = ageTone(r.stage, r.stageSince, now)
  if (f.late && tone !== 'warn' && tone !== 'late') return false
  switch (f.view) {
    case 'mine': if (!r.mine) return false; break
    case 'late': if (tone !== 'warn' && tone !== 'late') return false; break
    case 'sent_back': if (r.lastAction !== 'send_back') return false; break
    case 'arrived': if (!r.autoRaised) return false; break
    default: break
  }
  if (f.q) {
    const q = f.q.trim().toLowerCase()
    if (q) {
      const hay = [r.vendor, r.billNo, r.orderNo, r.project].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
  }
  return true
}

/** Live bills that match, oldest first — the top of a queue is the thing that
 *  has waited longest. Finished bills are left out unless the view is 'all'
 *  with no other filter, which is the only time anyone wants to see Paid. */
export function applyFilters(rows: RegisterRow[], f: RegisterFilters, now: number = Date.now()): RegisterRow[] {
  const showFinished = f.view === 'all' && !f.q && !f.project && !f.type && !f.late
  return rows
    .filter(r => showFinished || !isTerminal(r.stage))
    .filter(r => matches(r, f, now))
    .sort((a, b) => new Date(a.stageSince).getTime() - new Date(b.stageSince).getTime() || b.amount - a.amount)
}

/** The three figures the tile at the top carries. */
export function waitingOnMe(rows: RegisterRow[], now: number = Date.now()): { bills: number; value: number; oldestDays: number; tone: AgeTone } {
  const mine = rows.filter(r => r.mine && !r.isExample && !isTerminal(r.stage))
  let oldest = 0
  let tone: AgeTone = 'ok'
  const rank: Record<AgeTone, number> = { none: 0, ok: 1, warn: 2, late: 3 }
  for (const r of mine) {
    const d = Math.floor((now - new Date(r.stageSince).getTime()) / 86_400_000)
    if (d > oldest) oldest = d
    const t = ageTone(r.stage, r.stageSince, now)
    if (rank[t] > rank[tone]) tone = t
  }
  return { bills: mine.length, value: mine.reduce((s, r) => s + r.amount, 0), oldestDays: oldest, tone }
}

/* ── export ──────────────────────────────────────────────────────────────── */

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** What is on screen, as a file. Full rupees, ISO dates, the stage's label —
 *  what a spreadsheet can sort, not what a screen can colour. */
export function toCsv(rows: RegisterRow[], stageLabel: (s: BbStage) => string, now: number = Date.now()): string {
  const head = ['Vendor', 'Order', 'Bill no', 'Type', 'Project', 'Amount', 'Stage', 'Days at desk', 'Since', 'Arrived from IN4', 'Example', 'Last note']
  const lines = rows.map(r => [
    r.vendor, r.orderNo ?? '', r.billNo ?? '', r.orderType, r.project ?? '',
    r.amount, stageLabel(r.stage),
    Math.floor((now - new Date(r.stageSince).getTime()) / 86_400_000),
    r.stageSince.slice(0, 10),
    r.autoRaised ? 'yes' : '', r.isExample ? 'yes' : '', r.lastComment ?? '',
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\r\n') + '\r\n'
}
