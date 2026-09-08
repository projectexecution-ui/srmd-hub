// A purchase order's supplier ledger as a printable page: what was received
// (GRNs, running quantity and value) and what was billed and paid for it
// (certificates in date order, running "still to pay"). Same A4 rules as the
// work-order ledger; HTML so the browser's own print dialogue makes the PDF.
// Gated on cost-control view, like the tree it is opened from. Read-only.

import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { loadPoLedger } from '@/lib/revamp/po-ledger'
import { In4NotConfigured, fmtDate } from '@/lib/in4/wo-print'
import { formatINR, formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const money = (v: number) => esc(formatINR(v))
const qty = (v: number) => esc(formatNumber(v, 3).replace(/\.?0+$/, ''))
const date = (v: string | null) => esc(fmtDate(v) ?? '')

export async function GET(_req: Request, { params }: { params: Promise<{ poId: string }> }) {
  await requirePermission('cost-control', 'view')
  const { poId: raw } = await params
  const poId = Number(raw)
  if (!Number.isInteger(poId) || poId <= 0) return new NextResponse('Not a purchase order id', { status: 400 })

  let d: Awaited<ReturnType<typeof loadPoLedger>>
  try {
    d = await loadPoLedger(poId)
  } catch (e) {
    if (e instanceof In4NotConfigured) return new NextResponse('IN4 is not connected on this deployment.', { status: 503 })
    return new NextResponse(`IN4 did not answer: ${e instanceof Error ? e.message : String(e)}`.replace(/[<>&]/g, ''), { status: 502 })
  }
  if (!d) return new NextResponse('IN4 has no purchase order with this id.', { status: 404 })
  const { grns, rows, totals: t } = d.ledger
  const stillToPay = d.ordered - t.paidOut - t.retention

  const grnRows = grns.map(g => `
    <tr>
      <td>${date(g.date)}</td>
      <td>${esc(g.grnNo ?? '—')}${g.challan ? ` <span class="dim">challan ${esc(g.challan)}</span>` : ''}</td>
      <td>${esc(g.material ?? '')}</td>
      <td class="n">${qty(g.qty)} ${esc(g.uom ?? '')}</td>
      <td class="n">${money(g.value)}</td>
      <td class="n">${qty(g.cumQty)}</td>
      <td class="n b">${money(g.cumValue)}</td>
    </tr>`).join('')

  const billRows = rows.map(r => `
    <tr class="${r.status === 'live' ? '' : 'off'}">
      <td>${date(r.date)}</td>
      <td>${esc(r.ref)}${r.certificateNo && r.ref !== `Cert ${r.certificateNo}` ? ` <span class="dim">cert ${esc(r.certificateNo)}</span>` : ''}${r.status !== 'live' ? ` <span class="tag">${r.status}</span>` : ''}${r.bookedUnder ? `<br><span class="dim">IN4 booked under ${esc(r.bookedUnder)}</span>` : ''}</td>
      <td>${r.kind === 'advance' ? 'Advance' : 'Bill'}${r.statusName ? ` <span class="dim">${esc(r.statusName)}</span>` : ''}</td>
      <td class="n">${money(r.gross)}</td>
      <td class="n">${money(r.certified)}</td>
      <td class="n">${money(r.tds)}</td>
      <td class="n">${money(r.retention)}</td>
      <td class="n">${money(r.advanceRecovered)}</td>
      <td class="n">${money(r.paid)}</td>
      <td class="n b">${r.status === 'live' ? money(r.stillToPay) : ''}</td>
    </tr>`).join('')

  const headerNote = Math.abs(d.headerPaid - t.paidOut) > 1
    ? `<p class="note warn">IN4’s order record puts Paid at ${money(d.headerPaid)}; the bills placed here by their GRNs add to ${money(t.paidOut)}. The difference is a bill IN4 booked under another PO’s number (named on its row) or one booked here for another PO’s material.</p>`
    : ''

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ledger — ${esc(d.ref)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm }
  body { margin: 0; font: 11.5px/1.45 system-ui, sans-serif; color: #111 }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 16px }
  h1 { font-size: 16px; margin: 0 } h2 { font-size: 12px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #555 }
  .sub { color: #555; margin: 2px 0 12px }
  table { width: 100%; border-collapse: collapse } th, td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; background: #f8fafc }
  .n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap } .b { font-weight: 700 }
  .dim { color: #6b7280; font-size: 10.5px }
  tr.off td { color: #9ca3af } .tag { font-size: 10px; border: 1px solid #d1d5db; border-radius: 4px; padding: 0 4px; color: #6b7280 }
  tfoot td { border-top: 2px solid #d1d5db; font-weight: 700; background: #f8fafc }
  .bar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 10px }
  button { font: inherit; padding: 6px 12px; border: 1px solid #c7d2fe; background: #eef2ff; border-radius: 6px; cursor: pointer }
  .note { color: #555; margin-top: 10px } .warn { color: #92400e } thead { display: table-header-group } tr { page-break-inside: avoid }
  @media print { .bar { display: none } .wrap { padding: 0 } }
</style></head><body><div class="wrap">
  <div class="bar"><button onclick="window.print()">Print / save as PDF</button></div>
  <h1>${esc(d.ref)}${d.party ? ` — ${esc(d.party)}` : ''}</h1>
  <p class="sub">Ordered (with GST) ${money(d.ordered)} · ${grns.length} receipt${grns.length === 1 ? '' : 's'} · ${rows.length} bill${rows.length === 1 ? '' : 's'} and advance${rows.length === 1 ? '' : 's'} · live from IN4</p>

  <h2>Received</h2>
  <table>
    <thead><tr><th>Date</th><th>GRN</th><th>Material</th><th class="n">Qty</th><th class="n">Value</th><th class="n">Cum. qty</th><th class="n">Cum. value</th></tr></thead>
    <tbody>${grnRows || '<tr><td colspan="7" style="text-align:center;color:#6b7280">Nothing received against this order in IN4.</td></tr>'}</tbody>
    ${grns.length ? `<tfoot><tr><td colspan="3">Total received</td><td class="n">${qty(t.receivedQty)}</td><td class="n">${money(t.receivedValue)}</td><td></td><td></td></tr></tfoot>` : ''}
  </table>

  <h2>Billed and paid</h2>
  <table>
    <thead><tr><th>Date</th><th>Bill</th><th>Type</th><th class="n">Gross</th><th class="n">Certified</th><th class="n">TDS</th><th class="n">Retention</th><th class="n">Advance recovered</th><th class="n">Paid</th><th class="n">Still to pay</th></tr></thead>
    <tbody>${billRows || '<tr><td colspan="10" style="text-align:center;color:#6b7280">No supplier bills or advances against this order’s receipts in IN4.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Totals — live entries</td><td class="n">${money(t.billed + t.advancePaid)}</td><td class="n"></td><td class="n">${money(t.tds)}</td><td class="n">${money(t.retention)}</td><td class="n">${money(t.advanceRecovered)}</td><td class="n">${money(t.paid)}</td><td class="n">${money(stillToPay)}</td></tr></tfoot>
  </table>
  ${headerNote}
  <p class="note">Bills are placed under this order by the GRN they pay for, not by the PO number IN4 wrote on the certificate. Money out = bill payments + TDS (counted as paid) + advances paid. Still to pay = Ordered − money out − retention held. Every figure is IN4’s own; the running columns are the only arithmetic.</p>
</div></body></html>`
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
