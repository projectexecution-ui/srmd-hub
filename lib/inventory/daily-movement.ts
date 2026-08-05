// Pure logic for the "Daily movement report" — yesterday's stock Entry, Exit
// and Transfers. Shared by the in-app report page and the scheduled email cron,
// so it takes already-joined rows and holds no Supabase/jsPDF imports.
import { APP_TIME_ZONE } from '@/lib/utils'

export interface RawMovement {
  movement_type: string
  qty: number
  remarks: string | null
  created_at: string
  item_id: string
  warehouse_id: string
  item_code: string
  item_name: string
  unit: string
  store_code: string
  store_name: string
  actor_name: string
  // Request context (issues/returns are linked to a request via ref_id).
  project?: string | null       // "AB — Admin Block"
  requested_by?: string | null  // engineer who raised the request
  purpose?: string | null
  reference?: string | null      // request number
  is_emergency?: boolean
}

export interface MovementLine {
  type: string          // human label
  rawType: string       // raw movement_type (issue/receipt/damage/adjustment…)
  itemCode: string
  itemName: string
  qty: number
  unit: string
  store: string
  actor: string
  remarks: string | null
  at: string            // ISO
  project?: string | null
  requestedBy?: string | null
  purpose?: string | null
  reference?: string | null
  isEmergency?: boolean
}

export interface TransferLine {
  itemCode: string
  itemName: string
  qty: number
  unit: string
  fromStore: string
  toStore: string
  actor: string
  at: string
  remarks?: string | null
}

export interface DailyMovementReport {
  entries: MovementLine[]
  exits: MovementLine[]
  transfers: TransferLine[]
  adjustments: MovementLine[]
  kpi: {
    entries: number
    exits: number
    transfers: number
    itemsTouched: number
    storesTouched: number
  }
}

export const MOVEMENT_LABEL: Record<string, string> = {
  receipt: 'Vendor receipt',
  return_good: 'Return to store',
  issue: 'Issued to site',
  damage: 'Damaged · write-off',
  adjustment: 'Stock correction',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
}

const ENTRY_TYPES = new Set(['receipt', 'return_good'])
const EXIT_TYPES = new Set(['issue', 'damage'])

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

export function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: APP_TIME_ZONE,
  })
}

// The one-line "accurate details" for a movement: for a request-linked issue/
// return it's the project + purpose + who asked + request no; otherwise the
// movement's own remark (vendor note, damage reason, opening-balance note…).
export function movementDetail(l: MovementLine): string {
  const parts: string[] = []
  if (l.project) parts.push(l.project)
  if (l.purpose) parts.push(`“${l.purpose}”`)
  if (l.requestedBy) parts.push(`req by ${l.requestedBy}`)
  if (l.reference) parts.push(l.reference)
  if (parts.length === 0 && l.remarks) parts.push(l.remarks)
  return parts.join(' · ')
}

