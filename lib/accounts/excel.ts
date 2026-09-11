// Excel in and out for the Accounts tab: the statement CT Hub gives the Trust,
// the Trust's reply, and plain exports of the payments list and a party ledger.

import * as XLSX from 'xlsx'
import { parsePaymentId, tallyBalance, type Payment, type PartyLedger, type ConfirmationStatus } from './payments'

const STATEMENT_HEAD = ['CT Hub ID', 'IN4 bill date', 'Paid to', 'WO / PO', 'Bill / certificate no', 'Type', 'Net paid (IN4) ₹', 'Bank date', 'Bank ref / Vch no', 'Amount in books ₹', 'Status', 'Remarks']
const NOT_IN_IN4_HEAD = ['Bank date', 'Paid to', 'Amount ₹', 'Bank ref / Vch no', 'Remarks']

/** Excel sheet names: 31 chars, no []:*?/\ and unique. */
function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Sheet'
  let name = base, i = 2
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} ${i++}`
  used.add(name.toLowerCase())
  return name
}
const dmy = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '')

/**
 * One sheet per party, the Trust's five columns left blank, a "How to fill"
 * sheet first and a "Not in IN4" sheet last for payments the Trust made that
 * CT Hub did not list. Column A carries the CT Hub ID the reply is read by.
 */
export function buildStatementWorkbook(project: { label: string }, payments: readonly Payment[], rangeLabel: string): Buffer {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  const how = XLSX.utils.aoa_to_sheet([
    [`${project.label} — payments for Trust checking`],
    [`Prepared by CT Hub on ${dmy(new Date().toISOString().slice(0, 10))} · ${rangeLabel} · ${payments.length} payments`],
    [],
    ['How to fill'],
    ['1', 'Each sheet is one party. Every row is one payment IN4 says was made.'],
    ['2', 'For each row fill: Bank date (the day money left the bank), Bank ref / Vch no, Amount in books, and Status.'],
    ['3', 'Status is one of: Matches · Not found · Differs. Leave a Remark when Not found or Differs.'],
    ['4', 'Do not change column A (CT Hub ID) — that is how CT Hub reads the reply. Sorting or filtering rows is fine.'],
    ['5', 'Payments you made for this project that are not listed anywhere go on the last sheet, "Not in IN4".'],
    ['6', 'Send the file back as it is; CT Hub reads it and shows what matched and what did not.'],
  ])
  how['!cols'] = [{ wch: 4 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(wb, how, sheetName('How to fill', used))

  const byParty = new Map<string, Payment[]>()
  for (const p of payments) byParty.set(p.party, [...(byParty.get(p.party) ?? []), p])
  for (const [party, rows] of [...byParty.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const aoa: unknown[][] = [STATEMENT_HEAD]
    for (const p of rows.sort((a, b) => String(a.date ?? '9999').localeCompare(String(b.date ?? '9999')))) {
      aoa.push([p.id, dmy(p.billDate), p.party, p.against ?? '', p.billNo ?? '', p.kind, Math.round(p.paid), '', '', '', '', ''])
    }
    aoa.push(['', '', 'Total', '', '', '', rows.reduce((s, p) => s + Math.round(p.paid), 0), '', '', '', '', ''])
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 11 }, { wch: 12 }, { wch: 30 }, { wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 30 }]
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, ws, sheetName(party, used))
  }
  const extra = XLSX.utils.aoa_to_sheet([NOT_IN_IN4_HEAD])
  extra['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, extra, sheetName('Not in IN4', used))
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export interface ReplyRow {
  id: string; source: 'wo' | 'supplier'; certificateId: number
  bankDate: string | null; bankRef: string | null; amountInBooks: number | null
  status: ConfirmationStatus | null; remark: string | null
}
export interface NotInIn4Row { bankDate: string | null; party: string; amount: number | null; bankRef: string | null; remark: string | null }
export interface ParsedReply { rows: ReplyRow[]; notInIn4: NotInIn4Row[]; skipped: number }

/** Tolerant date reading: Excel dates, 2026-05-23, 23-05-2026, 23/05/2026, 23 May 2026. */
export function readDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s); if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  const t = Date.parse(s); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}
export function readStatus(v: unknown): ConfirmationStatus | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^(match|matches|matched|ok|yes|confirmed|found|tally|tallies)/.test(s)) return 'confirmed'
  if (/not\s*found|missing|no$|absent|nil/.test(s)) return 'not_found'
  if (/differ|mismatch|diff|wrong|short|excess/.test(s)) return 'differs'
  return null
}
const readNum = (v: unknown): number | null => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : null }
const readStr = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }

/** Reads the Trust's reply by CT Hub ID, whatever order or sheet the rows ended up in. */
export function parseReplyWorkbook(buf: Buffer | ArrayBuffer): ParsedReply {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true })
  const rows: ReplyRow[] = []
  const notInIn4: NotInIn4Row[] = []
  let skipped = 0
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })
    const headIdx = aoa.findIndex(r => r.some(c => String(c ?? '').trim().toLowerCase() === 'ct hub id'))
    if (headIdx >= 0) {
      const head = aoa[headIdx].map(c => String(c ?? '').trim().toLowerCase())
      const col = (re: RegExp) => head.findIndex(h => re.test(h))
      const cId = col(/^ct hub id$/), cBank = col(/^bank date/), cRef = col(/bank ref|vch no/), cAmt = col(/amount in books/), cStatus = col(/^status/), cRemark = col(/^remark/)
      for (const r of aoa.slice(headIdx + 1)) {
        const parsed = parsePaymentId(String(r[cId] ?? ''))
        if (!parsed) continue
        const bankDate = cBank >= 0 ? readDate(r[cBank]) : null
        const status = cStatus >= 0 ? readStatus(r[cStatus]) : null
        const amount = cAmt >= 0 ? readNum(r[cAmt]) : null
        if (!bankDate && !status && amount == null) { skipped++; continue }
        rows.push({ id: String(r[cId]).trim().toUpperCase(), ...parsed, bankDate, bankRef: cRef >= 0 ? readStr(r[cRef]) : null, amountInBooks: amount, status: status ?? (bankDate ? 'confirmed' : null), remark: cRemark >= 0 ? readStr(r[cRemark]) : null })
      }
      continue
    }
    if (/not in in4/i.test(name)) {
      const hi = aoa.findIndex(r => r.some(c => /paid to/i.test(String(c ?? ''))))
      for (const r of aoa.slice(hi + 1)) {
        const party = readStr(r[1]); const amount = readNum(r[2])
        if (!party && amount == null) continue
        notInIn4.push({ bankDate: readDate(r[0]), party: party ?? '(no name)', amount, bankRef: readStr(r[3]), remark: readStr(r[4]) })
      }
    }
  }
  return { rows, notInIn4, skipped }
}

/** The payments list as a plain sheet. */
export function buildPaymentsWorkbook(project: { label: string }, payments: readonly Payment[], title: string): Buffer {
  const wb = XLSX.utils.book_new()
  const aoa: unknown[][] = [[`${project.label} — ${title}`], [], ['Date', 'Date is', 'Paid to', 'WO / PO', 'Bill / certificate no', 'Type', 'Gross ₹', 'Deductions ₹', 'Retention ₹', 'Paid ₹', 'CT Hub ID']]
  for (const p of payments) aoa.push([dmy(p.date), p.bankDate ? 'bank date' : p.billDate ? 'bill date' : 'unknown', p.party, p.against ?? '', p.billNo ?? '', p.kind, Math.round(p.gross), Math.round(p.deductions), Math.round(p.retention), Math.round(p.paid), p.id])
  aoa.push([], ['', '', 'Total', '', '', '', payments.reduce((s, p) => s + Math.round(p.gross), 0), payments.reduce((s, p) => s + Math.round(p.deductions), 0), payments.reduce((s, p) => s + Math.round(p.retention), 0), payments.reduce((s, p) => s + Math.round(p.paid), 0), ''])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 11 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Payments')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Tally's ledger-voucher layout, so the accounts team can paste it beside their own. */
export function buildLedgerWorkbook(project: { label: string }, ledger: PartyLedger): Buffer {
  const wb = XLSX.utils.book_new()
  const aoa: unknown[][] = [
    [ledger.party], [`${project.label} · Ledger account${ledger.fy ? ` · FY ${ledger.fy}` : ' · all years'} · from CT Hub (IN4 certificates)`], [],
    ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit ₹', 'Credit ₹', 'Balance'],
    ['', 'Opening Balance', '', '', '', '', tallyBalance(ledger.opening)],
  ]
  for (const l of ledger.lines) aoa.push([dmy(l.date), l.particulars, l.vchType, l.vchNo, l.debit ? Math.round(l.debit) : '', l.credit ? Math.round(l.credit) : '', tallyBalance(l.balance)])
  aoa.push(['', 'Current Total', '', '', Math.round(ledger.totals.debit), Math.round(ledger.totals.credit), ''])
  aoa.push(['', 'Closing Balance', '', '', '', '', tallyBalance(ledger.closing)])
  if (ledger.duplicatesFolded) aoa.push([], ['', `${ledger.duplicatesFolded} bill${ledger.duplicatesFolded === 1 ? '' : 's'} IN4 lists twice shown once.`])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 52 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
