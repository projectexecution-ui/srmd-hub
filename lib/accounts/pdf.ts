// PDF versions of the payments list and a party ledger — jsPDF + autotable,
// the same pair the weekly Budget vs Actual uses.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { tallyBalance, type Payment, type PartyLedger } from './payments'

const inr = (v: number): string => Math.round(v).toLocaleString('en-IN')
const dmy = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—')
const nowIST = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' IST'

function header(doc: jsPDF, title: string, sub: string) {
  doc.setFontSize(8.5); doc.setTextColor(154, 123, 47); doc.text('SRMD · CONSTRUCTION', 36, 34)
  doc.setFontSize(15); doc.setTextColor(30, 42, 43); doc.text(title, 36, 54)
  doc.setFontSize(9); doc.setTextColor(120, 128, 128); doc.text(sub, 36, 69)
}
function footer(doc: jsPDF, left: string) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  doc.setFontSize(7.5); doc.setTextColor(140, 148, 148)
  doc.text(left, 36, H - 22); doc.text(`Generated ${nowIST()} · confidential — accounts`, W - 36, H - 22, { align: 'right' })
}

export function buildPaymentsPdf(project: { label: string }, payments: readonly Payment[], title: string): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  header(doc, `${project.label} — ${title}`, `${payments.length} payments · ₹${inr(payments.reduce((s, p) => s + p.paid, 0))} paid · dates are the Trust's bank date where confirmed, else IN4's bill date`)
  autoTable(doc, {
    startY: 84, margin: { left: 36, right: 36 },
    head: [['Date', 'Paid to', 'WO / PO', 'Bill no', 'Type', 'Gross', 'Deductions', 'Retention', 'Paid']],
    body: payments.map(p => [`${dmy(p.date)}${p.bankDate ? '' : p.billDate ? ' *' : ' ?'}`, p.party, p.against ?? '', p.billNo ?? '', p.kind, inr(p.gross), inr(p.deductions), inr(p.retention), inr(p.paid)]),
    foot: [['', 'Total', '', '', '', inr(payments.reduce((s, p) => s + p.gross, 0)), inr(payments.reduce((s, p) => s + p.deductions, 0)), inr(payments.reduce((s, p) => s + p.retention, 0)), inr(payments.reduce((s, p) => s + p.paid, 0))]],
    styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [244, 245, 243], textColor: [90, 100, 100], fontStyle: 'bold' }, footStyles: { fillColor: [244, 245, 243], textColor: [30, 42, 43], fontStyle: 'bold' },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right', fontStyle: 'bold' } },
    didDrawPage: () => footer(doc, '* bill date, not yet confirmed by the Trust · ? no date in IN4'),
  })
  return new Uint8Array(doc.output('arraybuffer'))
}

export function buildLedgerPdf(project: { label: string }, ledger: PartyLedger): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  header(doc, ledger.party, `${project.label} · Ledger account${ledger.fy ? ` · FY ${ledger.fy}` : ' · all years'} · from IN4 certificates`)
  const body: string[][] = [['', 'Opening Balance', '', '', '', '', tallyBalance(ledger.opening)]]
  for (const l of ledger.lines) body.push([dmy(l.date), l.particulars, l.vchType, l.vchNo, l.debit ? inr(l.debit) : '', l.credit ? inr(l.credit) : '', tallyBalance(l.balance)])
  autoTable(doc, {
    startY: 84, margin: { left: 36, right: 36 },
    head: [['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Balance']],
    body,
    foot: [['', 'Current Total', '', '', inr(ledger.totals.debit), inr(ledger.totals.credit), ''], ['', 'Closing Balance', '', '', '', '', tallyBalance(ledger.closing)]],
    styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [244, 245, 243], textColor: [90, 100, 100], fontStyle: 'bold' }, footStyles: { fillColor: [244, 245, 243], textColor: [30, 42, 43], fontStyle: 'bold' },
    columnStyles: { 1: { cellWidth: 190 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    didDrawPage: () => footer(doc, ledger.duplicatesFolded ? `${ledger.duplicatesFolded} bill${ledger.duplicatesFolded === 1 ? '' : 's'} IN4 lists twice shown once · Cr = payable to party, Dr = party owes` : 'Cr = payable to party, Dr = party owes'),
  })
  return new Uint8Array(doc.output('arraybuffer'))
}