export function bucketMovements(rows: RawMovement[]): DailyMovementReport {
  const entries: MovementLine[] = []
  const exits: MovementLine[] = []
  const adjustments: MovementLine[] = []
  const toLine = (m: RawMovement): MovementLine => ({
    type: MOVEMENT_LABEL[m.movement_type] ?? m.movement_type,
    rawType: m.movement_type,
    itemCode: m.item_code, itemName: m.item_name, qty: Number(m.qty || 0), unit: m.unit,
    store: m.store_name || m.store_code || '—', actor: m.actor_name || 'Someone',
    remarks: m.remarks, at: m.created_at,
    project: m.project ?? null, requestedBy: m.requested_by ?? null,
    purpose: m.purpose ?? null, reference: m.reference ?? null, isEmergency: m.is_emergency ?? false,
  })

  // Pair transfer_out ↔ transfer_in from the same transaction. inv_rpc_stock_transfer
  // inserts both rows in one statement, so they share item_id + qty + created_at.
  const transferGroups = new Map<string, RawMovement[]>()
  for (const m of rows) {
    if (m.movement_type === 'transfer_in' || m.movement_type === 'transfer_out') {
      const k = `${m.item_id}|${m.qty}|${m.created_at}`
      const arr = transferGroups.get(k) ?? []
      arr.push(m)
      transferGroups.set(k, arr)
      continue
    }
    if (ENTRY_TYPES.has(m.movement_type)) entries.push(toLine(m))
    else if (EXIT_TYPES.has(m.movement_type)) exits.push(toLine(m))
    else if (m.movement_type === 'adjustment') adjustments.push(toLine(m))
  }

  const transfers: TransferLine[] = []
  for (const grp of transferGroups.values()) {
    const out = grp.find(g => g.movement_type === 'transfer_out')
    const inn = grp.find(g => g.movement_type === 'transfer_in')
    const any = out ?? inn!
    transfers.push({
      itemCode: any.item_code, itemName: any.item_name, qty: Number(any.qty || 0), unit: any.unit,
      fromStore: out ? (out.store_name || out.store_code) : '—',
      toStore: inn ? (inn.store_name || inn.store_code) : '—',
      actor: any.actor_name || 'Someone', at: any.created_at, remarks: any.remarks,
    })
  }

  const sortByTime = <T extends { at: string }>(a: T, b: T) => a.at.localeCompare(b.at)
  entries.sort(sortByTime); exits.sort(sortByTime); transfers.sort(sortByTime); adjustments.sort(sortByTime)

  const itemsTouched = new Set(rows.map(r => r.item_id)).size
  const storesTouched = new Set(rows.map(r => r.warehouse_id)).size

  return {
    entries, exits, transfers, adjustments,
    kpi: { entries: entries.length, exits: exits.length, transfers: transfers.length, itemsTouched, storesTouched },
  }
}

// ── Digest summary — roll it up so a huge day still fits one screen ─────────
export interface DigestSummary {
  byProject: { project: string; count: number }[]
  topItems: { item: string; unit: string; count: number; qty: number }[]
  entryCount: number
  entryTopItems: { item: string; unit: string; qty: number }[]
  transferCount: number
  transferTop: { item: string; from: string; to: string; qty: number; unit: string }[]
  emergencies: MovementLine[]   // exceptions — always shown, never truncated by top-N
  damage: MovementLine[]
  corrections: MovementLine[]
}

export function summarizeDigest(report: DailyMovementReport): DigestSummary {
  const issues = report.exits.filter(l => l.rawType === 'issue')
  const damage = report.exits.filter(l => l.rawType === 'damage')

  const projMap = new Map<string, number>()
  for (const l of issues) {
    const k = l.project || 'Unassigned'
    projMap.set(k, (projMap.get(k) ?? 0) + 1)
  }
  const byProject = [...projMap.entries()]
    .map(([project, count]) => ({ project, count }))
    .sort((a, b) => b.count - a.count)

  const itemMap = new Map<string, { item: string; unit: string; count: number; qty: number }>()
  for (const l of issues) {
    const k = `${l.itemName}|${l.unit}`
    const cur = itemMap.get(k) ?? { item: l.itemName, unit: l.unit, count: 0, qty: 0 }
    cur.count += 1; cur.qty += l.qty
    itemMap.set(k, cur)
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.count - a.count || b.qty - a.qty)

  const entMap = new Map<string, { item: string; unit: string; qty: number }>()
  for (const l of report.entries) {
    const k = `${l.itemName}|${l.unit}`
    const cur = entMap.get(k) ?? { item: l.itemName, unit: l.unit, qty: 0 }
    cur.qty += l.qty; entMap.set(k, cur)
  }
  const entryTopItems = [...entMap.values()].sort((a, b) => b.qty - a.qty)

  const transferTop = [...report.transfers]
    .sort((a, b) => b.qty - a.qty)
    .map(t => ({ item: t.itemName, from: t.fromStore, to: t.toStore, qty: t.qty, unit: t.unit }))

  const emergencies = [...report.exits, ...report.entries].filter(l => l.isEmergency)

  return {
    byProject, topItems,
    entryCount: report.entries.length, entryTopItems,
    transferCount: report.transfers.length, transferTop,
    emergencies, damage, corrections: report.adjustments,
  }
}

