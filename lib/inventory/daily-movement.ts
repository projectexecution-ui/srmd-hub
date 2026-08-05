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
}

export interface MovementLine {
  type: string          // human label
  itemCode: string
  itemName: string
  qty: number
  unit: string
  store: string
  actor: string
  remarks: string | null
  at: string            // ISO
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

export function bucketMovements(rows: RawMovement[]): DailyMovementReport {
  const entries: MovementLine[] = []
  const exits: MovementLine[] = []
  const adjustments: MovementLine[] = []
  const toLine = (m: RawMovement): MovementLine => ({
    type: MOVEMENT_LABEL[m.movement_type] ?? m.movement_type,
    itemCode: m.item_code, itemName: m.item_name, qty: Number(m.qty || 0), unit: m.unit,
    store: m.store_name || m.store_code || '—', actor: m.actor_name || 'Someone',
    remarks: m.remarks, at: m.created_at,
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
      actor: any.actor_name || 'Someone', at: any.created_at,
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

// ── Email HTML (inline styles for mail clients) ─────────────────────────────
function tableHtml(title: string, headColor: string, cols: string[], rows: string[][]): string {
  if (rows.length === 0) return ''
  const th = cols.map(c => `<th style="text-align:left;padding:6px 8px;font-size:11px;color:#fff;font-weight:600">${c}</th>`).join('')
  const body = rows.map((r, i) => {
    const bg = i % 2 ? '#fafafa' : '#ffffff'
    const tds = r.map((c, j) => `<td style="padding:6px 8px;font-size:12px;color:#1f2937;border-bottom:1px solid #eee;${j >= cols.length - 2 ? 'text-align:right;white-space:nowrap' : ''}">${c}</td>`).join('')
    return `<tr style="background:${bg}">${tds}</tr>`
  }).join('')
  return `<p style="font-size:14px;font-weight:700;color:#111827;margin:20px 0 6px">${title}</p>`
    + `<table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">`
    + `<thead><tr style="background:${headColor}">${th}</tr></thead><tbody>${body}</tbody></table>`
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderDailyEmailHtml(report: DailyMovementReport, dayLabel: string): string {
  const kpiCard = (label: string, value: number, color: string) =>
    `<td style="padding:0 6px"><div style="background:#f9fafb;border:1px solid #eef0f2;border-radius:8px;padding:10px 12px">`
    + `<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em">${label}</div>`
    + `<div style="font-size:20px;font-weight:700;color:${color};margin-top:2px">${nf(value)}</div></div></td>`

  const entriesTbl = tableHtml('Entries — into store', '#16a34a',
    ['Item', 'Type', 'Store', 'By', 'Qty'],
    report.entries.map(l => [esc(l.itemName), esc(l.type), esc(l.store), esc(l.actor), `${nf(l.qty)} ${esc(l.unit)}`]))
  const exitsTbl = tableHtml('Exits — out of store', '#dc2626',
    ['Item', 'Type', 'Store', 'By', 'Qty'],
    report.exits.map(l => [esc(l.itemName), esc(l.type), esc(l.store), esc(l.actor), `${nf(l.qty)} ${esc(l.unit)}`]))
  const transfersTbl = tableHtml('Transfers — store to store', '#2563eb',
    ['Item', 'From', 'To', 'By', 'Qty'],
    report.transfers.map(t => [esc(t.itemName), esc(t.fromStore), esc(t.toStore), esc(t.actor), `${nf(t.qty)} ${esc(t.unit)}`]))
  const adjTbl = tableHtml('Stock corrections', '#7c3aed',
    ['Item', 'Store', 'By', 'Note', 'Qty'],
    report.adjustments.map(l => [esc(l.itemName), esc(l.store), esc(l.actor), esc(l.remarks || '—'), `${nf(l.qty)} ${esc(l.unit)}`]))

  const anything = report.entries.length + report.exits.length + report.transfers.length + report.adjustments.length
  const bodyInner = anything === 0
    ? `<p style="font-size:13px;color:#6b7280;margin:18px 0">No stock movement was recorded on this day.</p>`
    : entriesTbl + exitsTbl + transfersTbl + adjTbl

  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:20px"><div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:22px 24px">`
    + `<p style="font-size:16px;font-weight:700;color:#111827;margin:0 0 2px">Inventory — daily movement</p>`
    + `<p style="font-size:13px;color:#6b7280;margin:0 0 16px">${esc(dayLabel)}</p>`
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
