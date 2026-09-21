// Excel out for the hub-wide Accounts lane: every table on the screen, with the
// same figures the screen shows (true by default, IN4 raw on request).

import * as XLSX from 'xlsx'
import type { TrustRow, TrustProjectRow, TrustPartyRow, PartyRow, FyRow, LedgerRow, RetentionTrustRow, RetentionPartyRow } from '@/lib/revamp/accounts-hub'

const R = (n: number) => Math.round(n)
const dmy = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '')
const stamp = () => dmy(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10))

function sheet(wb: XLSX.WorkBook, name: string, title: string, note: string, head: string[], rows: unknown[][], widths: number[]) {
  const aoa: unknown[][] = [[title], [note], [], head, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = widths.map(wch => ({ wch }))
  ws['!freeze'] = { xSplit: 0, ySplit: 4 }
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
}

const basis = (raw: boolean) => raw
  ? `IN4 raw — every certificate as the mirror holds it, cancelled and advances included · CT Hub ${stamp()}`
  : `True figures — cancelled certificates out, advances not counted beside the bills recovering them · CT Hub ${stamp()}`

export function trustWorkbook(rows: TrustRow[], raw: boolean): Buffer {
  const wb = XLSX.utils.book_new()
  sheet(wb, 'Trustwise', 'Accounts — Trustwise', basis(raw),
    ['Trust', 'Trust name', 'Projects', 'Parties', 'Certificates', 'Certified ₹', 'Paid ₹', 'Outstanding ₹', '0–30 days ₹', '31–90 days ₹', 'Over 90 days ₹', 'Over 90 (count)', 'No date ₹', 'Owed to contractors ₹', 'Owed to suppliers ₹', 'Retention held ₹'],
    rows.map(r => [r.trust_code ?? 'No trust', r.trust_name ?? '', r.projects, r.parties, r.certificates, R(r.certified), R(r.paid), R(r.outstanding), R(r.amt_0_30), R(r.amt_31_90), R(r.amt_over90), r.n_over90, R(r.amt_undated), R(r.outst_contractor), R(r.outst_supplier), R(r.retention)]),
    [10, 44, 9, 9, 12, 16, 16, 16, 14, 14, 16, 12, 12, 18, 18, 16])
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function trustDetailWorkbook(trust: TrustRow, projects: TrustProjectRow[], parties: TrustPartyRow[], raw: boolean): Buffer {
  const wb = XLSX.utils.book_new()
  sheet(wb, 'Projects', `${trust.trust_code} — projects`, basis(raw),
    ['Project (IN4)', 'In CT Hub', 'Certificates', 'Certified ₹', 'Paid ₹', 'Outstanding ₹', 'Over 90 days ₹', 'Retention ₹'],
    projects.map(r => [r.project_label, r.hub_codes ?? '', r.certificates, R(r.certified), R(r.paid), R(r.outstanding), R(r.amt_over90), R(r.retention)]),
    [24, 28, 12, 16, 16, 16, 16, 14])
  sheet(wb, 'Owed to', `${trust.trust_code} — who is owed`, basis(raw),
    ['Firm', 'Listed as', 'Certificates', 'Certified ₹', 'Paid ₹', 'Outstanding ₹', 'Oldest unpaid (days)', 'Retention ₹'],
    parties.map(r => [r.party_name, r.kinds, r.certificates, R(r.certified), R(r.paid), R(r.outstanding), r.oldest_unpaid_days ?? '', R(r.retention)]),
    [40, 22, 12, 16, 16, 16, 18, 14])
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function partyWorkbook(rows: PartyRow[], raw: boolean, label: string): Buffer {
  const wb = XLSX.utils.book_new()
  sheet(wb, 'Parties', `Accounts — ${label}`, basis(raw),
    ['Firm', 'Listed as', 'IN4 ids', 'Trusts', 'Projects', 'Certificates', 'Certified ₹', 'Paid ₹', 'Outstanding ₹', 'Oldest unpaid (days)', 'Retention ₹'],
    rows.map(r => [r.party_name, r.kinds, r.party_ids, r.trusts.map(t => t.outstanding > 0 ? `${t.trust} ${R(t.outstanding).toLocaleString('en-IN')}` : t.trust).join('; '), r.projects, r.certificates, R(r.certified), R(r.paid), R(r.outstanding), r.oldest_unpaid_days ?? '', R(r.retention)]),
    [40, 22, 22, 34, 9, 12, 16, 16, 16, 18, 14])
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function ledgerWorkbook(party: string, rows: LedgerRow[], raw: boolean): Buffer {
  const wb = XLSX.utils.book_new()
  sheet(wb, 'Ledger', `${party} — every certificate`, basis(raw),
    ['Date', 'Date is', 'Reference', 'WO / PO', 'Type', 'Status', 'Project', 'Trust', 'Certified ₹', 'Paid ₹', 'Outstanding ₹', 'Retention ₹', 'Source', 'IN4 id'],
    rows.map(r => [dmy(r.doc_date), r.date_source ?? '', r.ref_no ?? '', r.order_no ?? '', r.cert_type ?? '', r.status_name ?? '', r.project_code ?? r.project_name ?? '', r.trust_code ?? '', R(r.certified), R(r.paid), R(r.outstanding), R(r.retention), r.kind, r.certificate_id]),
    [12, 11, 22, 28, 12, 14, 14, 9, 16, 16, 16, 14, 11, 9])
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function fyWorkbook(rows: FyRow[], raw: boolean): Buffer {
  const wb = XLSX.utils.book_new()
  sheet(wb, 'FY wise', 'Accounts — FY wise (April to March)', basis(raw),
    ['Financial year', 'Certificates', 'Certified ₹', 'Paid ₹', 'Outstanding ₹', 'Retention ₹'],
    rows.map(r => [r.fy, r.certificates, R(r.certified), R(r.paid), R(r.outstanding), R(r.retention)]),
    [18, 12, 16, 16, 16, 14])
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function retentionWorkbook(trusts: RetentionTrustRow[], parties: RetentionPartyRow[], raw: boolean): Buffer {
  const wb = XLSX.utils.book_new()
  sheet(wb, 'By trust', 'Accounts — retention held, by trust', basis(raw),
    ['Trust', 'Held ₹', 'Bills with retention', 'Firms', 'Releases pending', 'Releases pending ₹', 'Released so far ₹'],
    trusts.map(r => [r.trust_code ?? 'No trust', R(r.held), r.bills_with_retention, r.parties, r.releases_pending, R(r.releases_pending_amt), R(r.released_so_far)]),
    [10, 16, 18, 8, 16, 18, 18])
  sheet(wb, 'By firm', 'Accounts — retention held, by firm', basis(raw),
    ['Firm', 'Listed as', 'Trusts', 'Projects', 'Held ₹', 'Bills', 'Oldest bill (days)'],
    parties.map(r => [r.party_name, r.kinds, r.trusts ?? '', r.projects ?? '', R(r.held), r.bills, r.oldest_bill_days ?? '']),
    [40, 22, 16, 40, 16, 8, 16])
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