// ── Email HTML (inline styles for mail clients) ─────────────────────────────
function tableHtml(title: string, headColor: string, cols: string[], rows: string[][]): string {
  if (rows.length === 0) return ''
  const th = cols.map(c => `<th style="text-align:left;padding:6px 8px;font-size:11px;color:#fff;font-weight:600">${c}</th>`).join('')
  const body = rows.map((r, i) => {
    const bg = i % 2 ? '#fafafa' : '#ffffff'
    const tds = r.map((c, j) => `<td style="padding:6px 8px;font-size:12px;color:#1f2937;border-bottom:1px solid #eee;${j === cols.length - 1 ? 'text-align:right;white-space:nowrap' : ''}">${c}</td>`).join('')
    return `<tr style="background:${bg}">${tds}</tr>`
  }).join('')
  return `<p style="font-size:14px;font-weight:700;color:#111827;margin:20px 0 6px">${title}</p>`
    + `<table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">`
    + `<thead><tr style="background:${headColor}">${th}</tr></thead><tbody>${body}</tbody></table>`
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TOP_N = 6   // roll-ups cap; the tail collapses to "+N more"

// A management DIGEST — exceptions first, then roll-ups (top-N), then a link to
// the full log. Fixed length regardless of the day's volume: no row dump.
export function renderDailyEmailHtml(report: DailyMovementReport, dayLabel: string, opts: { url?: string } = {}): string {
  const s = summarizeDigest(report)
  const anything = report.kpi.entries + report.kpi.exits + report.kpi.transfers + report.adjustments.length

  const kpiCard = (label: string, value: number, color: string) =>
    `<td style="padding:0 6px"><div style="background:#f9fafb;border:1px solid #eef0f2;border-radius:8px;padding:10px 12px">`
    + `<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em">${esc(label)}</div>`
    + `<div style="font-size:20px;font-weight:700;color:${color};margin-top:2px">${nf(value)}</div></div></td>`

  // Exceptions — shown FIRST, capped but never hidden by top-N ranking.
  const emgLine = (l: MovementLine) => `${esc(l.itemName)} — ${nf(l.qty)} ${esc(l.unit)}`
    + (l.project ? ` → ${esc(l.project)}` : ` · ${esc(l.store)}`)
    + (l.requestedBy ? ` · req by ${esc(l.requestedBy)}` : '')
    + (l.reference ? ` · ${esc(l.reference)}` : '')
  const noteLine = (l: MovementLine) => `${esc(l.itemName)} — ${nf(l.qty)} ${esc(l.unit)} · ${esc(l.store)}`
    + (l.remarks ? ` · ${esc(l.remarks)}` : '')
  const excGroup = (title: string, color: string, lines: string[]) => {
    if (lines.length === 0) return ''
    const shown = lines.slice(0, TOP_N)
    const more = lines.length - shown.length
    return `<div style="font-size:12px;font-weight:700;color:${color};margin:8px 0 3px">${esc(title)} · ${lines.length}</div>`
      + shown.map(t => `<div style="font-size:12px;color:#374151;line-height:1.55">${t}</div>`).join('')
      + (more > 0 ? `<div style="font-size:11px;color:#9ca3af;font-style:italic">+ ${more} more</div>` : '')
  }
  const excInner =
    excGroup('⚠ Emergency issues', '#b91c1c', s.emergencies.map(emgLine))
    + excGroup('Damage / write-offs', '#b45309', s.damage.map(noteLine))
    + excGroup('Stock corrections', '#7c3aed', s.corrections.map(noteLine))
  const excBox = excInner
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin:4px 0 4px">`
      + `<div style="font-size:11px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:.04em">Needs attention</div>`
      + excInner + `</div>`
    : ''

  // Roll-ups (ranked by count — coherent across mixed units).
  const moreRow = (n: number, noun: string): string[][] => n > 0 ? [[`+ ${n} more ${noun}`, '']] : []
  const byProjectTbl = tableHtml('Exits — by project', '#dc2626', ['Project', 'Issues'],
    [...s.byProject.slice(0, TOP_N).map(p => [esc(p.project), nf(p.count)]),
     ...moreRow(Math.max(0, s.byProject.length - TOP_N), 'projects')])
  const topItemsTbl = tableHtml('Most-issued items', '#111827', ['Item', 'Times', 'Total qty'],
    [...s.topItems.slice(0, TOP_N).map(t => [esc(t.item), nf(t.count), `${nf(t.qty)} ${esc(t.unit)}`]),
     ...moreRow(Math.max(0, s.topItems.length - TOP_N), 'items')])

  const entTop = s.entryTopItems.slice(0, 3).map(t => `${esc(t.item)} ${nf(t.qty)} ${esc(t.unit)}`).join(' · ')
  const trTop = s.transferTop.slice(0, 3).map(t => `${esc(t.item)} ${nf(t.qty)} ${esc(t.unit)} ${esc(t.from)}→${esc(t.to)}`).join(' · ')
  const twoUp = `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:16px -8px 0"><tr>`
    + `<td style="width:50%;vertical-align:top">`
    + `<div style="font-size:12px;font-weight:700;color:#16a34a;margin:0 0 4px">Entries · ${nf(s.entryCount)}</div>`
    + `<div style="font-size:11px;color:#4b5563;line-height:1.55">${entTop || '—'}</div></td>`
    + `<td style="width:50%;vertical-align:top">`
    + `<div style="font-size:12px;font-weight:700;color:#2563eb;margin:0 0 4px">Transfers · ${nf(s.transferCount)}</div>`
    + `<div style="font-size:11px;color:#4b5563;line-height:1.55">${trTop || '—'}</div></td>`
    + `</tr></table>`

  const link = opts.url
    ? `<div style="margin:18px 0 4px;padding-top:14px;border-top:1px solid #eee;text-align:center">`
      + `<a href="${esc(opts.url)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 18px;border-radius:8px">Open the full day's log →</a>`
      + `<div style="font-size:11px;color:#9ca3af;margin-top:8px">Every row — ${nf(report.kpi.exits)} exits · ${nf(report.kpi.entries)} entries · ${nf(report.kpi.transfers)} transfers — is in CT HUB.</div></div>`
    : ''

  const bodyInner = anything === 0
    ? `<p style="font-size:13px;color:#6b7280;margin:18px 0">No stock movement was recorded on this day.</p>`
    : excBox + byProjectTbl + topItemsTbl + twoUp + link

  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:20px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:22px 24px">`
    + `<p style="font-size:16px;font-weight:700;color:#111827;margin:0 0 2px">Inventory — daily movement</p>`
    + `<p style="font-size:13px;color:#6b7280;margin:0 0 14px">${esc(dayLabel)} · ${nf(report.kpi.storesTouched)} stores</p>`
    + `<table style="width:100%;border-collapse:separate;border-spacing:0;margin:0 -6px 4px"><tr>`
    + kpiCard('Entries', report.kpi.entries, '#16a34a')
    + kpiCard('Exits', report.kpi.exits, '#dc2626')
    + kpiCard('Transfers', report.kpi.transfers, '#2563eb')
    + kpiCard('Items', report.kpi.itemsTouched, '#111827')
    + `</tr></table>`
    + bodyInner
    + `<p style="font-size:12px;color:#9ca3af;margin:20px 0 0">via CT HUB · Inventory</p>`
    + `</div></div>`
}
